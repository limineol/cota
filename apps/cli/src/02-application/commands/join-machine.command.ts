import {
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { Hub } from "#02-application/interfaces/hub.ts";
import type { Joined } from "#02-application/interfaces/machine-steps.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";
import { ReadConfiguration } from "#02-application/queries/read-configuration.query.ts";
import * as Configuration from "#03-domain/configuration.ts";
import * as HubAddress from "#03-domain/hub-address.ts";
import * as Join from "#03-domain/join.ts";
import {
  HubUnreachable,
  hubDeadline,
  type KeptScope,
  keptScopes,
} from "#03-domain/machine.ts";
import * as Paths from "#03-domain/paths.ts";

export interface JoinOptions {
  /** The hub's address as it was written. */
  readonly hub: string;
  /** The machine's name, when `--machine` gave one. */
  readonly machine: Option.Option<string>;
  readonly shims: boolean;
  readonly allowPlainHttp: boolean;
}

/** A join that stopped before writing anything, and every reason, none of which holds a key. */
export class JoinStopped extends Schema.TaggedError<
  JoinStopped,
  { readonly brand: unique symbol }
>()("JoinStopped", { problems: Schema.Array(Schema.String) }) {}

export interface JoinedMachine {
  readonly joined: Joined;
  /** The scopes of the hub keys kept, in the order of `keptScopes`. */
  readonly kept: ReadonlyArray<KeptScope>;
  /** Whether the join wrote or removed anything. */
  readonly changed: boolean;
}

export class JoinMachine extends Context.Service<
  JoinMachine,
  {
    /**
     * Joins the machine to a hub, up to and including writing its files
     * (`docs/specs/cli/spec.md`, Joining, steps 1 to 4): the address, the
     * hub keys read from the terminal and shown to the hub, and then the
     * configuration and the keys. It writes nothing unless every key is
     * accepted, and nothing that is already there.
     */
    readonly execute: (
      options: JoinOptions,
    ) => Effect.Effect<JoinedMachine, JoinStopped>;
  }
>()("@cota/cli/JoinMachine") {}

const keyQuestion = "Hub key (an empty line ends): ";

export const layer: Layer.Layer<
  JoinMachine,
  never,
  Environment | Files | Hub | Terminal | LocateFiles | ReadConfiguration
> = Layer.effect(
  JoinMachine,
  Effect.gen(function* () {
    const environment = yield* Environment;
    const files = yield* Files;
    const hub = yield* Hub;
    const terminal = yield* Terminal;
    const locate = yield* LocateFiles;
    const read = yield* ReadConfiguration;

    const stop = (...problems: ReadonlyArray<string>) =>
      Effect.fail(new JoinStopped({ problems }));

    const nameOf = (given: Option.Option<string>) => {
      if (Option.isSome(given)) return given.value;
      const host =
        environment.system === "win32"
          ? (environment.variables.COMPUTERNAME ?? "")
          : environment.hostName;
      return (host.split(".")[0] ?? "").toLowerCase();
    };

    const keysGiven = Effect.gen(function* () {
      if (!terminal.interactive) {
        return (yield* terminal.input)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== "");
      }
      const keys: Array<string> = [];
      for (;;) {
        const key = (yield* terminal.secret(keyQuestion)).trim();
        if (key === "") return keys;
        keys.push(key);
      }
    });

    const writeIfChanged = Effect.fn(function* (path: string, text: string) {
      const before = yield* files.read(path);
      if (Option.contains(before, text)) return false;
      yield* files.write(path, text, 0o600);
      return true;
    });

    return JoinMachine.of({
      execute: Effect.fn("JoinMachine.execute")(function* (
        options: JoinOptions,
      ) {
        const address = HubAddress.read(options.hub, options.allowPlainHttp);
        if (Result.isFailure(address)) return yield* stop(address.failure);
        const hubAddress = address.success;

        const machine = nameOf(options.machine);
        if (!Configuration.isMachineName(machine)) {
          return yield* stop(
            Option.isSome(options.machine)
              ? `a machine's name is 1 to ${Configuration.longestMachineName} characters`
              : "this machine's host name is empty: name the machine with --machine <name>",
          );
        }

        const located = yield* Effect.result(locate.execute);
        if (Result.isFailure(located)) {
          return yield* stop(
            `where the configuration goes cannot be known: ${located.failure.variable} is not set`,
          );
        }
        const paths = located.success;

        const keys = yield* keysGiven;
        if (keys.length === 0) {
          return yield* stop(
            "no hub key was given: give one a line on standard input",
          );
        }

        const answers: Array<Join.KeyAnswer> = [];
        for (const key of keys) {
          const answer = yield* Effect.result(
            hub.machine(hubAddress, Redacted.make(key)).pipe(
              Effect.timeoutOrElse({
                duration: hubDeadline,
                orElse: () => Effect.fail(new HubUnreachable()),
              }),
            ),
          );
          if (Result.isSuccess(answer)) {
            answers.push({ _tag: "Known", scope: answer.success.hubKey.scope });
          } else if (answer.failure._tag === "HubUnreachable") {
            return yield* stop(`${hubAddress} cannot be reached`);
          } else if (answer.failure._tag === "HubKeyUnknown") {
            answers.push({ _tag: "Unknown" });
          } else {
            answers.push({ _tag: "Failed" });
          }
        }
        const toKeep = Join.keysToKeep(answers);
        if (Result.isFailure(toKeep)) return yield* stop(...toKeep.failure);

        const before = Result.getSuccess(
          yield* Effect.result(read.execute(paths)),
        );
        const configuration: Configuration.Configuration = {
          hub: hubAddress,
          machine,
          ...(options.allowPlainHttp ? { allow_plain_http: true } : {}),
          ...(options.shims ? {} : { shims: false }),
          ...Option.match(before, {
            onNone: () => ({}),
            onSome: ({ launch, clients }) => ({
              ...(launch === undefined ? {} : { launch }),
              ...(clients === undefined ? {} : { clients }),
            }),
          }),
        };

        const written = yield* Effect.gen(function* () {
          yield* files.makeDirectory(paths.configuration, 0o700);
          yield* files.makeDirectory(paths.hubKeys, 0o700);
          const changes = [
            yield* writeIfChanged(
              paths.configurationFile,
              Configuration.textOf(configuration),
            ),
          ];
          for (const scope of keptScopes) {
            const file = Paths.hubKeyFile(paths, scope);
            const kept = toKeep.success.find((each) => each.scope === scope);
            const key = kept === undefined ? undefined : keys[kept.place];
            changes.push(
              key === undefined
                ? yield* files.remove(file)
                : yield* writeIfChanged(file, `${key}\n`),
            );
          }
          return changes.includes(true);
        }).pipe(
          Effect.catchTag("FilesFailed", (error) =>
            stop(`${error.path} could not be written: ${error.reason}`),
          ),
        );

        return {
          joined: { configuration, paths, shims: options.shims },
          kept: keptScopes.filter((scope) =>
            toKeep.success.some((each) => each.scope === scope),
          ),
          changed: written,
        };
      }),
    });
  }),
);
