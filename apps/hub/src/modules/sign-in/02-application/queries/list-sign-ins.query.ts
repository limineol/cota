import { Context, DateTime, Effect, Layer } from "effect";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import * as SignIn from "#modules/sign-in/03-domain/sign-in.entity.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class ListSignIns extends Context.Service<
  ListSignIns,
  {
    /** The sign-ins neither revoked nor expired, newest first. */
    readonly execute: Effect.Effect<
      ReadonlyArray<SignIn.SignIn>,
      HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/ListSignIns") {}

const newestFirst = (one: SignIn.SignIn, other: SignIn.SignIn): number =>
  DateTime.toEpochMillis(other.createdAt) -
    DateTime.toEpochMillis(one.createdAt) ||
  (other.id < one.id ? -1 : other.id > one.id ? 1 : 0);

export const layer: Layer.Layer<ListSignIns, never, SignIns> = Layer.effect(
  ListSignIns,
  Effect.gen(function* () {
    const signIns = yield* SignIns;
    return ListSignIns.of({
      execute: Effect.gen(function* () {
        const live = [];
        for (const signIn of yield* signIns.all) {
          if (yield* SignIn.isLive(signIn)) live.push(signIn);
        }
        return live.sort(newestFirst);
      }).pipe(Effect.withSpan("ListSignIns.execute")),
    });
  }),
);
