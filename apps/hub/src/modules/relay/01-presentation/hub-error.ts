import { HttpServerResponse } from "effect/http";

const statuses = {
  cota_hub_key_rejected: 403,
  cota_hub_key_scope: 403,
  cota_unknown_pool: 404,
  cota_unknown_path: 404,
  cota_body_too_large: 413,
  cota_no_websocket: 426,
  cota_provider_unreachable: 502,
  cota_provider_timeout: 504,
} as const;

export type Type = keyof typeof statuses;

export interface HubError {
  readonly type: Type;
  readonly message: string;
}

export const statusOf = (error: HubError): number => statuses[error.type];

/**
 * The hub's own answer, which both Anthropic's and OpenAI's client libraries
 * can show; it is never a 401, which Codex and Claude Code take to mean their
 * login is bad.
 */
export const response = (
  error: HubError,
  headers: Readonly<Record<string, string>> = {},
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(
    { type: "error", error: { type: error.type, message: error.message } },
    {
      status: statusOf(error),
      headers: { ...headers, "x-should-retry": "false" },
    },
  );
