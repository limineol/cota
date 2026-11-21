import { expect, layer } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import * as Generated from "#modules/request-log/05-tests/transcripts.ts";
import * as RenderedTranscripts from "./transcripts.ts";

/** A list with each run of equal neighbours taken as one. */
const runs = (values: ReadonlyArray<string>) =>
  values.filter((value, index) => value !== values[index - 1]);

/** Every text an entry shows, with the characters it left out. */
const textsOf = (
  entry: Transcript.ItemEntry,
): ReadonlyArray<{ readonly text: string; readonly cut: number }> => {
  switch (entry.kind) {
    case "message":
      return entry.parts.flatMap((part) => {
        if (part.type === "text") return [{ text: part.text, cut: part.cut }];
        if (part.type === "other") return [{ text: part.json, cut: part.cut }];
        return [];
      });
    case "reasoning":
      return Option.toArray(entry.text).map((text) => ({
        text,
        cut: entry.cut,
      }));
    case "tool-call":
      return [{ text: entry.input, cut: entry.cut }];
    case "tool-result":
      return [{ text: entry.output, cut: entry.cut }];
    case "other":
      return [{ text: entry.json, cut: entry.cut }];
  }
};

const length = (text: string) => [...text].length;

const limit = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 80 })),
);

layer(RenderedTranscripts.layer)("transcripts", (it) => {
  it.effect.prop(
    "T10: for every request, the items its transcript's entries come from are, in order, exactly the items of its system, input and output parts, a run of one item repeated taken as one on either side",
    { request: Generated.requestItems },
    ({ request: { protocol, items } }) =>
      Effect.gen(function* () {
        const transcripts = yield* Transcripts;
        const entries = transcripts.entriesOf(
          protocol,
          items,
          Transcript.longest.session,
        );

        expect(
          runs(entries.map(({ part, item }) => `${part} ${item}`)),
        ).toEqual(
          runs(
            Transcript.parts.flatMap((part) =>
              items[part].map(({ digest }) => `${part} ${digest}`),
            ),
          ),
        );
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "T11: for every text in an entry, its length plus cut is the length of the text before cutting, and cut is 0 when the text fits",
    { request: Generated.requestItems, limit },
    ({ request: { protocol, items }, limit }) =>
      Effect.gen(function* () {
        const transcripts = yield* Transcripts;
        const whole = transcripts
          .entriesOf(protocol, items, Number.MAX_SAFE_INTEGER)
          .flatMap(textsOf);
        const cut = transcripts.entriesOf(protocol, items, limit);
        const texts = cut.flatMap(textsOf);

        expect(whole.map(({ cut }) => cut)).toEqual(whole.map(() => 0));
        expect(
          texts.map(({ text, cut }) => ({ length: length(text) + cut, cut })),
        ).toEqual(
          whole.map(({ text }) => ({
            length: length(text),
            cut: Math.max(0, length(text) - limit),
          })),
        );
        expect(
          texts.every(({ text }, index) => whole[index]?.text.startsWith(text)),
        ).toBe(true);
        expect(
          cut.reduce((sum, entry) => sum + Transcript.cutOf(entry), 0),
        ).toBe(texts.reduce((sum, { cut }) => sum + cut, 0));
      }),
    { arbitrary: { runs: 300 } },
  );
});
