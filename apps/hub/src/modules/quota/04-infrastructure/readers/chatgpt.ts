import { type DateTime, Option, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import * as Plan from "#modules/quota/03-domain/plan.ts";
import type { QuotaLogin } from "#modules/quota/03-domain/quota-login.ts";
import type { QuotaReading } from "#modules/quota/03-domain/sources.ts";
import * as ProviderCall from "#modules/quota/04-infrastructure/provider-call.ts";
import { type Given, readingOf } from "./reading.ts";
import * as UsageEndpoint from "./usage-endpoint.ts";

/** Undocumented: chatgpt.com's internal `backend-api`, which Codex's usage screen reads. */
export const endpoint = "https://chatgpt.com/backend-api/wham/usage";

const Window = Schema.optionalKey(
  Schema.NullOr(
    Schema.Struct({
      used_percent: Schema.Finite,
      limit_window_seconds: Schema.Int,
      reset_at: Schema.Int,
    }),
  ),
);

const Limit = Schema.Struct({
  primary_window: Window,
  secondary_window: Window,
});
type Limit = typeof Limit.Type;

const Name = Schema.optionalKey(Schema.NullOr(Schema.String));

const Answer = Schema.Struct({
  plan_type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rate_limit: Schema.optionalKey(Schema.NullOr(Limit)),
  additional_rate_limits: Schema.optionalKey(
    Schema.NullOr(Schema.Array(Schema.Unknown)),
  ),
});
type Answer = typeof Answer.Type;

const Names = Schema.Struct({ limit_name: Name, metered_feature: Name });

const Additional = Schema.Struct({
  rate_limit: Schema.optionalKey(Schema.NullOr(Limit)),
});

const windowsOf = (
  limit: Limit | null | undefined,
  scope: Option.Option<string>,
): ReadonlyArray<Given> =>
  [limit?.primary_window, limit?.secondary_window].flatMap((window) =>
    window === undefined || window === null
      ? []
      : [
          {
            lengthMs: window.limit_window_seconds * 1000,
            scope,
            used: window.used_percent,
            resetMs: Option.some(window.reset_at * 1000),
          },
        ],
  );

const nameOf = (name: string | null | undefined) =>
  Option.filter(Option.fromNullishOr(name), (name) => name !== "");

const readingFrom = (
  answer: Answer,
  at: DateTime.Utc,
): Result.Result<QuotaReading, string> => {
  const given = [...windowsOf(answer.rate_limit, Option.none())];
  for (const [index, value] of (
    answer.additional_rate_limits ?? []
  ).entries()) {
    const path = `additional_rate_limits[${index}]`;
    const names = ProviderCall.decodeAt(Names, value, path);
    if (Result.isFailure(names)) return Result.fail(names.failure);
    const name = Option.orElse(nameOf(names.success.limit_name), () =>
      nameOf(names.success.metered_feature),
    );
    if (Option.isNone(name)) continue;
    const extra = ProviderCall.decodeAt(Additional, value, path);
    if (Result.isFailure(extra)) return Result.fail(extra.failure);
    given.push(...windowsOf(extra.success.rate_limit, name));
  }
  return Result.succeed(
    readingOf(
      given,
      Option.flatMap(Option.fromNullishOr(answer.plan_type), Plan.chatGpt),
      at,
    ),
  );
};

/** Reads a ChatGPT subscription pool's windows with its quota login (`docs/specs/quota-readers/spec.md`, ChatGPT). */
export const read = (
  http: HttpClient.HttpClient,
  url: string,
  login: Extract<QuotaLogin, { readonly provider: "chatgpt" }>,
) =>
  UsageEndpoint.read(http, {
    provider: "ChatGPT",
    url,
    credential: login.accessToken,
    headers: { "chatgpt-account-id": Redacted.value(login.accountId) },
    answer: Answer,
    reading: readingFrom,
  });
