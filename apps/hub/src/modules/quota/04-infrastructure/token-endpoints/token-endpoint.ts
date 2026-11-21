import { DateTime, Effect, Option, Result, type Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { Refreshed } from "#modules/quota/02-application/interfaces/token-endpoints.ts";
import { RefreshRefused } from "#modules/quota/03-domain/quota-login.ts";
import type { ReadFailure } from "#modules/quota/03-domain/readings.ts";
import {
  decodeAt,
  failure,
  longestCall,
  parseJson,
  userAgent,
} from "#modules/quota/04-infrastructure/provider-call.ts";

/** One provider's call of its token endpoint, and how its answer becomes a refreshed login. */
export interface TokenCall<A> {
  /** Whose token endpoint it is, for people, in a failure's detail: `Anthropic`. */
  readonly provider: string;
  readonly url: string;
  readonly contentType: string;
  readonly body: string;
  readonly answer: Schema.Codec<A, unknown>;
  /** Whether a failed answer refuses the refresh token, from its status and its JSON body, if it has one. */
  readonly refuses: (status: number, body: Option.Option<unknown>) => boolean;
  /** The refreshed login a good answer gives at `now`; a failure is why it cannot be read. */
  readonly refreshed: (
    answer: A,
    now: DateTime.Utc,
  ) => Result.Result<Refreshed, string>;
}

/**
 * Calls a token endpoint once with `POST`, `Accept: application/json` and the
 * hub's user agent, abandoned after `longestCall` (U6), and turns its answer
 * into a refreshed login, a refusal, or a failure naming the token endpoint
 * that never holds its body.
 */
export const refresh = <A>(
  http: HttpClient.HttpClient,
  call: TokenCall<A>,
): Effect.Effect<Refreshed, ReadFailure | RefreshRefused> =>
  Effect.gen(function* () {
    const unreachable = failure(
      "unreachable",
      Option.none(),
      `${call.provider}'s token endpoint could not be reached.`,
    );
    const response = yield* http
      .execute(
        HttpClientRequest.post(call.url).pipe(
          HttpClientRequest.bodyText(call.body, call.contentType),
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeader("user-agent", userAgent),
        ),
      )
      .pipe(Effect.mapError(() => unreachable));
    const status = response.status;
    const text = yield* response.text.pipe(
      Effect.mapError(() =>
        failure(
          "unreachable",
          Option.some(status),
          `${call.provider}'s token answer broke off.`,
        ),
      ),
    );
    const json = parseJson(text);
    if (status < 200 || status > 299) {
      if (call.refuses(status, json)) return yield* new RefreshRefused();
      return yield* failure(
        "failed",
        Option.some(status),
        `${call.provider}'s token endpoint answered ${status}.`,
      );
    }
    const unreadable = (reason: string) =>
      failure(
        "unreadable",
        Option.some(status),
        `${call.provider}'s token answer could not be read: ${reason}.`,
      );
    if (Option.isNone(json)) return yield* unreadable("it is not JSON");
    const answer = decodeAt(call.answer, json.value, "");
    if (Result.isFailure(answer)) return yield* unreadable(answer.failure);
    const refreshed = call.refreshed(answer.success, yield* DateTime.now);
    if (Result.isFailure(refreshed)) {
      return yield* unreadable(refreshed.failure);
    }
    return refreshed.success;
  }).pipe(
    Effect.timeoutOrElse({
      duration: longestCall,
      orElse: () =>
        Effect.fail(
          failure(
            "unreachable",
            Option.none(),
            `${call.provider}'s token endpoint did not answer within 10 seconds.`,
          ),
        ),
    }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.withSpan("TokenEndpoint.refresh"),
  );
