import { BunHttpClient } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { TokenEndpoints } from "#modules/quota/02-application/interfaces/token-endpoints.ts";
import * as Anthropic from "./anthropic.ts";
import * as ChatGpt from "./chatgpt.ts";

/** Where each provider's token endpoint is; replaced only by tests. */
export interface Endpoints {
  readonly anthropic: string;
  readonly chatgpt: string;
}

export const endpoints: Endpoints = {
  anthropic: Anthropic.endpoint,
  chatgpt: ChatGpt.endpoint,
};

// A token endpoint that redirects is answered as its status: following it
// could carry a refresh token to another host.
const tokenEndpoints = BunHttpClient.layerOptions({ redirect: "manual" });

/** The token endpoints over HTTP, one adapter per provider. */
export const layer = (
  options: Endpoints = endpoints,
): Layer.Layer<TokenEndpoints> =>
  Layer.effect(
    TokenEndpoints,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      return TokenEndpoints.of({
        refresh: (login) =>
          login.provider === "anthropic"
            ? Anthropic.refresh(http, options.anthropic, login)
            : ChatGpt.refresh(http, options.chatgpt, login),
      });
    }),
  ).pipe(Layer.provide(tokenEndpoints));
