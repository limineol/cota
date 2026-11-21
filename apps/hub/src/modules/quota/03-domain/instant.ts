import { DateTime, Option, Schema } from "effect";

const instant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** An ISO 8601 instant, a date, a time and its offset, decoded to the time it names. */
export const Instant = Schema.String.check(
  Schema.makeFilter(
    (text) =>
      (instant.test(text) && Option.isSome(DateTime.make(text))) ||
      "an ISO 8601 instant",
  ),
).pipe(Schema.decodeTo(Schema.DateTimeUtcFromString));
