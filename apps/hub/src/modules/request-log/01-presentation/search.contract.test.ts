import { expect, layer } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as Search from "#modules/request-log/03-domain/search.ts";
import { SearchQuery } from "#modules/request-log/03-domain/search.ts";
import { noFilters } from "#modules/request-log/03-domain/traffic.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import { Digest } from "#shared/03-domain/conversation.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };
const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const chat = (session: string, content: unknown) =>
  Effect.gen(function* () {
    const fake = yield* FakeProvider.FakeProvider;
    fake.answer({
      headers: [["content-type", "application/json"]],
      chunks: [
        JSON.stringify({
          id: "chatcmpl-1",
          model: "glm-5.2",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "On it." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      ],
    });
    yield* Harness.send("/pools/work/chat/completions", {
      method: "POST",
      headers: {
        ...fleet,
        "content-type": "application/json",
        "x-session-affinity": session,
      },
      body: JSON.stringify({
        model: "glm-5.2",
        messages: [
          { role: "system", content: "You are OpenCode." },
          { role: "user", content },
        ],
      }),
    }).pipe(Effect.andThen(Harness.textOf));
  });

/** The digest of a request's user message, its second input item. */
const promptOf = (request: Request.Request | undefined) =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromUndefinedOr(request), ({ conversation }) =>
      Option.map(conversation, ({ input }) => input[1]?.digest),
    ),
  );

const background = `${"Background. ".repeat(20)}Why did the Relay hang up?`;

const search = (query: Record<string, string>) =>
  Harness.send(`/api/search?${new URLSearchParams(query)}`, {
    headers: reader,
  });

layer(Harness.layer())("the search group", (it) => {
  it.effect(
    "finds the items whose text holds every word of the search query, in any case, newest first, each with its snippet",
    () =>
      Effect.gen(function* () {
        yield* chat("session-1", "Fix the relay's HANG-UP, please.");
        const [first] = yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        yield* chat("session-2", background);
        const [second] = yield* Harness.recorded(1);
        yield* chat("session-3", "The relay is fine.");
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        const client = yield* Harness.api(reader);

        const { hits, next } = yield* client.search.search({
          query: { q: SearchQuery.make("relay hang") },
        });

        expect(next).toBeNull();
        expect(Generated.plain(hits)).toEqual([
          {
            session: "session-2",
            item: promptOf(second),
            request: second?.id,
            part: "input",
            role: "user",
            at: Generated.plain(second?.startedAt),
            snippet: {
              text: background.slice(background.indexOf("Relay") - 100),
              start: background.indexOf("Relay") - 100,
            },
          },
          {
            session: "session-1",
            item: promptOf(first),
            request: first?.id,
            part: "input",
            role: "user",
            at: Generated.plain(first?.startedAt),
            snippet: { text: "Fix the relay's HANG-UP, please.", start: 0 },
          },
        ]);
      }),
  );

  it.effect(
    "pages by next, whatever is found after the first page, and refuses a cursor given with another search query",
    () =>
      Effect.gen(function* () {
        for (const session of ["a", "b", "c"]) {
          yield* chat(session, `conduit ${session}`);
          yield* Harness.recorded(1);
          yield* TestClock.adjust("1 minute");
        }
        const client = yield* Harness.api(reader);
        const q = SearchQuery.make("CONDUIT");

        const first = yield* client.search.search({ query: { q, limit: 2 } });
        yield* chat("d", "conduit d");
        yield* Harness.recorded(1);
        const second = yield* client.search.search({
          query: { q, limit: 2, cursor: first.next ?? "" },
        });
        const stale = yield* Harness.problemOf(
          yield* search({
            q: "conduit a",
            limit: "2",
            cursor: first.next ?? "",
          }),
        );

        expect(
          [...first.hits, ...second.hits].map(({ session }) => session),
        ).toEqual(["c", "b", "a"]);
        expect(second.next).toBeNull();
        expect(stale).toEqual({
          status: 400,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:stale-cursor",
            status: 400,
            title: "The cursor does not continue this search.",
            detail:
              "Give a cursor with the same q, prefix, fuzzy and filters as the page it came from, or leave it out to start again.",
          },
        });
      }),
  );

  it.effect(
    "takes the longest cursor the hub can make: a session id of 255 control characters, at the earliest instant",
    () =>
      Effect.gen(function* () {
        const q = SearchQuery.make("conduit");
        const earliest = DateTime.makeUnsafe(-8.64e15);
        const cursor = Search.cursorOf(
          Search.keyOf(
            { from: Option.none(), to: Option.none(), filters: noFilters },
            q,
          ),
          { from: earliest, to: earliest },
          {
            at: earliest,
            session: "\u0001".repeat(255),
            item: Digest.make("0123456789abcdef0123456789abcdef"),
          },
        );
        const response = yield* search({ q, cursor });

        expect(cursor.length).toBeGreaterThan(2_000);
        expect([response.status, yield* Harness.textOf(response)]).toEqual([
          200,
          '{"hits":[],"next":null}',
        ]);
      }),
  );

  it.effect(
    "answers a search query with no word, or with more than 20, as a parameter that does not decode",
    () =>
      Effect.gen(function* () {
        const answers = [];
        for (const q of [
          " ... ",
          Array.from({ length: 21 }, (_, at) => `w${at}`).join(" "),
        ]) {
          const { status, body } = yield* Harness.problemOf(
            yield* search({ q }),
          );
          answers.push({ status, body });
        }

        expect(answers).toMatchObject([
          { status: 400, body: { type: "about:blank" } },
          { status: 400, body: { type: "about:blank" } },
        ]);
      }),
  );

  it.effect(
    "finds a word that starts with the query's given prefix=true, and one within its edits given fuzzy, snippets starting at it, and refuses a cursor given with another tolerance",
    () =>
      Effect.gen(function* () {
        yield* chat("pump-1", `${"Background. ".repeat(20)}Gasketing now.`);
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        yield* chat("pump-2", "The gasket blew.");
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        yield* chat("pump-3", "Basket it.");
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        const client = yield* Harness.api(reader);
        const q = SearchQuery.make("gasket");
        const sessionsOf = (hits: ReadonlyArray<{ session: string }>) =>
          hits.map(({ session }) => session);

        const exact = yield* client.search.search({ query: { q } });
        const prefixed = yield* client.search.search({
          query: { q, prefix: true },
        });
        const fuzzy = yield* client.search.search({
          query: { q, fuzzy: 0.2 },
        });
        const both = yield* client.search.search({
          query: { q, prefix: true, fuzzy: 0.2, limit: 1 },
        });
        const stale = yield* Harness.problemOf(
          yield* search({
            q: "gasket",
            prefix: "true",
            fuzzy: "0.25",
            limit: "1",
            cursor: both.next ?? "",
          }),
        );
        const outside = yield* Harness.problemOf(
          yield* search({ q: "gasket", fuzzy: "1.5" }),
        );

        expect([
          sessionsOf(exact.hits),
          sessionsOf(prefixed.hits),
          sessionsOf(fuzzy.hits),
          sessionsOf(both.hits),
        ]).toEqual([
          ["pump-2"],
          ["pump-2", "pump-1"],
          ["pump-3", "pump-2"],
          ["pump-3"],
        ]);
        expect(prefixed.hits[1]?.snippet.start).toBe(140);
        expect([stale.status, stale.body]).toMatchObject([
          400,
          { type: "urn:cota:stale-cursor" },
        ]);
        expect([outside.status, outside.body]).toMatchObject([
          400,
          { type: "about:blank" },
        ]);
      }),
  );

  it.effect(
    "shows in a snippet what a transcript shows: an image by nothing, never its bytes",
    () =>
      Effect.gen(function* () {
        yield* chat("session-1", [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,iVBORw0KGgoSECRETBYTES" },
          },
          { type: "text", text: "What does this relay diagram show?" },
        ]);
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        const client = yield* Harness.api(reader);

        const { hits } = yield* client.search.search({
          query: { q: SearchQuery.make("relay diagram") },
        });

        expect(hits.map(({ snippet }) => snippet)).toEqual([
          { text: "What does this relay diagram show?", start: 0 },
        ]);
      }),
  );
});

layer(Harness.layer())("the sessions list searched", (it) => {
  it.effect(
    "lists only the sessions with an item that holds the search query's words, each with its newest such item's snippet",
    () =>
      Effect.gen(function* () {
        yield* chat("session-1", "Fix the relay.");
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        yield* chat("session-1", "Is the relay fixed now?");
        yield* Harness.recorded(1);
        yield* chat("session-2", "Name the sessions.");
        yield* Harness.recorded(1);
        yield* TestClock.adjust("1 minute");
        const client = yield* Harness.api(reader);

        const searched = yield* client.sessions.sessions({
          query: { q: SearchQuery.make("Relay") },
        });
        const listed = yield* client.sessions.sessions({ query: {} });
        const tolerant = yield* client.sessions.sessions({
          query: { q: SearchQuery.make("sesions"), fuzzy: 0.2, prefix: true },
        });

        expect(
          searched.sessions.map(({ id, snippet }) => ({ id, snippet })),
        ).toEqual([
          {
            id: "session-1",
            snippet: { text: "Is the relay fixed now?", start: 0 },
          },
        ]);
        expect(searched.total).toBe(1);
        expect(
          tolerant.sessions.map(({ id, snippet }) => ({ id, snippet })),
        ).toEqual([
          {
            id: "session-2",
            snippet: { text: "Name the sessions.", start: 0 },
          },
        ]);
        expect(listed.sessions.map(({ snippet }) => snippet)).toEqual([
          null,
          null,
        ]);
      }),
  );
});
