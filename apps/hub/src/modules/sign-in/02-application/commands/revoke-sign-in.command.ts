import { Context, DateTime, Effect, Layer } from "effect";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import * as SignIn from "#modules/sign-in/03-domain/sign-in.entity.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { SignInId } from "#shared/03-domain/ids.ts";

export class RevokeSignIn extends Context.Service<
  RevokeSignIn,
  {
    /** Revokes the live sign-in with the given id, and no other (I6). */
    readonly execute: (
      id: SignInId,
    ) => Effect.Effect<void, SignIn.NoSuchSignIn | HubStoreUnavailable>;
  }
>()("@cota/hub/sign-in/RevokeSignIn") {}

export const layer: Layer.Layer<RevokeSignIn, never, SignIns> = Layer.effect(
  RevokeSignIn,
  Effect.gen(function* () {
    const signIns = yield* SignIns;
    return RevokeSignIn.of({
      execute: Effect.fn("RevokeSignIn.execute")(function* (id: SignInId) {
        const found = (yield* signIns.all).find((each) => each.id === id);
        if (found === undefined || !(yield* SignIn.isLive(found))) {
          return yield* new SignIn.NoSuchSignIn({ id });
        }
        yield* signIns.revoke([id], yield* DateTime.now);
      }),
    });
  }),
);
