import { Context, Effect, Layer, Redacted, Result, Schema } from "effect";
import { Files } from "#02-application/interfaces/files.ts";
import { Hub } from "#02-application/interfaces/hub.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";
import { ReadConfiguration } from "#02-application/queries/read-configuration.query.ts";
import { HubUnreachable, hubDeadline } from "#03-domain/machine.ts";
import { readerKeyFile } from "#03-domain/paths.ts";

/** A reader key that was not kept, and why; the reason never holds the key. */
export class ReaderKeyRefused extends Schema.TaggedError<
  ReaderKeyRefused,
  { readonly brand: unique symbol }
>()("ReaderKeyRefused", { problem: Schema.String }) {}

export class KeepReaderKey extends Context.Service<
  KeepReaderKey,
  {
    /**
     * Keeps the machine's reader key (`docs/specs/memory-skill/spec.md`,
     * `cota memory`): read from standard input or a prompt that does not
     * echo, kept only when the hub knows it as a reader key, in
     * `hub-keys/reader`, mode 0600.
     */
    readonly execute: Effect.Effect<void, ReaderKeyRefused>;
  }
>()("@cota/cli/KeepReaderKey") {}

export const layer: Layer.Layer<
  KeepReaderKey,
  never,
  Files | Hub | Terminal | LocateFiles | ReadConfiguration
> = Layer.effect(
  KeepReaderKey,
  Effect.gen(function* () {
    const files = yield* Files;
    const hub = yield* Hub;
    const terminal = yield* Terminal;
    const locate = yield* LocateFiles;
    const readConfiguration = yield* ReadConfiguration;
    const refuse = (problem: string) =>
      Effect.fail(new ReaderKeyRefused({ problem }));

    const keyGiven = Effect.gen(function* () {
      if (terminal.interactive) {
        return (yield* terminal.secret("Reader key: ")).trim();
      }
      const lines = (yield* terminal.input)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      return lines[0] ?? "";
    });

    return KeepReaderKey.of({
      execute: Effect.gen(function* () {
        const paths = yield* locate.execute.pipe(
          Effect.catchTag("DirectoryUnknown", (error) =>
            refuse(
              `where the configuration is cannot be known: ${error.variable} is not set`,
            ),
          ),
        );
        const configuration = yield* readConfiguration.execute(paths).pipe(
          Effect.catchTags({
            NotJoined: () =>
              refuse(
                "this machine has not joined a hub. Join one: cota join <hub>",
              ),
            ConfigurationInvalid: (error) =>
              refuse(`${error.file} does not read:\n${error.problems}`),
            FilesFailed: (error) =>
              refuse(`${error.path} cannot be read: ${error.reason}`),
          }),
        );
        const key = yield* keyGiven;
        if (key === "") {
          return yield* refuse(
            "no reader key was given: give it on standard input, or at the prompt",
          );
        }
        const machine = yield* Effect.result(
          hub.machine(configuration.hub, Redacted.make(key)).pipe(
            Effect.timeoutOrElse({
              duration: hubDeadline,
              orElse: () => Effect.fail(new HubUnreachable()),
            }),
          ),
        );
        if (Result.isFailure(machine)) {
          return yield* refuse(
            machine.failure._tag === "HubKeyUnknown"
              ? `${configuration.hub} does not know that key, so it was not kept`
              : `${configuration.hub} could not say what the key is, so it was not kept`,
          );
        }
        const { scope } = machine.success.hubKey;
        if (scope !== "reader") {
          return yield* refuse(
            `that is a ${scope} hub key; cota memory needs a reader key, which opens no pool`,
          );
        }
        yield* Effect.gen(function* () {
          yield* files.makeDirectory(paths.configuration, 0o700);
          yield* files.makeDirectory(paths.hubKeys, 0o700);
          yield* files.write(readerKeyFile(paths), `${key}\n`, 0o600);
        }).pipe(
          Effect.catchTag("FilesFailed", (error) =>
            refuse(`${error.path} could not be written: ${error.reason}`),
          ),
        );
      }).pipe(Effect.withSpan("KeepReaderKey.execute")),
    });
  }),
);
