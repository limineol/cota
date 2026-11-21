import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Files } from "#02-application/interfaces/files.ts";
import { Hub, type TranscriptOf } from "#02-application/interfaces/hub.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";
import { ReadConfiguration } from "#02-application/queries/read-configuration.query.ts";
import type { HubAddress } from "#03-domain/hub-address.ts";
import {
  type HubFailed,
  HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";
import {
  type Ask,
  HubAnswered,
  memoryDeadline,
  type TranscriptRead,
} from "#03-domain/memory.ts";
import { readerKeyFile } from "#03-domain/paths.ts";

/** What `cota memory` could not read, and why; the problem never holds the reader key. */
export class MemoryUnread extends Schema.TaggedError<
  MemoryUnread,
  { readonly brand: unique symbol }
>()("MemoryUnread", { problem: Schema.String }) {}

export class ReadMemory extends Context.Service<
  ReadMemory,
  {
    /** Sends an ask to the machine's hub with its reader key, and gives the body of a successful answer as the hub gave it. */
    readonly ask: (ask: Ask) => Effect.Effect<string, MemoryUnread>;
    /** Reads a session's or a request's transcript with the machine's reader key. */
    readonly transcript: (
      of: TranscriptOf,
    ) => Effect.Effect<TranscriptRead, MemoryUnread>;
  }
>()("@cota/cli/ReadMemory") {}

const problemOf = (
  hub: HubAddress,
  error: HubUnreachable | HubKeyUnknown | HubAnswered | HubFailed,
): string => {
  switch (error._tag) {
    case "HubUnreachable":
      return `${hub} cannot be reached, or did not answer within ${memoryDeadline}.`;
    case "HubKeyUnknown":
      return `${hub} does not know this machine's reader key; the owner gives it again with cota memory key.`;
    case "HubAnswered":
      return `the hub answered ${error.status}: ${error.text}`;
    case "HubFailed":
      return `${hub} answered what cota cannot read.`;
  }
};

export const layer: Layer.Layer<
  ReadMemory,
  never,
  Files | Hub | LocateFiles | ReadConfiguration
> = Layer.effect(
  ReadMemory,
  Effect.gen(function* () {
    const files = yield* Files;
    const hub = yield* Hub;
    const locate = yield* LocateFiles;
    const readConfiguration = yield* ReadConfiguration;
    const refuse = (problem: string) =>
      Effect.fail(new MemoryUnread({ problem }));

    const withReaderKey = Effect.gen(function* () {
      const paths = yield* locate.execute.pipe(
        Effect.catchTag("DirectoryUnknown", (error) =>
          refuse(
            `where the configuration is cannot be known: ${error.variable} is not set.`,
          ),
        ),
      );
      const configuration = yield* readConfiguration.execute(paths).pipe(
        Effect.catchTags({
          NotJoined: () =>
            refuse(
              "this machine has not joined a hub, so it has no memory to read.",
            ),
          ConfigurationInvalid: (error) =>
            refuse(`${error.file} does not read:\n${error.problems}`),
          FilesFailed: (error) =>
            refuse(`${error.path} cannot be read: ${error.reason}`),
        }),
      );
      const text = yield* files
        .read(readerKeyFile(paths))
        .pipe(
          Effect.catchTag("FilesFailed", (error) =>
            refuse(`${error.path} cannot be read: ${error.reason}`),
          ),
        );
      const key = Option.getOrElse(text, () => "").trim();
      if (key === "") {
        return yield* refuse(
          "this machine keeps no reader key; the owner gives it one with cota memory key.",
        );
      }
      return { hub: configuration.hub, key: Redacted.make(key) };
    });

    const inTime = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: memoryDeadline,
          orElse: () => Effect.fail(new HubUnreachable()),
        }),
      );

    return ReadMemory.of({
      ask: Effect.fn("ReadMemory.ask")(function* (ask: Ask) {
        const { hub: address, key } = yield* withReaderKey;
        const answered = yield* inTime(hub.ask(address, key, ask)).pipe(
          Effect.mapError(
            (error) => new MemoryUnread({ problem: problemOf(address, error) }),
          ),
        );
        if (answered.status === 401) {
          return yield* refuse(problemOf(address, new HubKeyUnknown()));
        }
        if (answered.status >= 400) {
          return yield* refuse(
            problemOf(
              address,
              new HubAnswered({ status: answered.status, text: answered.body }),
            ),
          );
        }
        return answered.body;
      }),
      transcript: Effect.fn("ReadMemory.transcript")(function* (
        of: TranscriptOf,
      ) {
        const { hub: address, key } = yield* withReaderKey;
        return yield* inTime(hub.transcript(address, key, of)).pipe(
          Effect.mapError(
            (error) => new MemoryUnread({ problem: problemOf(address, error) }),
          ),
        );
      }),
    });
  }),
);
