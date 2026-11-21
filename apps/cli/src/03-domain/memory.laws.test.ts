import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import * as Memory from "./memory.ts";

/** Texts of one to four UTF-8 bytes a character, empty, short, and long enough to be cut at any page's cut. */
const Text = Schema.Literals([
  "",
  "ok",
  "Café au lait — naïve",
  "Ship it 🚀🚀🚀",
  "line one\nline two",
  "retry ".repeat(30),
  "🚀".repeat(70),
  "日本語のテキスト".repeat(9),
]);

/** What the hub cut of a text before it sent it. */
const HubCut = Schema.Literals([0, 0, 1, 20_000, 100_000]);

const placed = {
  item: Schema.Literal("d"),
  part: Schema.Literals(["system", "input", "output"]),
};

const Part = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Text, cut: HubCut }),
  Schema.Struct({
    type: Schema.Literal("image"),
    mediaType: Schema.NullOr(Schema.Literal("image/png")),
    bytes: Schema.NullOr(Schema.Literal(2048)),
  }),
  Schema.Struct({ type: Schema.Literal("other"), json: Text, cut: HubCut }),
]);

const Entry = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("message"),
    ...placed,
    role: Schema.Literals(["user", "assistant", "system"]),
    parts: Schema.Array(Part),
  }),
  Schema.Struct({
    kind: Schema.Literal("reasoning"),
    ...placed,
    text: Schema.NullOr(Text),
    hidden: Schema.Boolean,
    cut: HubCut,
  }),
  Schema.Struct({
    kind: Schema.Literal("tool-call"),
    ...placed,
    callId: Schema.NullOr(Schema.Literal("toolu_01")),
    name: Schema.Literals(["Bash", "Read"]),
    input: Text,
    cut: HubCut,
  }),
  Schema.Struct({
    kind: Schema.Literal("tool-result"),
    ...placed,
    callId: Schema.NullOr(Schema.Literal("toolu_01")),
    name: Schema.NullOr(Schema.Literal("Bash")),
    output: Text,
    error: Schema.Boolean,
    cut: HubCut,
  }),
  Schema.Struct({
    kind: Schema.Literal("other"),
    ...placed,
    json: Text,
    cut: HubCut,
  }),
]);

const Asked = Schema.Struct({
  from: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
  entries: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  cut: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
});

const characters = (text: string) => Array.from(text).length;

describe("transcript page laws", () => {
  it.effect.prop(
    "O1: A page shows at most the entries asked, each text cut at the cut asked, and says of each what it left out: the text's length less what it shows, plus what the hub cut.",
    {
      entries: Arbitrary.schema(Schema.Array(Entry)),
      asked: Arbitrary.schema(Asked),
    },
    ({ entries, asked }) =>
      Effect.sync(() => {
        const page = Memory.pageOf(entries, asked);
        expect(page.total).toBe(entries.length);
        expect(page.shown.length).toBeLessThanOrEqual(asked.entries);
        page.shown.forEach((shown, index) => {
          expect(shown.number).toBe(asked.from + index);
          const entry = entries[shown.number - 1];
          expect(entry).toBeDefined();
          if (entry === undefined) return;
          const whole = Memory.textOf(entry);
          expect(characters(shown.text)).toBeLessThanOrEqual(asked.cut);
          expect(whole.text.startsWith(shown.text)).toBe(true);
          expect(shown.leftOut).toBe(
            characters(whole.text) - characters(shown.text) + whole.cut,
          );
          const hubCut =
            entry.kind === "message"
              ? entry.parts.reduce(
                  (sum, part) => sum + (part.type === "image" ? 0 : part.cut),
                  0,
                )
              : entry.cut;
          expect(whole.cut).toBe(hubCut);
          if (characters(whole.text) <= asked.cut) {
            expect(shown.text).toBe(whole.text);
          }
        });
      }),
  );

  it.effect.prop(
    "O2: Reading pages from the first entry, each from where the page before said the next starts, shows every entry once, in order, and ends with a page that says it is the last.",
    {
      entries: Arbitrary.schema(Schema.Array(Entry)),
      size: Arbitrary.schema(Asked.fields.entries),
      cut: Arbitrary.schema(Asked.fields.cut),
    },
    ({ entries, size, cut }) =>
      Effect.sync(() => {
        const seen: Array<number> = [];
        let from = Option.some(1);
        let pages = 0;
        while (Option.isSome(from)) {
          const page = Memory.pageOf(entries, {
            from: from.value,
            entries: size,
            cut,
          });
          seen.push(...page.shown.map(({ number }) => number));
          if (entries.length > 0) expect(page.shown.length).toBeGreaterThan(0);
          from = page.next;
          pages += 1;
          expect(pages).toBeLessThanOrEqual(entries.length + 1);
        }
        expect(seen).toEqual(entries.map((_, index) => index + 1));
      }),
  );
});
