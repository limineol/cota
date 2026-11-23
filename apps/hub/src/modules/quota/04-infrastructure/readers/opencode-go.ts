import {
  DateTime,
  Duration,
  Option,
  type Redacted,
  Result,
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import { Instant } from "#modules/quota/03-domain/instant.ts";
import { readingOf } from "./reading.ts";
import * as UsageEndpoint from "./usage-endpoint.ts";

const Window = Schema.optionalKey(
  Schema.NullOr(
    Schema.Struct({ percent: Schema.Finite, resetsAt: Schema.NullOr(Instant) }),
  ),
);

const Answer = Schema.Struct({
  usage: Schema.Struct({ rolling: Window, weekly: Window, monthly: Window }),
});
type Answer = typeof Answer.Type;

/** OpenCode Go's windows, all of the plan; their lengths are the prototype's assumption, as OpenCode Go does not say. */
const windows = [
  ["rolling", Duration.hours(5)],
  ["weekly", Duration.days(7)],
  ["monthly", Duration.days(30)],
] as const;

const readingFrom = (answer: Answer, at: DateTime.Utc) =>
  Result.succeed(
    readingOf(
      windows.flatMap(([name, length]) => {
        const window = answer.usage[name];
        if (window === undefined || window === null) return [];
        return [
          {
            lengthMs: Duration.toMillis(length),
            scope: Option.none(),
            used: window.percent,
            resetMs: Option.map(
              Option.fromNullishOr(window.resetsAt),
              DateTime.toEpochMillis,
            ),
          },
        ];
      }),
      Option.none(),
      at,
    ),
  );

/** OpenCode Go's usage endpoint, under the pool's base URL. */
export const urlOf = (baseUrl: string): string => `${baseUrl}/usage`;

/** Reads an OpenCode Go pool's windows with its held key (`docs/specs/quota-readers/spec.md`, OpenCode Go). */
export const read = (
  http: HttpClient.HttpClient,
  baseUrl: string,
  key: Redacted.Redacted<string>,
) =>
  UsageEndpoint.read(http, {
    provider: "OpenCode Go",
    url: urlOf(baseUrl),
    credential: key,
    answer: Answer,
    reading: readingFrom,
  });
