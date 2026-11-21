import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { headlineOf } from "./headline.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

const pieces = [
  "a",
  "Overloaded",
  " ",
  "\t",
  "é",
  "😀",
  "\n",
  "\r\n",
  "\r",
  "\u2028",
  "\n \n",
  "{",
  "}",
  '"',
  "\\",
  ":",
  '"message"',
  '"message": "',
  '{"message":"',
];

const text = Arbitrary.array(pick(pieces), { maxLength: 16 }).pipe(
  Arbitrary.map((parts) => parts.join("")),
);

const lineBreaks = /\r\n|[\n\r\u2028\u2029]/;

const linesOf = (message: string) =>
  message.split(lineBreaks).map((line) => line.trim());

/** The headline is one of the text's lines, and every line before it is blank. */
const isFirstLineOf = (headline: string, message: string) => {
  const lines = linesOf(message);
  const at = lines.indexOf(headline);
  return at !== -1 && lines.slice(0, at).every((line) => line === "");
};

const shapes = [
  ['{"message":', ',"type":"error"}'],
  ['{"type":"error","error":{"type":"invalid_request_error","message":', "}}"],
  ['{"detail":"Bad Request","message": ', ',"code":400}'],
] as const;

const encoded = (part: string) => JSON.stringify(part).slice(1, -1);

/** A message set in a JSON object's message field, the object cut after the field or, unclosed, within it at a character's end. */
const wrapped = Arbitrary.all({
  parts: Arbitrary.array(pick(pieces), { maxLength: 16 }),
  shape: pick(shapes),
  cut: int(0, 12),
  within: int(0, 17),
}).pipe(
  Arbitrary.map(({ parts, shape: [before, after], cut, within }) => {
    if (within > parts.length) {
      const field = `${before}"${parts.map(encoded).join("")}"`;
      return {
        message: parts.join(""),
        json: `${field}${after}`.slice(0, field.length + cut),
      };
    }
    const kept = parts.slice(0, within);
    return {
      message: kept.join(""),
      json: `${before}"${kept.map(encoded).join("")}`,
    };
  }),
);

describe("a message's headline", () => {
  it.prop(
    "V30: a message's headline is one trimmed line, blank only when the message is: the first line that is not blank of the first message field of a message that begins as a JSON object, even one a cut left unclosed, when it has one, and otherwise the message's own",
    { message: text, wrapped },
    ({ message, wrapped }) => {
      for (const given of [message, wrapped.json]) {
        const headline = headlineOf(given);
        expect(lineBreaks.test(headline)).toBe(false);
        expect(headline).toBe(headline.trim());
        expect(headline === "").toBe(given.trim() === "");
        if (!given.trimStart().startsWith("{")) {
          expect(isFirstLineOf(headline, given)).toBe(true);
        }
      }
      const inner = linesOf(wrapped.message).find((line) => line !== "");
      const headline = headlineOf(wrapped.json);
      if (inner === undefined) {
        expect(isFirstLineOf(headline, wrapped.json)).toBe(true);
      } else {
        expect(headline).toBe(inner);
      }
    },
  );
});
