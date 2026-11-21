import { DateTime, Duration, Option, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import {
  type QuotaLogin,
  Token,
} from "#modules/quota/03-domain/quota-login.ts";
import * as TokenEndpoint from "./token-endpoint.ts";

/** Claude Code's public OAuth client, which issued the logins. */
export const clientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export const endpoint = "https://platform.claude.com/v1/oauth/token";

const Answer = Schema.Struct({
  access_token: Token,
  expires_in: Schema.Finite.check(Schema.isGreaterThan(0)),
  refresh_token: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.Literal(""), Token])),
  ),
});

const Refusal = Schema.Struct({ error: Schema.Literal("invalid_grant") });

/** Refreshes a Claude quota login as Claude Code does (`docs/specs/quota-logins/spec.md`, Refreshing). */
export const refresh = (
  http: HttpClient.HttpClient,
  url: string,
  login: QuotaLogin,
) =>
  TokenEndpoint.refresh(http, {
    provider: "Anthropic",
    url,
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: Redacted.value(login.refreshToken),
      client_id: clientId,
    }).toString(),
    answer: Answer,
    refuses: (_status, body) =>
      Option.isSome(Option.flatMap(body, Schema.decodeUnknownOption(Refusal))),
    refreshed: (answer, now) =>
      Option.match(
        DateTime.make(
          DateTime.toEpochMillis(now) +
            Duration.toMillis(Duration.seconds(answer.expires_in)),
        ),
        {
          onNone: () => Result.fail("expires_in is malformed"),
          onSome: (endsAt) =>
            Result.succeed({
              accessToken: Redacted.make(answer.access_token),
              refreshToken: Option.map(
                Option.filter(
                  Option.fromNullishOr(answer.refresh_token),
                  (token) => token !== "",
                ),
                (token) => Redacted.make(token),
              ),
              endsAt,
            }),
        },
      ),
  });
