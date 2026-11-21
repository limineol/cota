import { Option, Redacted } from "effect";
import type { Headers } from "effect/http";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import type { Credential } from "#modules/relay/03-domain/credential.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";

const connectionHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "host",
  "content-length",
]);

const credentialHeaders = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
]);

// Anthropic's API takes a key in x-api-key, and the providers that speak its
// protocol for a coding plan take a bearer token; a client configured as its
// provider says has put its own credential where the held key must go.
const replacing = (
  incoming: ClientRequest.Headers,
  credential: Credential,
): Option.Option<readonly [string, string]> => {
  switch (credential._tag) {
    case "Client":
      return Option.none();
    case "Held":
      return Option.map(credential.key, (key) =>
        (incoming["x-api-key"]?.trim() ?? "") === ""
          ? ["authorization", `Bearer ${Redacted.value(key)}`]
          : ["x-api-key", Redacted.value(key)],
      );
    case "Kept":
      return Option.some([
        "authorization",
        `Bearer ${Redacted.value(credential.login)}`,
      ]);
  }
};

export const forwarded = (
  incoming: ClientRequest.Headers,
  credential: Credential,
): Record<string, string> => {
  const outgoing: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (connectionHeaders.has(name)) continue;
    if (name.startsWith("x-cota-") || name === "cookie") continue;
    if (credential._tag !== "Client" && credentialHeaders.has(name)) continue;
    outgoing[name] = value;
  }
  if (outgoing["accept-encoding"] === undefined) {
    outgoing["accept-encoding"] = "identity";
  }
  const set = replacing(incoming, credential);
  if (Option.isSome(set)) {
    const [name, value] = set.value;
    outgoing[name] = value;
  }
  return outgoing;
};

export const answered = (
  provider: Headers.Headers,
  id: Request.RequestId,
): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(provider)) {
    if (connectionHeaders.has(name) || name === "set-cookie") continue;
    headers[name] = value;
  }
  headers["x-cota-request"] = id;
  return headers;
};

/**
 * Whether an answer is an event stream: its `content-type` says so, or it
 * has none, is not an error, and the request asked for a stream. ChatGPT's
 * Codex backend sends its event streams without a `content-type`.
 */
export const isEventStream = (
  answer: { readonly status: number; readonly headers: ClientRequest.Headers },
  asked: boolean,
): boolean => {
  const type = answer.headers["content-type"];
  if (type === undefined) return asked && answer.status < 400;
  return type.toLowerCase().startsWith("text/event-stream");
};
