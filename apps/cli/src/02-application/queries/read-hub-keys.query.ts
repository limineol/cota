import { Context, Effect, Layer, Option, Redacted } from "effect";
import { Files, type FilesFailed } from "#02-application/interfaces/files.ts";
import type { HubKeys } from "#03-domain/machine.ts";
import * as Paths from "#03-domain/paths.ts";

export class ReadHubKeys extends Context.Service<
  ReadHubKeys,
  {
    /** The machine's hub keys, each trimmed; a file that is missing or holds only spaces is none. */
    readonly execute: (
      paths: Paths.Paths,
    ) => Effect.Effect<HubKeys, FilesFailed>;
    /** The reader key `cota memory key` kept, read the same way. */
    readonly reader: (
      paths: Paths.Paths,
    ) => Effect.Effect<Option.Option<Redacted.Redacted<string>>, FilesFailed>;
  }
>()("@cota/cli/ReadHubKeys") {}

export const layer: Layer.Layer<ReadHubKeys, never, Files> = Layer.effect(
  ReadHubKeys,
  Effect.gen(function* () {
    const files = yield* Files;
    const keyIn = Effect.fn(function* (path: string) {
      const text = yield* files.read(path);
      return Option.flatMap(text, (each) => {
        const key = each.trim();
        return key === "" ? Option.none() : Option.some(Redacted.make(key));
      });
    });
    return ReadHubKeys.of({
      execute: Effect.fn("ReadHubKeys.execute")(function* (paths: Paths.Paths) {
        return {
          subscription: yield* keyIn(Paths.hubKeyFile(paths, "subscription")),
          keyed: yield* keyIn(Paths.hubKeyFile(paths, "keyed")),
        };
      }),
      reader: (paths) =>
        keyIn(Paths.readerKeyFile(paths)).pipe(
          Effect.withSpan("ReadHubKeys.reader"),
        ),
    });
  }),
);
