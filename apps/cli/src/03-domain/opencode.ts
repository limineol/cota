import type { Option, Result } from "effect";
import {
  type KeyedProvider,
  providerPrefix,
  type WrittenModel,
} from "./client-files.ts";
import * as JsonFile from "./json-file.ts";

/** The key of OpenCode's providers in `opencode.json`. */
export const container = "provider";

const modelOf = (model: WrittenModel) => ({
  name: model.name,
  ...(model.context !== null && model.output !== null
    ? { limit: { context: model.context, output: model.output } }
    : {}),
  ...(model.cost === null
    ? {}
    : {
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cache_read: model.cost.cacheRead,
          cache_write: model.cost.cacheWrite,
        },
      }),
  ...(model.images === true ? { attachment: true } : {}),
});

const written = (models: ReadonlyArray<WrittenModel>) =>
  Object.fromEntries(models.map((model) => [model.id, modelOf(model)]));

/** A keyed pool's provider as OpenCode reads it, its key read from the keyed hub key's file. */
const providerOf =
  (provider: KeyedProvider, keyFile: string) =>
  (existing: Option.Option<unknown>) => ({
    npm: "@ai-sdk/openai-compatible",
    name: `${provider.name} · Cota`,
    options: {
      baseURL: `${provider.hub}/pools/${provider.pool}`,
      apiKey: `{file:${keyFile}}`,
      headers: {
        "x-cota-machine": provider.machine,
        "x-cota-client": "opencode",
        "x-cota-project": "{env:COTA_PROJECT}",
      },
    },
    models: JsonFile.modelsOf(provider.models, existing, written),
  });

/** OpenCode's `opencode.json` with exactly the providers given as `cota`'s (`JsonFile.rewrite`). */
export const rewrite = (
  text: string,
  providers: ReadonlyArray<KeyedProvider>,
  keyFile: string,
): Result.Result<string, string> =>
  JsonFile.rewrite(
    text,
    container,
    providers.map((provider) => ({
      key: `${providerPrefix}${provider.pool}`,
      providerOf: providerOf(provider, keyFile),
    })),
  );
