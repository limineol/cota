import { Effect, Option } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import {
  type Machine,
  type MachineModel,
  ReadMachine,
} from "#modules/admission/02-application/queries/read-machine.query.ts";
import { CurrentCaller } from "#shared/01-presentation/caller.middleware.ts";
import { hubStoreProblem } from "#shared/01-presentation/problems.ts";
import type * as MachineApi from "./machine.api.ts";

const perMillionTokens = 1_000_000n;

const ratesOf = (
  rates: MachineModel["price"]["base"],
): typeof MachineApi.ModelRates.Type => ({
  input: rates.input * perMillionTokens,
  cacheRead: rates.cacheRead * perMillionTokens,
  cacheWriteShort: rates.cacheWriteShort * perMillionTokens,
  cacheWriteLong: rates.cacheWriteLong * perMillionTokens,
  output: rates.output * perMillionTokens,
});

const machineOf = (machine: Machine): typeof MachineApi.Machine.Type => ({
  hubKey: Option.getOrNull(machine.hubKey),
  pools: machine.pools.map((pool) => ({
    id: pool.id,
    kind: pool.kind,
    protocol: Option.getOrNull(pool.protocol),
    provider: pool.provider,
    displayName: Option.getOrNull(pool.displayName),
    models: pool.models.map((model) => ({
      id: model.id,
      name: model.name,
      contextTokens: Option.getOrNull(model.contextTokens),
      outputTokens: Option.getOrNull(model.outputTokens),
      imageInput: Option.getOrNull(model.imageInput),
      price: {
        base: ratesOf(model.price.base),
        tiers: model.price.tiers.map(({ threshold, rates }) => ({
          threshold,
          rates: ratesOf(rates),
        })),
      },
    })),
  })),
  observedPools: machine.observedPools.map((pool) => ({
    id: pool.id,
    provider: pool.provider,
    displayName: Option.getOrNull(pool.displayName),
  })),
});

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof MachineApi.group>,
) =>
  Effect.gen(function* () {
    const readMachine = yield* ReadMachine;

    return handlers.handle("read", () =>
      Effect.gen(function* () {
        const caller = yield* CurrentCaller;
        return machineOf(yield* readMachine.execute(caller));
      }).pipe(Effect.catchTag("HubStoreUnavailable", hubStoreProblem)),
    );
  });
