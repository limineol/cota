import { Context, Effect, Layer, Option, Result } from "effect";
import { Files } from "#02-application/interfaces/files.ts";
import {
  type ClientPlan,
  PlanClientFiles,
  type Which,
} from "#02-application/queries/plan-client-files.query.ts";
import { providerPrefix } from "#03-domain/client-files.ts";
import type { Paths } from "#03-domain/paths.ts";

/** A file configuring left as it was, and why. */
export interface Left {
  readonly file: string;
  readonly reason: string;
}

/** What configuring did, one line each, and the files it left as they were. */
export interface Configured {
  readonly said: ReadonlyArray<string>;
  readonly left: ReadonlyArray<Left>;
}

/** A file left as it was, as one line. */
export const leftLine = ({ file, reason }: Left): string =>
  `cota: left ${file} as it was: ${reason}.`;

export class ConfigureClients extends Context.Service<
  ConfigureClients,
  {
    /**
     * Rewrites `cota`'s part of each client's file the plan names, each
     * atomically, keeping its mode (Codex's 0600), and only when it changes
     * (`docs/specs/cli/spec.md`, Configuring); it says in one line per file
     * what it did, or why it left the file as it was.
     */
    readonly execute: (paths: Paths, which: Which) => Effect.Effect<Configured>;
  }
>()("@cota/cli/ConfigureClients") {}

const listed = (providers: ReadonlyArray<string>) =>
  `${providers.length === 1 ? "provider" : "providers"} ${
    providers.length <= 1
      ? providers.join("")
      : `${providers.slice(0, -1).join(", ")} and ${providers.at(-1)}`
  }`;

const newFileMode = 0o644;
const codexMode = 0o600;
const directoryMode = 0o755;
const codexDirectoryMode = 0o700;

export const layer: Layer.Layer<
  ConfigureClients,
  never,
  Files | PlanClientFiles
> = Layer.effect(
  ConfigureClients,
  Effect.gen(function* () {
    const files = yield* Files;
    const plan = yield* PlanClientFiles;

    const write = Effect.fn(function* (each: ClientPlan, text: string) {
      const codex = each.client === "codex";
      if (Option.isNone(yield* files.modeOf(each.directory))) {
        yield* files.makeDirectory(
          each.directory,
          codex ? codexDirectoryMode : directoryMode,
        );
      }
      const mode = codex
        ? codexMode
        : Option.getOrElse(yield* files.modeOf(each.file), () => newFileMode);
      yield* files.write(each.file, text, mode);
    });

    return ConfigureClients.of({
      execute: Effect.fn("ConfigureClients.execute")(function* (
        paths: Paths,
        which: Which,
      ) {
        const { plans, notes } = yield* plan.execute(paths, which);
        const said: Array<string> = [...notes];
        const left: Array<Left> = [];
        if (plans.length === 0 && which._tag === "Asked") {
          said.push(
            "cota: none of codex, opencode and pi is installed; there was nothing to configure.",
          );
        }
        for (const each of plans) {
          if (Result.isFailure(each.after)) {
            left.push({ file: each.file, reason: each.after.failure.reason });
            continue;
          }
          const text = each.after.success;
          const providers = listed(
            each.pools.map((pool) => `${providerPrefix}${pool}`),
          );
          if (text === Option.getOrElse(each.before, () => "")) {
            if (which._tag === "Asked") {
              said.push(
                each.pools.length === 0
                  ? `cota: ${each.file} needs no provider of cota's; nothing changed.`
                  : `cota: ${each.file} has cota's ${providers} already; nothing changed.`,
              );
            }
            continue;
          }
          const written = yield* Effect.result(write(each, text));
          if (Result.isFailure(written)) {
            left.push({
              file: each.file,
              reason: `${written.failure.path} could not be written: ${written.failure.reason}`,
            });
            continue;
          }
          said.push(
            each.pools.length === 0
              ? `cota: removed cota's providers from ${each.file}.`
              : `cota: wrote ${each.file}, with cota's ${providers}.`,
          );
        }
        return { said, left };
      }),
    });
  }),
);
