import { Context, Effect, HashMap, Layer, Option } from "effect";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import { ListDisplayNames } from "#modules/display-names/02-application/queries/list-display-names.query.ts";
import {
  ListPoolModels,
  type PoolModel,
} from "#modules/request-log/02-application/queries/list-pool-models.query.ts";
import type { Caller } from "#shared/03-domain/caller.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import { compareText } from "#shared/03-domain/text.ts";

/** A model of a keyed pool, by the name a machine shows it under. */
export interface MachineModel extends PoolModel {
  readonly name: string;
}

/** A pool a caller opens, as a machine needs it: never its held key or its kept login. */
export interface MachinePool {
  readonly id: PoolId;
  readonly kind: Admission.Kind;
  readonly protocol: ProtocolName;
  readonly provider: string;
  readonly displayName: Option.Option<string>;
  readonly models: ReadonlyArray<MachineModel>;
}

/** What a caller is, and the pools it opens. */
export interface Machine {
  readonly hubKey: Option.Option<Admission.HubKey>;
  readonly pools: ReadonlyArray<MachinePool>;
}

export class ReadMachine extends Context.Service<
  ReadMachine,
  {
    /**
     * The caller's hub key, none for the owner, and the pools it opens in
     * order of id: every pool for the owner, those whose kind is its scope
     * for a hub key, so none for a reader key (A7). A keyed pool has the
     * models of its prices (A8), a subscription pool none.
     */
    readonly execute: (
      caller: Caller,
    ) => Effect.Effect<Machine, HubStoreUnavailable>;
  }
>()("@cota/hub/admission/ReadMachine") {}

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<ReadMachine, never, ListPoolModels | ListDisplayNames> =>
  Layer.effect(
    ReadMachine,
    Effect.gen(function* () {
      const listPoolModels = yield* ListPoolModels;
      const listDisplayNames = yield* ListDisplayNames;
      const ordered = [...HashMap.values(pools)].sort((one, other) =>
        compareText(one.id, other.id),
      );

      return ReadMachine.of({
        execute: Effect.fn("ReadMachine.execute")(function* (caller: Caller) {
          const opened =
            caller._tag === "Owner"
              ? ordered
              : ordered.filter((pool) =>
                  Admission.opens(caller.hubKey.scope, pool.kind),
                );
          const names = yield* listDisplayNames.execute;
          const nameOf = (kind: "pool" | "model", key: string) =>
            Option.fromUndefinedOr(
              names.find((name) => name.kind === kind && name.key === key)
                ?.name,
            );
          const machinePools: Array<MachinePool> = [];
          for (const pool of opened) {
            const models =
              pool.kind === "keyed"
                ? yield* listPoolModels.execute(pool.id)
                : [];
            machinePools.push({
              id: pool.id,
              kind: pool.kind,
              protocol: pool.protocol,
              provider: pool.provider,
              displayName: nameOf("pool", pool.id),
              models: models.map((model) => ({
                ...model,
                name: Option.getOrElse(
                  nameOf("model", model.id),
                  () => model.id,
                ),
              })),
            });
          }
          return {
            hubKey:
              caller._tag === "Owner"
                ? Option.none()
                : Option.some(caller.hubKey),
            pools: machinePools,
          };
        }),
      });
    }),
  );
