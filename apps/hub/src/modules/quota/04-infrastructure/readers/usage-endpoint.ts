import {
  DateTime,
  Duration,
  Effect,
  Option,
  type Redacted,
  Result,
  type Schema,
} from "effect";
import { Headers, HttpClient, HttpClientRequest } from "effect/http";
import type { ReadFailure } from "#modules/quota/03-domain/readings.ts";
import type { QuotaReading } from "#modules/quota/03-domain/sources.ts";
import {
  decodeAt,
  failure,
  longestCall,
  parseJson,
  userAgent,
} from "#modules/quota/04-infrastructure/provider-call.ts";

/** One reader's call of its provider's usage endpoint, and how its answer becomes a quota reading. */
export interface UsageCall<A> {
  /** The provider's name for people, in a failure's detail: `Z.ai`. */
  readonly provider: string;
  readonly url: string;
  readonly credential: Redacted.Redacted<string>;
  /** What the provider needs beside the credential, redacted as the credential is wherever the call is traced. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly answer: Schema.Codec<A, unknown>;
  /** The reading an answer gives, observed at `at`; a failure is why it cannot be read. */
  readonly reading: (
    answer: A,
    at: DateTime.Utc,
  ) => Result.Result<QuotaReading, string>;
}

/** The furthest ahead a `retry-after` is honoured. */
const longestRetry = Duration.hours(24);

const imfFixdate =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/;

/**
 * The instant a `retry-after` names: a whole number of seconds after now, or
 * an HTTP date (IMF-fixdate), at most 24 hours after now; none for anything
 * else.
 */
const retryAtOf = (
  value: string | undefined,
  now: DateTime.Utc,
): Option.Option<DateTime.Utc> => {
  const trimmed = value?.trim() ?? "";
  const latest = DateTime.addDuration(now, longestRetry);
  if (/^[0-9]+$/.test(trimmed)) {
    return Option.some(
      DateTime.addDuration(
        now,
        Duration.min(Duration.seconds(Number(trimmed)), longestRetry),
      ),
    );
  }
  if (!imfFixdate.test(trimmed)) return Option.none();
  return Option.map(DateTime.make(trimmed), (at) => DateTime.min(at, latest));
};

/**
 * Calls a usage endpoint once with `GET`, the credential as a bearer token,
 * `Accept: application/json` and the hub's user agent, abandoned after
 * `longestCall`, and turns its answer into a quota reading or a failure, as
 * the quota readers spec's table of answers says.
 */
export const read = <A>(
  http: HttpClient.HttpClient,
  call: UsageCall<A>,
): Effect.Effect<QuotaReading, ReadFailure> =>
  Effect.gen(function* () {
    const unreadable = (status: number, reason: string) =>
      failure(
        "unreadable",
        Option.some(status),
        `${call.provider}'s usage answer could not be read: ${reason}.`,
      );
    const response = yield* http
      .execute(
        HttpClientRequest.get(call.url).pipe(
          HttpClientRequest.bearerToken(call.credential),
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeader("user-agent", userAgent),
          HttpClientRequest.setHeaders(call.headers ?? {}),
        ),
      )
      .pipe(
        Effect.mapError(() =>
          failure(
            "unreachable",
            Option.none(),
            `${call.provider}'s usage endpoint could not be reached.`,
          ),
        ),
      );
    const status = response.status;
    const answered = `${call.provider}'s usage endpoint answered ${status}.`;
    if (status === 401) {
      return yield* failure("refused", Option.some(status), answered);
    }
    if (status === 429) {
      return yield* failure(
        "rate-limited",
        Option.some(status),
        answered,
        retryAtOf(response.headers["retry-after"], yield* DateTime.now),
      );
    }
    if (status < 200 || status > 299) {
      return yield* failure("failed", Option.some(status), answered);
    }
    const text = yield* response.text.pipe(
      Effect.mapError(() =>
        failure(
          "unreachable",
          Option.some(status),
          `${call.provider}'s usage answer broke off.`,
        ),
      ),
    );
    const json = parseJson(text);
    if (Option.isNone(json)) {
      return yield* unreadable(status, "it is not JSON");
    }
    const answer = decodeAt(call.answer, json.value, "");
    if (Result.isFailure(answer)) {
      return yield* unreadable(status, answer.failure);
    }
    const reading = call.reading(answer.success, yield* DateTime.now);
    if (Result.isFailure(reading)) {
      return yield* unreadable(status, reading.failure);
    }
    if (reading.success.windows.length === 0) {
      return yield* unreadable(status, "it gives no window");
    }
    return reading.success;
  }).pipe(
    Effect.timeoutOrElse({
      duration: longestCall,
      orElse: () =>
        Effect.fail(
          failure(
            "unreachable",
            Option.none(),
            `${call.provider}'s usage endpoint did not answer within 10 seconds.`,
          ),
        ),
    }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.updateService(Headers.CurrentRedactedNames, (names) => [
      ...names,
      ...Object.keys(call.headers ?? {}),
    ]),
    Effect.withSpan("UsageEndpoint.read"),
  );
