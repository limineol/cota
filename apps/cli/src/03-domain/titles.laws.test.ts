import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import * as Titles from "./titles.ts";

const encoder = new TextEncoder();

/** Titles as the clients write them: plain, with characters of two to four bytes, padded, blank, empty, long, and with a lone surrogate. */
const Title = Schema.Literals([
  "Fix the relay",
  "Café au lait — naïve",
  "Ship it 🚀",
  "  padded on both sides  ",
  "   ",
  "",
  "\ud800 half a pair",
  `${"long ".repeat(45)}end`,
  "🚀 ".repeat(120),
]);

/** A transcript's lines: title lines of either kind, lines of other kinds, one that holds a marker in its text, and lines that are not JSON. */
const TranscriptLine = Schema.Union([
  Schema.Struct({ custom: Title }),
  Schema.Struct({ ai: Title }),
  Schema.Literals([
    "user",
    "assistant quoting a marker",
    "not json",
    "a title line that is not json",
    "a custom title that is not a string",
    "blank",
  ]),
]);

const transcriptLineOf = (line: typeof TranscriptLine.Type): string => {
  if (typeof line !== "string") {
    return "custom" in line
      ? JSON.stringify({
          type: "custom-title",
          customTitle: line.custom,
          sessionId: "s",
        })
      : JSON.stringify({ type: "ai-title", aiTitle: line.ai, sessionId: "s" });
  }
  switch (line) {
    case "user":
      return JSON.stringify({
        type: "user",
        message: { role: "user", content: "Rename this — please" },
      });
    case "assistant quoting a marker":
      return JSON.stringify({
        type: "assistant",
        message: { content: 'it wrote "type":"custom-title" here' },
      });
    case "not json":
      return "{ this is not json";
    case "a title line that is not json":
      return '{"type":"custom-title","customTitle":"cut off';
    case "a custom title that is not a string":
      return '{"type":"custom-title","customTitle":7}';
    case "blank":
      return "";
  }
};

/** Codex's index lines: a session's name, a line without one, and lines that are not JSON. */
const IndexLine = Schema.Union([
  Schema.Struct({ session: Schema.Literals(["a", "b", "c"]), name: Title }),
  Schema.Literals(["no name", "not json"]),
]);

const indexLineOf = (line: typeof IndexLine.Type): string => {
  if (typeof line !== "string") {
    return JSON.stringify({
      id: line.session,
      thread_name: line.name,
      updated_at: "2026-11-17T09:00:00Z",
    });
  }
  return line === "no name" ? '{"id":"a"}' : "not json at all";
};

/** Appends cut anywhere: each cut is a share of the whole, in thousandths. */
const Cuts = Schema.Array(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
);

const bytesOf = (lines: ReadonlyArray<string>, unfinished: boolean) =>
  encoder.encode(
    lines.map((line) => `${line}\n`).join("") +
      (unfinished ? '{"type":"ai-title","aiTitle":"still writ' : ""),
  );

/**
 * Each run reads on from where the last stopped, at each cut in turn, and
 * what it has read is compared with reading that much whole, once; then the
 * file is written again shorter, and is read again from its start.
 */
const readRunByRun = <Read extends { readonly offset: number }>(
  whole: Uint8Array,
  cuts: ReadonlyArray<number>,
  rewritten: Uint8Array,
  unread: Read,
  read: (kept: Read, bytes: Uint8Array) => Read,
) => {
  let state = unread;
  const ends = [...cuts]
    .map((cut) => Math.floor((cut * whole.length) / 1000))
    .sort((one, other) => one - other);
  for (const end of [...ends, whole.length]) {
    const written = whole.subarray(0, end);
    state = Titles.resumed(state, unread, written.length);
    state = read(state, written.subarray(state.offset));
    expect(state).toEqual(read(unread, written));
    expect(written[state.offset - 1] ?? 0x0a).toBe(0x0a);
  }
  if (rewritten.length < state.offset) {
    state = Titles.resumed(state, unread, rewritten.length);
    expect(read(state, rewritten.subarray(state.offset))).toEqual(
      read(unread, rewritten),
    );
  }
};

const hubKeeps = (title: string) =>
  [...title.toWellFormed().trim()].slice(0, 200).join("");

describe("title laws", () => {
  it.effect.prop(
    "J11: For any sequence of appends to a source, cut anywhere, inside a line or a character, the titles read run by run are those of reading the whole once.",
    {
      transcript: Arbitrary.schema(Schema.Array(TranscriptLine)),
      index: Arbitrary.schema(Schema.Array(IndexLine)),
      cuts: Arbitrary.schema(Cuts),
      unfinished: Arbitrary.schema(Schema.Boolean),
      rewritten: Arbitrary.schema(Schema.Array(TranscriptLine)),
    },
    ({ transcript, index, cuts, unfinished, rewritten }) =>
      Effect.sync(() => {
        readRunByRun(
          bytesOf(transcript.map(transcriptLineOf), unfinished),
          cuts,
          bytesOf(rewritten.map(transcriptLineOf), false),
          Titles.unreadTranscript,
          Titles.readTranscript,
        );
        readRunByRun(
          bytesOf(index.map(indexLineOf), unfinished),
          cuts,
          bytesOf(rewritten.map(transcriptLineOf), false),
          Titles.unreadIndex,
          Titles.readIndex,
        );
        const lastOf = (kind: "custom" | "ai") =>
          transcript
            .flatMap((line) =>
              typeof line !== "string" && kind in line
                ? [Object.values(line)[0] ?? ""]
                : [],
            )
            .at(-1);
        const whole = Titles.readTranscript(
          Titles.unreadTranscript,
          bytesOf(transcript.map(transcriptLineOf), unfinished),
        );
        expect([whole.custom, whole.ai]).toEqual([
          lastOf("custom"),
          lastOf("ai"),
        ]);
        const names = new Map<string, string>();
        for (const line of index) {
          if (typeof line !== "string") names.set(line.session, line.name);
        }
        expect(
          Titles.readIndex(
            Titles.unreadIndex,
            bytesOf(index.map(indexLineOf), unfinished),
          ).names,
        ).toEqual(names);
      }),
    { arbitrary: { runs: 500 } },
  );

  it.effect.prop(
    "J13: A session's title is T3 Code's, else Claude Code's owner name, else its generated one, else Codex's, the first not empty as the hub keeps it, and the hub keeps it as sent.",
    {
      found: Arbitrary.schema(
        Schema.Array(
          Schema.Struct({
            t3: Schema.optionalKey(Title),
            custom: Schema.optionalKey(Title),
            ai: Schema.optionalKey(Title),
            codex: Schema.optionalKey(Title),
          }),
        ),
      ),
    },
    ({ found }) =>
      Effect.sync(() => {
        const sessions = found.map((_, index) => `session-${index}`);
        const titles = Titles.titlesOf({
          t3: new Map(
            found.flatMap(({ t3 }, index) =>
              t3 === undefined ? [] : [[sessions[index] ?? "", t3] as const],
            ),
          ),
          transcripts: new Map(
            found.map(({ custom, ai }, index) => [
              `/home/me/.claude/projects/-home-me-acme/${sessions[index]}.jsonl`,
              {
                offset: 0,
                ...(custom === undefined ? {} : { custom }),
                ...(ai === undefined ? {} : { ai }),
              },
            ]),
          ),
          codex: {
            offset: 0,
            names: new Map(
              found.flatMap(({ codex }, index) =>
                codex === undefined
                  ? []
                  : [[sessions[index] ?? "", codex] as const],
              ),
            ),
          },
        });
        found.forEach((each, index) => {
          const first = [each.t3, each.custom, each.ai, each.codex].find(
            (title) => title !== undefined && hubKeeps(title) !== "",
          );
          const title = Option.fromUndefinedOr(
            titles.get(sessions[index] ?? ""),
          );
          expect(title).toEqual(
            first === undefined
              ? Option.none()
              : Option.some(hubKeeps(first).trimEnd()),
          );
          expect(Titles.titleOf(each)).toEqual(title);
          for (const sent of Option.toArray(title)) {
            expect(hubKeeps(sent)).toBe(sent);
          }
        });
      }),
    { arbitrary: { runs: 500 } },
  );
});
