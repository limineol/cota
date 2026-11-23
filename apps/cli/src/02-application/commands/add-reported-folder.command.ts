import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import { ClientRecords } from "#02-application/interfaces/client-records.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { Hub } from "#02-application/interfaces/hub.ts";
import { ReadHubKeys } from "#02-application/queries/read-hub-keys.query.ts";
import type { ReportedClient } from "#03-domain/client.ts";
import * as Configuration from "#03-domain/configuration.ts";
import { HubUnreachable, hubDeadline } from "#03-domain/machine.ts";
import type { Paths } from "#03-domain/paths.ts";
import * as Requests from "#03-domain/requests.ts";

/** `cota requests add` or `remove` did nothing, and why. */
export class FolderRefused extends Schema.TaggedError<
  FolderRefused,
  { readonly brand: unique symbol }
>()("FolderRefused", { problem: Schema.String }) {}

/**
 * The kept entry a folder names: the one kept by that very path, else the one
 * kept by another path to the same directory. Two of those are ambiguous, and
 * refused.
 */
export const keptFolderOf = Effect.fn("keptFolderOf")(function* (
  kept: ReadonlyArray<Configuration.ReportedFolder>,
  folder: string,
  realOf: (folder: string) => Effect.Effect<Option.Option<string>>,
) {
  const exact = kept.find((each) => each.folder === folder);
  if (exact !== undefined) return Option.some(exact);
  const real = yield* realOf(folder);
  if (Option.isNone(real)) return Option.none<Configuration.ReportedFolder>();
  const same: Array<Configuration.ReportedFolder> = [];
  for (const each of kept) {
    if (Option.contains(yield* realOf(each.folder), real.value)) {
      same.push(each);
    }
  }
  if (same.length > 1) {
    return yield* new FolderRefused({
      problem: `${folder} is the same directory as ${same
        .map((each) => each.folder)
        .join(
          " and ",
        )}, each kept apart; name the one meant by the path it is kept by (cota requests show lists them)`,
    });
  }
  return Option.fromUndefinedOr(same[0]);
});

export interface Added {
  readonly said: ReadonlyArray<string>;
  /** Whether it is the configuration's first reported folder, which schedules the request reporter. */
  readonly first: boolean;
  readonly configuration: Configuration.Configuration;
}

export class AddReportedFolder extends Context.Service<
  AddReportedFolder,
  {
    /**
     * Keeps a data folder of a reported client and the observed pool it
     * bills, once the folder is a directory and the hub lists the pool among
     * its observed pools; a folder already kept is given the pool
     * (`docs/specs/request-reporter/spec.md`, Commands).
     */
    readonly execute: (
      paths: Paths,
      configuration: Configuration.Configuration,
      asked: {
        readonly client: ReportedClient;
        readonly folder: string;
        readonly pool: string;
      },
    ) => Effect.Effect<Added, FolderRefused>;
  }
>()("@cota/cli/AddReportedFolder") {}

export const layer: Layer.Layer<
  AddReportedFolder,
  never,
  Files | ClientRecords | Hub | ReadHubKeys
> = Layer.effect(
  AddReportedFolder,
  Effect.gen(function* () {
    const files = yield* Files;
    const records = yield* ClientRecords;
    const hub = yield* Hub;
    const readHubKeys = yield* ReadHubKeys;
    const refused = (problem: string) => new FolderRefused({ problem });
    const realOf = (folder: string) =>
      records.folder(folder).pipe(Effect.orElseSucceed(() => Option.none()));

    return AddReportedFolder.of({
      execute: Effect.fn("AddReportedFolder.execute")(function* (
        paths,
        configuration,
        { folder, pool },
      ) {
        if (!folder.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(folder)) {
          return yield* refused(
            `give the data folder as an absolute path, not ${folder}`,
          );
        }
        const real = yield* realOf(folder);
        if (Option.isNone(real)) {
          return yield* refused(`${folder} is not a directory`);
        }
        const kept = configuration.clients?.antigravity?.reported ?? [];
        const same = yield* keptFolderOf(kept, folder, realOf);
        if (Option.exists(same, (each) => each.pool === pool)) {
          return {
            said: [`cota: ${folder} is reported already, billing ${pool}.`],
            first: false,
            configuration,
          };
        }

        const keys = yield* readHubKeys
          .execute(paths)
          .pipe(
            Effect.mapError((error) =>
              refused(`${error.path} cannot be read: ${error.reason}`),
            ),
          );
        const key = Option.orElse(keys.subscription, () => keys.keyed);
        if (Option.isNone(key)) {
          return yield* refused(
            `this machine keeps no hub key to report with. Join again: cota join ${configuration.hub}`,
          );
        }
        const machine = yield* Effect.result(
          hub.machine(configuration.hub, key.value).pipe(
            Effect.timeoutOrElse({
              duration: hubDeadline,
              orElse: () => Effect.fail(new HubUnreachable()),
            }),
          ),
        );
        if (Result.isFailure(machine)) {
          return yield* refused(
            machine.failure._tag === "HubKeyUnknown"
              ? `${configuration.hub} does not know this machine's hub key. Join again: cota join ${configuration.hub}`
              : `${configuration.hub} did not say which pools are observed pools; nothing was kept`,
          );
        }
        const { observedPools } = machine.success;
        if (!observedPools.includes(pool)) {
          return yield* refused(
            `${configuration.hub} has no observed pool ${pool}; ${
              observedPools.length === 0
                ? "it has none: the owner adds one to the hub's configuration (observed = true)"
                : `its observed pools are ${observedPools.join(", ")}`
            }`,
          );
        }

        const folders = Option.match(same, {
          onNone: () => [...kept, { folder, pool }],
          onSome: (before) =>
            kept.map((each) => (each === before ? { ...each, pool } : each)),
        });
        const changed = Requests.withFolders(configuration, folders);
        yield* files
          .write(paths.configurationFile, Configuration.textOf(changed), 0o600)
          .pipe(
            Effect.mapError((error) =>
              refused(`${error.path} cannot be written: ${error.reason}`),
            ),
          );
        return {
          said: [
            Option.match(same, {
              onNone: () =>
                `cota: ${folder} is reported now, its model calls billing ${pool}.`,
              onSome: (before) =>
                `cota: ${folder} bills ${pool} now, not ${before.pool}; the calls reported before keep the pool they billed.`,
            }),
          ],
          first: kept.length === 0,
          configuration: changed,
        };
      }),
    });
  }),
);
