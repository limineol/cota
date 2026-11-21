import { DateTime, Duration, Option, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { Instant } from "#modules/quota/03-domain/instant.ts";
import * as Plan from "#modules/quota/03-domain/plan.ts";
import type { QuotaLogin } from "#modules/quota/03-domain/quota-login.ts";
import type { QuotaReading } from "#modules/quota/03-domain/sources.ts";
import * as ProviderCall from "#modules/quota/04-infrastructure/provider-call.ts";
import { type Given, readingOf } from "./reading.ts";
import * as UsageEndpoint from "./usage-endpoint.ts";

/** Undocumented: the endpoint Claude Code's own usage screen reads. */
export const endpoint = "https://api.anthropic.com/api/oauth/usage";

const Window = Schema.optionalKey(
  Schema.NullOr(
    Schema.Struct({
      utilization: Schema.Finite,
      resets_at: Schema.NullOr(Instant),
    }),
  ),
);

const Answer = Schema.Struct({
  five_hour: Window,
  seven_day: Window,
  limits: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
});
type Answer = typeof Answer.Type;

/** What makes an entry of `limits` a model's weekly window. */
const ModelWeek = Schema.Struct({
  kind: Schema.Literal("weekly_scoped"),
  scope: Schema.Struct({
    model: Schema.Struct({ display_name: Schema.NonEmptyString }),
  }),
});

const Limit = Schema.Struct({
  percent: Schema.Finite,
  resets_at: Schema.NullOr(Instant),
});

const week = Duration.days(7);

const resetOf = (resetsAt: DateTime.Utc | null) =>
  Option.map(Option.fromNullishOr(resetsAt), DateTime.toEpochMillis);

const readingFrom =
  (plan: Option.Option<string>) =>
  (answer: Answer, at: DateTime.Utc): Result.Result<QuotaReading, string> => {
    const given: Array<Given> = [];
    for (const [name, length] of [
      ["five_hour", Duration.hours(5)],
      ["seven_day", week],
    ] as const) {
      const window = answer[name];
      if (window === undefined || window === null) continue;
      given.push({
        lengthMs: Duration.toMillis(length),
        scope: Option.none(),
        used: window.utilization,
        resetMs: resetOf(window.resets_at),
      });
    }
    for (const [index, value] of (answer.limits ?? []).entries()) {
      const model = Schema.decodeUnknownOption(ModelWeek)(value);
      if (Option.isNone(model)) continue;
      const limit = ProviderCall.decodeAt(Limit, value, `limits[${index}]`);
      if (Result.isFailure(limit)) return Result.fail(limit.failure);
      given.push({
        lengthMs: Duration.toMillis(week),
        scope: Option.some(model.value.scope.model.display_name),
        used: limit.success.percent,
        resetMs: resetOf(limit.success.resets_at),
      });
    }
    return Result.succeed(readingOf(given, plan, at));
  };

/** Reads a Claude subscription pool's windows with its quota login (`docs/specs/quota-readers/spec.md`, Anthropic). */
export const read = (
  http: HttpClient.HttpClient,
  url: string,
  login: Extract<QuotaLogin, { readonly provider: "anthropic" }>,
) =>
  UsageEndpoint.read(http, {
    provider: "Anthropic",
    url,
    credential: login.accessToken,
    headers: { "anthropic-beta": "oauth-2025-04-20" },
    answer: Answer,
    reading: readingFrom(
      Plan.claude(login.subscriptionType, login.rateLimitTier),
    ),
  });
