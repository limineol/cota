import { Context, DateTime, Effect, Layer } from "effect";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import * as SignIn from "#modules/sign-in/03-domain/sign-in.entity.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { SignInId } from "#shared/03-domain/ids.ts";

export class RevokeOtherSignIns extends Context.Service<
  RevokeOtherSignIns,
  {
    /** Revokes every live sign-in but the given one, and gives how many it revoked. */
    readonly execute: (
      current: SignInId,
    ) => Effect.Effect<number, HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/RevokeOtherSignIns") {}

export const layer: Layer.Layer<RevokeOtherSignIns, never, SignIns> =
  Layer.effect(
    RevokeOtherSignIns,
    Effect.gen(function* () {
      const signIns = yield* SignIns;
      return RevokeOtherSignIns.of({
        execute: Effect.fn("RevokeOtherSignIns.execute")(function* (
          current: SignInId,
        ) {
          const others = [];
          for (const signIn of yield* signIns.all) {
            if (signIn.id !== current && (yield* SignIn.isLive(signIn))) {
              others.push(signIn.id);
            }
          }
          if (others.length > 0) {
            yield* signIns.revoke(others, yield* DateTime.now);
          }
          return others.length;
        }),
      });
    }),
  );
