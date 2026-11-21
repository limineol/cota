import { Context, Duration, Effect, Layer, Option, Result } from "effect";
import { Hub, type RouteQuestion } from "#02-application/interfaces/hub.ts";
import type { HubAddress } from "#03-domain/hub-address.ts";
import type { HubKeys } from "#03-domain/machine.ts";
import type { Asked } from "#03-domain/route.ts";

/** How long a launch waits between asking the hub and asking it again. */
const interval = Duration.seconds(1);

export class AskRoute extends Context.Service<
  AskRoute,
  {
    /**
     * Asks the hub which pool a launch bills (`GET /api/route`), with the
     * subscription hub key, else the keyed one, once a second until it
     * answers or the deadline passes. An answer, success or problem, is not
     * asked again.
     */
    readonly execute: (
      hub: HubAddress,
      keys: HubKeys,
      question: RouteQuestion,
      deadline: Duration.Duration,
    ) => Effect.Effect<Asked>;
  }
>()("@cota/cli/AskRoute") {}

export const layer: Layer.Layer<AskRoute, never, Hub> = Layer.effect(
  AskRoute,
  Effect.gen(function* () {
    const hub = yield* Hub;
    return AskRoute.of({
      execute: Effect.fn("AskRoute.execute")(function* (
        address: HubAddress,
        keys: HubKeys,
        question: RouteQuestion,
        deadline: Duration.Duration,
      ) {
        const key = Option.orElse(keys.subscription, () => keys.keyed);
        if (Option.isNone(key)) return { _tag: "NoHubKey" } satisfies Asked;
        const ask = Effect.gen(function* () {
          for (;;) {
            const answered = yield* Effect.result(
              hub.route(address, key.value, question),
            );
            if (Result.isSuccess(answered)) {
              return {
                _tag: "Answered",
                answer: answered.success,
              } satisfies Asked;
            }
            const error = answered.failure;
            switch (error._tag) {
              case "RouteRefused":
                return {
                  _tag: "Refused",
                  refusal: error.refusal,
                  detail: error.detail,
                } satisfies Asked;
              case "HubKeyUnknown":
                return { _tag: "KeyUnknown" } satisfies Asked;
              case "HubFailed":
                return { _tag: "Unsure" } satisfies Asked;
              case "HubUnreachable":
                yield* Effect.sleep(interval);
            }
          }
        });
        return yield* ask.pipe(
          Effect.timeoutOrElse({
            duration: deadline,
            orElse: () => Effect.succeed<Asked>({ _tag: "Unreachable" }),
          }),
        );
      }),
    });
  }),
);
