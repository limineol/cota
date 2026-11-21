import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option, Schema } from "effect";
import * as AnthropicMessages from "#modules/request-log/04-infrastructure/transcripts/anthropic-messages.ts";
import * as ChatGptCodex from "#modules/request-log/04-infrastructure/transcripts/chatgpt-codex.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as Search from "./search.ts";
import * as Traffic from "./traffic.ts";

const query = Search.SearchQuery.make;

describe("a text's words", () => {
  it("are its runs between ASCII spaces, punctuation and controls, lowercased, as the search spec's table gives them", () => {
    expect(
      [
        "fetch_user_id failed: ECONNRESET",
        "x-cota-key at 10:42",
        "Résumé of the CAFÉ order",
        "日本語 テキスト",
        "foo—bar",
        "tab\there\u0000nul\u007fdel",
      ].map(Search.wordsOf),
    ).toEqual([
      ["fetch", "user", "id", "failed", "econnreset"],
      ["x", "cota", "key", "at", "10", "42"],
      ["résumé", "of", "the", "café", "order"],
      ["日本語", "テキスト"],
      ["foo—bar"],
      ["tab", "here", "nul", "del"],
    ]);
  });

  it("are lowercased one by one, so a capital sigma that ends a word is ς even where the text goes on after punctuation", () => {
    expect(Search.wordsOf("ΑΣ'Β ΣΟΦΟΣ İstanbul")).toEqual([
      "ας",
      "β",
      "σοφος",
      "i̇stanbul",
    ]);
  });
});

describe("a search query", () => {
  const decode = Schema.decodeUnknownOption(Search.SearchQuery);

  it("holds 1 to 20 words in 1 to 200 characters", () => {
    expect(
      [
        "relay",
        "ü".repeat(200),
        Array.from({ length: 20 }, (_, at) => `w${at}`).join(" "),
      ].map((text) => Option.isSome(decode(text))),
    ).toEqual([true, true, true]);
  });

  it("is not one with no word, more than 20, or more than 200 characters", () => {
    expect(
      [
        "",
        " ... --- ",
        Array.from({ length: 21 }, (_, at) => `w${at}`).join(" "),
        "ü".repeat(201),
      ].map((text) => Option.isSome(decode(text))),
    ).toEqual([false, false, false, false]);
  });
});

describe("a tolerance", () => {
  it("allows a query word round(length × fuzzy) edits, halves up, at most two: at 0.2, none to 1 or 2 characters, one to 3 to 7, two from 8", () => {
    expect(
      ["ab", "abc", "abcdefg", "abcdefgh", "abcdefghijklmnopqrstuvwxyz"].map(
        (word) => Search.editsFor(word, 0.2),
      ),
    ).toEqual([0, 1, 1, 2, 2]);
    expect([
      Search.editsFor("abcde", 0.1),
      Search.editsFor("abc", 0.5),
      Search.editsFor("abcd", 0.125),
      Search.editsFor("😀😀😀", 0.5),
    ]).toEqual([1, 2, 1, 2]);
  });

  it("matches a word equal to the query's, starting with it given prefix, or within its edits, and never a prefix of a word within its edits", () => {
    const fuzzy = { prefix: false, fuzzy: 0.2 };
    const prefix = { prefix: true, fuzzy: 0 };
    const both = { prefix: true, fuzzy: 0.2 };

    expect([
      Search.isMatch("relay", "relay", Search.exact),
      Search.isMatch("relay", "relaying", Search.exact),
      Search.isMatch("relay", "relaying", prefix),
      Search.isMatch("relay", "relau", fuzzy),
      Search.isMatch("relay", "rleay", fuzzy),
      Search.isMatch("relay", "relauing", both),
      Search.isMatch("café", "cafe", fuzzy),
      Search.isMatch("rel", "re", prefix),
    ]).toEqual([true, false, true, true, false, false, true, false]);
  });

  it("measures edits over characters, not UTF-16 units", () => {
    expect([
      Search.editsBetween("😀a", "a"),
      Search.editsBetween("kitten", "sitting"),
      Search.editsBetween("ab", "ba"),
    ]).toEqual([1, 3, 2]);
  });
});

describe("a snippet", () => {
  const long = `${"a ".repeat(150)}Relay${" b".repeat(300)}`;

  it("begins 100 characters before the first place the query's first word is a word of the text, and holds 280 characters", () => {
    const snippet = Search.snippetOf(long, query("relay hang"));

    expect(snippet.start).toBe(200);
    expect([...snippet.text]).toHaveLength(280);
    expect([...snippet.text].slice(100, 105).join("")).toBe("Relay");
  });

  it("begins at the start when the word is nearer than 100 characters, or is no word of the text, as inside another word", () => {
    expect([
      Search.snippetOf("Fix the relay.", query("RELAY")),
      Search.snippetOf("relayed it", query("relay")),
    ]).toEqual([
      { text: "Fix the relay.", start: 0 },
      { text: "relayed it", start: 0 },
    ]);
  });

  it("begins before the first word that matches the query's first word under the tolerance", () => {
    expect([
      Search.snippetOf("relayed it", query("relay"), {
        prefix: true,
        fuzzy: 0,
      }),
      Search.snippetOf(`${"a ".repeat(60)}relau`, query("relay"), {
        prefix: false,
        fuzzy: 0.2,
      }).start,
    ]).toEqual([{ text: "relayed it", start: 0 }, 20]);
  });

  it("counts characters, not UTF-16 units", () => {
    const snippet = Search.snippetOf(
      `${"😀".repeat(150)} relay`,
      query("relay"),
    );

    expect(snippet.start).toBe(51);
    expect(snippet.text).toBe(`${"😀".repeat(99)} relay`);
  });
});

describe("what a transcript shows of an item", () => {
  it("leaves out image bytes, data URLs, fields named data and encrypted reasoning", () => {
    const anthropic = Conversation.canonical({
      role: "user",
      content: [
        { type: "text", text: "See the chart." },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoSECRET",
          },
        },
        {
          type: "tool_use",
          id: "t1",
          name: "upload",
          input: { data: "U0VDUkVU", url: "data:image/png;base64,U0VDUkVU" },
        },
        { type: "redacted_thinking", data: "ENCRYPTEDSECRET" },
      ],
    });
    const codex = Conversation.canonical({
      type: "reasoning",
      summary: [],
      encrypted_content: "ENCRYPTEDSECRET",
    });

    const shown = [
      Search.shownTextOf(AnthropicMessages.renderer, "input", anthropic),
      Search.shownTextOf(ChatGptCodex.renderer, "output", codex),
      Search.shownTextOf(
        AnthropicMessages.renderer,
        "tools",
        Conversation.canonical({ name: "read", data: "SECRET" }),
      ),
    ].join("\n");

    expect(shown).toContain("See the chart.");
    expect(shown).not.toMatch(/SECRET|iVBOR|U0VD/);
  });
});

describe("a cursor", () => {
  const asked: Traffic.Asked = {
    from: Option.none(),
    to: Option.some(DateTime.makeUnsafe(Date.UTC(2026, 10, 13))),
    filters: { ...Traffic.noFilters, pool: ["work", "claude"] },
  };
  const window = {
    from: DateTime.makeUnsafe(Date.UTC(2026, 10, 6)),
    to: DateTime.makeUnsafe(Date.UTC(2026, 10, 13)),
  };
  const last = {
    at: DateTime.makeUnsafe(Date.UTC(2026, 10, 12)),
    session: "séance\\1",
    item: Conversation.Digest.make("0123456789abcdef0123456789abcdef"),
  };
  const key = Search.keyOf(asked, query("relay"));
  const cursor = Search.cursorOf(key, window, last);

  it("continues the search it came from, filters in any order, over its first page's window", () => {
    const again = Search.keyOf(
      { ...asked, filters: { ...asked.filters, pool: ["claude", "work"] } },
      query("relay"),
    );

    expect(Search.continuing(cursor, again)).toEqual(
      Option.some({ window, after: last }),
    );
  });

  it("continues no other search, and nothing that is not a cursor", () => {
    expect(
      [
        Search.continuing(cursor, Search.keyOf(asked, query("Relay"))),
        Search.continuing(
          cursor,
          Search.keyOf({ ...asked, to: Option.none() }, query("relay")),
        ),
        Search.continuing("not a cursor", key),
      ].map(Option.isSome),
    ).toEqual([false, false, false]);
  });

  it("continues no search with another tolerance, and an exact search's key is the one it had before tolerances", () => {
    const tolerant = Search.keyOf(asked, query("relay"), {
      prefix: true,
      fuzzy: 0.2,
    });

    expect([
      Search.keyOf(asked, query("relay"), Search.exact),
      Option.isSome(Search.continuing(cursor, tolerant)),
      Search.keyOf(asked, query("relay"), { prefix: true, fuzzy: 0.2 }) ===
        tolerant,
      Search.keyOf(asked, query("relay"), { prefix: true, fuzzy: 0.25 }) ===
        tolerant,
      Search.keyOf(asked, query("relay"), { prefix: false, fuzzy: 0.2 }) ===
        tolerant,
    ]).toEqual([
      Conversation.digestOf(
        Conversation.canonical({
          query: "relay",
          from: null,
          to: Date.UTC(2026, 10, 13),
          filters: {
            ...Traffic.noFilters,
            pool: ["claude", "work"],
          },
        }),
      ),
      false,
      true,
      false,
      false,
    ]);
  });

  it("continues nothing from a cursor whose instants no time holds, or are not whole milliseconds", () => {
    const forged = (instants: { from: number; to: number; at: number }) =>
      Buffer.from(
        JSON.stringify({
          key,
          ...instants,
          session: last.session,
          item: last.item,
        }),
      ).toString("base64url");
    const valid = { from: 0, to: 1, at: 0 };

    expect(
      [
        { ...valid, at: 9e15 },
        { ...valid, from: -9e15 },
        { ...valid, to: 8_640_000_000_000_001 },
        { ...valid, at: 0.5 },
        { ...valid, from: -8.64e15, at: 8.64e15 },
      ].map((instants) =>
        Option.isSome(Search.continuing(forged(instants), key)),
      ),
    ).toEqual([false, false, false, false, true]);
  });

  it("is at most longestCursor characters for the longest session id the request log holds, every unit of it written as JSON at its longest", () => {
    const earliest = DateTime.makeUnsafe(-8.64e15);
    const worst = { ...last, at: earliest, session: "\u0001".repeat(255) };
    const longest = Search.cursorOf(
      key,
      { from: earliest, to: earliest },
      worst,
    );

    expect([
      longest.length,
      Search.cursorOf(key, window, { ...last, session: "\ud800".repeat(255) })
        .length <= Search.longestCursor,
      Search.cursorOf(key, window, {
        ...last,
        session: "\u{1F980}".repeat(255),
      }).length <= Search.longestCursor,
    ]).toEqual([Search.longestCursor, true, true]);
    expect(Search.continuing(longest, key)).toEqual(
      Option.some({ window: { from: earliest, to: earliest }, after: worst }),
    );
  });
});
