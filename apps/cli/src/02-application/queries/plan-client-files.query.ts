import { Context, Effect, Layer, Option, Redacted, Result } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { Hub } from "#02-application/interfaces/hub.ts";
import * as ClientFiles from "#03-domain/client-files.ts";
import * as Codex from "#03-domain/codex.ts";
import type { Configuration } from "#03-domain/configuration.ts";
import { tagOf } from "#03-domain/launch.ts";
import {
  type HubFailed,
  type HubKeyUnknown,
  HubUnreachable,
  hubDeadline,
  type KeptScope,
  type OpenedPool,
} from "#03-domain/machine.ts";
import * as OpenCode from "#03-domain/opencode.ts";
import * as Paths from "#03-domain/paths.ts";
import * as Pi from "#03-domain/pi.ts";
import { FindCommand } from "./find-command.query.ts";
import { ReadHubKeys } from "./read-hub-keys.query.ts";

/** What `cota configure` would make of one client's file. */
export interface ClientPlan {
  readonly client: ClientFiles.ConfiguredClient;
  readonly directory: string;
  readonly file: string;
  /** The file's text, none when it does not exist. */
  readonly before: Option.Option<string>;
  /** The file's text after the rewrite, the same as before when nothing changes; or why the file is left as it was. */
  readonly after: Result.Result<string, Unwritten>;
  /** The pools whose providers the file has after the rewrite. */
  readonly pools: ReadonlyArray<string>;
}

/** Why a file is left as it was, and whether the fault is the file's own (it does not read, or holds what cota cannot rewrite) or the hub's. */
export interface Unwritten {
  readonly reason: string;
  readonly theFiles: boolean;
}

export interface Planned {
  readonly plans: ReadonlyArray<ClientPlan>;
  /** What else the rewrites would say: a pool whose models could not be listed. */
  readonly notes: ReadonlyArray<string>;
}

/**
 * Whose files to plan, and with which pools: each installed client's of
 * those named, with the pools the hub answers to the machine's keys; or, as
 * leaving does, each client's file that exists, with none.
 */
export type Which =
  | {
      readonly _tag: "Asked";
      readonly configuration: Configuration;
      readonly clients: ReadonlyArray<ClientFiles.ConfiguredClient>;
    }
  | { readonly _tag: "None" };

export class PlanClientFiles extends Context.Service<
  PlanClientFiles,
  {
    /** Reads each client's file and the hub's answers, and gives each file's rewrite; it writes nothing (`docs/specs/cli/spec.md`, Configuring). */
    readonly execute: (
      paths: Paths.Paths,
      which: Which,
    ) => Effect.Effect<Planned>;
  }
>()("@cota/cli/PlanClientFiles") {}

const codexProtocol = "chatgpt-codex";
const keyedProtocol = "openai-chat";

const unanswered = (
  hub: string,
  scope: KeptScope,
  error: HubUnreachable | HubKeyUnknown | HubFailed,
) => {
  switch (error._tag) {
    case "HubUnreachable":
      return `${hub} did not say which pools the ${scope} hub key opens within ${hubDeadline}`;
    case "HubKeyUnknown":
      return `${hub} does not know the ${scope} hub key; join again: cota join ${hub}`;
    case "HubFailed":
      return `${hub} could not say which pools the ${scope} hub key opens`;
  }
};

const unlisted = (error: HubUnreachable | HubKeyUnknown | HubFailed) => {
  switch (error._tag) {
    case "HubUnreachable":
      return `no answer within ${hubDeadline}`;
    case "HubKeyUnknown":
      return "the hub does not know the keyed hub key";
    case "HubFailed":
      return error.status === undefined
        ? "the hub's answer did not read"
        : `the hub answered ${error.status}`;
  }
};

export const layer: Layer.Layer<
  PlanClientFiles,
  never,
  Environment | Files | Hub | ReadHubKeys | FindCommand
> = Layer.effect(
  PlanClientFiles,
  Effect.gen(function* () {
    const { system, variables, program } = yield* Environment;
    const files = yield* Files;
    const hub = yield* Hub;
    const readHubKeys = yield* ReadHubKeys;
    const findCommand = yield* FindCommand;

    const withinDeadline = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: hubDeadline,
          orElse: () => Effect.fail(new HubUnreachable()),
        }),
      );

    const exists = (path: string) =>
      files.modeOf(path).pipe(
        Effect.map(Option.isSome),
        Effect.orElseSucceed(() => false),
      );

    const installed = Effect.fn(function* (
      paths: Paths.Paths,
      client: ClientFiles.ConfiguredClient,
      place: ClientFiles.ClientFile,
    ) {
      const command = yield* findCommand.execute(
        client,
        variables,
        Option.some(paths.shims),
      );
      return Option.isSome(command) || (yield* exists(place.directory));
    });

    const poolsOf = Effect.fn(function* (
      configuration: Configuration,
      key: Option.Option<Redacted.Redacted<string>>,
      scope: KeptScope,
      fits: (pool: OpenedPool) => boolean,
    ): Effect.fn.Return<Result.Result<ReadonlyArray<OpenedPool>, string>> {
      if (Option.isNone(key)) return Result.succeed([]);
      const answer = yield* Effect.result(
        withinDeadline(hub.machine(configuration.hub, key.value)),
      );
      if (Result.isFailure(answer)) {
        return Result.fail(
          unanswered(configuration.hub, scope, answer.failure),
        );
      }
      return Result.succeed(answer.success.pools.filter(fits));
    });

    const codexProviders = Effect.fn(function* (
      configuration: Configuration,
      key: Option.Option<Redacted.Redacted<string>>,
    ): Effect.fn.Return<
      Result.Result<ReadonlyArray<Codex.CodexProvider>, string>
    > {
      const pools = yield* poolsOf(
        configuration,
        key,
        "subscription",
        (pool) =>
          pool.kind === "subscription" && pool.protocol === codexProtocol,
      );
      return Result.map(pools, (opened) =>
        Option.match(key, {
          onNone: (): ReadonlyArray<Codex.CodexProvider> => [],
          onSome: (value): ReadonlyArray<Codex.CodexProvider> =>
            opened.map((pool) => ({
              pool: pool.id,
              hub: configuration.hub,
              machine: tagOf(configuration.machine),
              key: Redacted.value(value),
            })),
        }),
      );
    });

    const keyedProviders = Effect.fn(function* (
      configuration: Configuration,
      key: Option.Option<Redacted.Redacted<string>>,
      notes: Array<string>,
    ): Effect.fn.Return<
      Result.Result<ReadonlyArray<ClientFiles.KeyedProvider>, string>
    > {
      const pools = yield* poolsOf(
        configuration,
        key,
        "keyed",
        (pool) => pool.kind === "keyed" && pool.protocol === keyedProtocol,
      );
      if (Result.isFailure(pools)) return Result.fail(pools.failure);
      if (Option.isNone(key)) return Result.succeed([]);
      const providers: Array<ClientFiles.KeyedProvider> = [];
      for (const pool of pools.success) {
        const listed = yield* Effect.result(
          withinDeadline(hub.models(configuration.hub, key.value, pool.id)),
        );
        if (Result.isFailure(listed)) {
          notes.push(
            `cota: the models of ${pool.id} could not be listed (${unlisted(listed.failure)}); its provider keeps the models cota last wrote for it, or is given those the hub has prices for.`,
          );
        }
        providers.push({
          pool: pool.id,
          name: pool.displayName ?? pool.id,
          hub: configuration.hub,
          machine: tagOf(configuration.machine),
          models: Result.isSuccess(listed)
            ? {
                _tag: "Listed",
                models: ClientFiles.listedModels(listed.success, pool.models),
              }
            : {
                _tag: "Kept",
                fallback: pool.models.map(ClientFiles.writtenModelOf),
              },
        });
      }
      return Result.succeed(providers);
    });

    return PlanClientFiles.of({
      execute: Effect.fn("PlanClientFiles.execute")(function* (
        paths: Paths.Paths,
        which: Which,
      ) {
        const places: Array<
          readonly [ClientFiles.ConfiguredClient, ClientFiles.ClientFile]
        > = [];
        for (const client of ClientFiles.configuredClients) {
          const place = ClientFiles.clientFileOf(client, system, variables);
          if (Option.isNone(place)) continue;
          const included =
            which._tag === "None"
              ? yield* exists(place.value.file)
              : which.clients.includes(client) &&
                (yield* installed(paths, client, place.value));
          if (included) places.push([client, place.value]);
        }
        const wants = (client: ClientFiles.ConfiguredClient) =>
          places.some(([each]) => each === client);
        const notes: Array<string> = [];
        let codex: Result.Result<
          ReadonlyArray<Codex.CodexProvider>,
          string
        > = Result.succeed([]);
        let keyed: Result.Result<
          ReadonlyArray<ClientFiles.KeyedProvider>,
          string
        > = Result.succeed([]);
        if (which._tag === "Asked") {
          const { configuration } = which;
          const keys = yield* Effect.result(readHubKeys.execute(paths));
          if (Result.isFailure(keys)) {
            const why = `${keys.failure.path} cannot be read: ${keys.failure.reason}`;
            codex = Result.fail(why);
            keyed = Result.fail(why);
          } else {
            if (wants("codex")) {
              codex = yield* codexProviders(
                configuration,
                keys.success.subscription,
              );
            }
            if (wants("opencode") || wants("pi")) {
              keyed = yield* keyedProviders(
                configuration,
                keys.success.keyed,
                notes,
              );
            }
          }
        }
        const plans: Array<ClientPlan> = [];
        for (const [client, place] of places) {
          const read = yield* Effect.result(files.read(place.file));
          if (Result.isFailure(read)) {
            plans.push({
              client,
              ...place,
              before: Option.none(),
              after: Result.fail({
                reason: `it cannot be read: ${read.failure.reason}`,
                theFiles: true,
              }),
              pools: [],
            });
            continue;
          }
          const text = Option.getOrElse(read.success, () => "");
          const fileFault = (reason: string): Unwritten => ({
            reason,
            theFiles: true,
          });
          const hubFault = (reason: string): Unwritten => ({
            reason,
            theFiles: false,
          });
          const after =
            client === "codex"
              ? Result.flatMap(Result.mapError(codex, hubFault), (providers) =>
                  Result.mapError(Codex.rewrite(text, providers), fileFault),
                )
              : Result.flatMap(Result.mapError(keyed, hubFault), (providers) =>
                  Result.mapError(
                    client === "opencode"
                      ? OpenCode.rewrite(
                          text,
                          providers,
                          Paths.hubKeyFile(paths, "keyed"),
                        )
                      : Pi.rewrite(
                          text,
                          providers,
                          Pi.keyCommandOf(system, program),
                        ),
                    fileFault,
                  ),
                );
          const poolIds = (
            providers: ReadonlyArray<{ readonly pool: string }>,
          ): ReadonlyArray<string> => providers.map(({ pool }) => pool);
          const pools =
            client === "codex"
              ? Result.map(codex, poolIds)
              : Result.map(keyed, poolIds);
          plans.push({
            client,
            ...place,
            before: read.success,
            after,
            pools:
              Result.isSuccess(after) && Result.isSuccess(pools)
                ? pools.success
                : [],
          });
        }
        return { plans, notes };
      }),
    });
  }),
);
