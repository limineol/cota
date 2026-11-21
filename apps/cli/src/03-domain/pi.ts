import type { Option, Result } from "effect";
import {
  type KeyedProvider,
  providerPrefix,
  type WrittenModel,
} from "./client-files.ts";
import * as JsonFile from "./json-file.ts";
import { shellQuoted } from "./shims.ts";
import type { System } from "./system.ts";

/** The key of Pi's providers in `models.json`. */
export const container = "providers";

/**
 * The key Pi is given: a command, which Pi runs for a key that starts with
 * `!`, that prints the keyed hub key; `cota`'s path quoted as the system's
 * shell reads it.
 */
export const keyCommandOf = (system: System, cota: string): string =>
  `!${system === "win32" ? `"${cota}"` : shellQuoted(cota)} hub-key keyed`;

const modelOf = (model: WrittenModel) => ({
  id: model.id,
  name: model.name,
  input: model.images === true ? ["text", "image"] : ["text"],
  ...(model.context === null ? {} : { contextWindow: model.context }),
  ...(model.output === null ? {} : { maxTokens: model.output }),
  ...(model.cost === null ? {} : { cost: model.cost }),
});

const written = (models: ReadonlyArray<WrittenModel>) => models.map(modelOf);

const providerOf =
  (provider: KeyedProvider, keyCommand: string) =>
  (existing: Option.Option<unknown>) => ({
    name: `${provider.name} · Cota`,
    baseUrl: `${provider.hub}/pools/${provider.pool}`,
    api: "openai-completions",
    apiKey: keyCommand,
    headers: {
      "x-cota-machine": provider.machine,
      "x-cota-client": "pi",
      "x-cota-project": "$COTA_PROJECT",
    },
    compat: {
      sendSessionAffinityHeaders: true,
      sessionAffinityFormat: "openai",
    },
    models: JsonFile.modelsOf(provider.models, existing, written),
  });

/** Pi's `models.json` with exactly the providers given as `cota`'s (`JsonFile.rewrite`). */
export const rewrite = (
  text: string,
  providers: ReadonlyArray<KeyedProvider>,
  keyCommand: string,
): Result.Result<string, string> =>
  JsonFile.rewrite(
    text,
    container,
    providers.map((provider) => ({
      key: `${providerPrefix}${provider.pool}`,
      providerOf: providerOf(provider, keyCommand),
    })),
  );
