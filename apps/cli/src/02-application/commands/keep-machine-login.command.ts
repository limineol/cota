import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import { Files } from "#02-application/interfaces/files.ts";
import { Hub } from "#02-application/interfaces/hub.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import { LocateFiles } from "#02-application/queries/locate-files.query.ts";
import { ReadConfiguration } from "#02-application/queries/read-configuration.query.ts";
import { ReadHubKeys } from "#02-application/queries/read-hub-keys.query.ts";
import {
  HubUnreachable,
  hubDeadline,
  type OpenedPool,
} from "#03-domain/machine.ts";
import { loginFile } from "#03-domain/paths.ts";

/** A machine login that was not kept, and why; the reason never holds the login. */
export class LoginRefused extends Schema.TaggedError<
  LoginRefused,
  { readonly brand: unique symbol }
>()("LoginRefused", { problem: Schema.String }) {}

export class KeepMachineLogin extends Context.Service<
  KeepMachineLogin,
  {
    /**
     * Keeps a machine login for a pool (`docs/specs/cli/spec.md`, Machine
     * logins): read from standard input or a prompt that does not echo, kept
     * only when the hub says the pool is a subscription pool of
     * `anthropic-messages`, in `logins/<pool>`, mode 0600.
     */
    readonly execute: (pool: string) => Effect.Effect<void, LoginRefused>;
  }
>()("@cota/cli/KeepMachineLogin") {}

const claudeProtocol = "anthropic-messages";

export const layer: Layer.Layer<
  KeepMachineLogin,
  never,
  Files | Hub | Terminal | LocateFiles | ReadConfiguration | ReadHubKeys
> = Layer.effect(
  KeepMachineLogin,
  Effect.gen(function* () {
    const files = yield* Files;
    const hub = yield* Hub;
    const terminal = yield* Terminal;
    const locate = yield* LocateFiles;
    const readConfiguration = yield* ReadConfiguration;
    const readHubKeys = yield* ReadHubKeys;
    const refuse = (problem: string) =>
      Effect.fail(new LoginRefused({ problem }));

    const loginGiven = Effect.gen(function* () {
      if (terminal.interactive) {
        return (yield* terminal.secret(
          "Machine login (from claude setup-token): ",
        )).trim();
      }
      const lines = (yield* terminal.input)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      return lines[0] ?? "";
    });

    return KeepMachineLogin.of({
      execute: Effect.fn("KeepMachineLogin.execute")(function* (pool: string) {
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
        const keys = yield* readHubKeys
          .execute(paths)
          .pipe(
            Effect.catchTag("FilesFailed", (error) =>
              refuse(`${error.path} cannot be read: ${error.reason}`),
            ),
          );
        const held = [keys.subscription, keys.keyed].flatMap((key) =>
          Option.isSome(key) ? [key.value] : [],
        );
        if (held.length === 0) {
          return yield* refuse(
            `this machine keeps no hub key to ask the hub with. Join again: cota join ${configuration.hub}`,
          );
        }
        const login = yield* loginGiven;
        if (login === "") {
          return yield* refuse(
            "no login was given: give the one claude setup-token printed, on standard input",
          );
        }
        const pools: Array<OpenedPool> = [];
        for (const key of held) {
          const machine = yield* Effect.result(
            hub.machine(configuration.hub, key).pipe(
              Effect.timeoutOrElse({
                duration: hubDeadline,
                orElse: () => Effect.fail(new HubUnreachable()),
              }),
            ),
          );
          if (Result.isFailure(machine)) {
            return yield* refuse(
              machine.failure._tag === "HubKeyUnknown"
                ? `${configuration.hub} does not know this machine's hub key. Join again: cota join ${configuration.hub}`
                : `${configuration.hub} could not say whether it has the pool ${pool}, so the login was not kept`,
            );
          }
          pools.push(...machine.success.pools);
        }
        const opened = pools.find((each) => each.id === pool);
        if (opened === undefined) {
          return yield* refuse(
            `${pool} is not a pool this machine's hub keys open`,
          );
        }
        if (
          opened.kind !== "subscription" ||
          opened.protocol !== claudeProtocol
        ) {
          return yield* refuse(
            `${pool} is a ${opened.kind} pool of ${opened.protocol}; a machine login is for a subscription pool of ${claudeProtocol}`,
          );
        }
        yield* Effect.gen(function* () {
          yield* files.makeDirectory(paths.configuration, 0o700);
          yield* files.makeDirectory(paths.logins, 0o700);
          yield* files.write(loginFile(paths, pool), `${login}\n`, 0o600);
        }).pipe(
          Effect.catchTag("FilesFailed", (error) =>
            refuse(`${error.path} could not be written: ${error.reason}`),
          ),
        );
      }),
    });
  }),
);
