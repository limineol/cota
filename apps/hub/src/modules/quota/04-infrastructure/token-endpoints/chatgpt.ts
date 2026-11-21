import { Option, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import {
  chatGptEndsAt,
  type QuotaLogin,
  Token,
} from "#modules/quota/03-domain/quota-login.ts";
import * as TokenEndpoint from "./token-endpoint.ts";

/** Codex's public OAuth client, which issued the logins. */
export const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";

export const endpoint = "https://auth.openai.com/oauth/token";

const Answer = Schema.Struct({
  access_token: Token,
  refresh_token: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.Literal(""), Token])),
  ),
});

/** The error codes with which OpenAI refuses a refresh token, as Codex reads them. */
const refusals = [
  "invalid_grant",
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
];

const ErrorCode = Schema.Union([
  Schema.Struct({ error: Schema.Struct({ code: Schema.String }) }),
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({ code: Schema.String }),
]);

const codeOf = (body: unknown): Option.Option<string> =>
  Option.map(Schema.decodeUnknownOption(ErrorCode)(body), (decoded) =>
    "code" in decoded
      ? decoded.code
      : typeof decoded.error === "string"
        ? decoded.error
        : decoded.error.code,
  );

/** Refreshes a ChatGPT quota login as Codex does (`docs/specs/quota-logins/spec.md`, Refreshing). */
export const refresh = (
  http: HttpClient.HttpClient,
  url: string,
  login: QuotaLogin,
) =>
  TokenEndpoint.refresh(http, {
    provider: "OpenAI",
    url,
    contentType: "application/json",
    body: JSON.stringify({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: Redacted.value(login.refreshToken),
    }),
    answer: Answer,
    refuses: (status, body) =>
      status === 401 ||
      Option.exists(Option.flatMap(body, codeOf), (code) =>
        refusals.includes(code.toLowerCase()),
      ),
    refreshed: (answer, now) => {
      const accessToken = Redacted.make(answer.access_token);
      return Result.succeed({
        accessToken,
        refreshToken: Option.map(
          Option.filter(
            Option.fromNullishOr(answer.refresh_token),
            (token) => token !== "",
          ),
          (token) => Redacted.make(token),
        ),
        endsAt: chatGptEndsAt(accessToken, now),
      });
    },
  });
