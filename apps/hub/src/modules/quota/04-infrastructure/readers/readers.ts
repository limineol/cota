import { BunHttpClient } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpClient } from "effect/http";
import { QuotaReader } from "#modules/quota/02-application/interfaces/quota-reader.ts";
import * as Anthropic from "./anthropic.ts";
import * as ChatGpt from "./chatgpt.ts";
import * as OpenCodeGo from "./opencode-go.ts";
import * as Zai from "./zai.ts";

const heldKeyReaders = { zai: Zai.read, "opencode-go": OpenCodeGo.read };

/** Where the usage endpoints read with a quota login are; replaced only by tests. */
export interface Endpoints {
  readonly anthropic: string;
  readonly chatgpt: string;
}

export const endpoints: Endpoints = {
  anthropic: Anthropic.endpoint,
  chatgpt: ChatGpt.endpoint,
};

// A usage endpoint that redirects is answered as its status: following it
// could carry a held key or a quota login to another host.
const usageEndpoints = BunHttpClient.layerOptions({ redirect: "manual" });

/** The quota readers over HTTP, one adapter per provider. */
export const layer = (
  options: Endpoints = endpoints,
): Layer.Layer<QuotaReader> =>
  Layer.effect(
    QuotaReader,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      return QuotaReader.of({
        read: (_pool, reader) => {
          if ("key" in reader) {
            return heldKeyReaders[reader.name](
              http,
              reader.baseUrl,
              reader.key,
            );
          }
          const login = reader.login;
          return login.provider === "anthropic"
            ? Anthropic.read(http, options.anthropic, login)
            : ChatGpt.read(http, options.chatgpt, login);
        },
      });
    }),
  ).pipe(Layer.provide(usageEndpoints));
