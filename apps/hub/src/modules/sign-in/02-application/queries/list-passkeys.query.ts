import { Context, DateTime, Effect, Layer } from "effect";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import type { Passkey } from "#modules/sign-in/03-domain/passkey.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

export class ListPasskeys extends Context.Service<
  ListPasskeys,
  {
    /** The passkeys kept, newest first. */
    readonly execute: Effect.Effect<
      ReadonlyArray<Passkey>,
      HubStoreUnavailable
    >;
  }
>()("@cota/hub/sign-in/ListPasskeys") {}

const newestFirst = (one: Passkey, other: Passkey): number =>
  DateTime.toEpochMillis(other.createdAt) -
    DateTime.toEpochMillis(one.createdAt) ||
  (other.id < one.id ? -1 : other.id > one.id ? 1 : 0);

export const layer: Layer.Layer<ListPasskeys, never, Passkeys> = Layer.effect(
  ListPasskeys,
  Effect.gen(function* () {
    const passkeys = yield* Passkeys;
    return ListPasskeys.of({
      execute: Effect.gen(function* () {
        return [...(yield* passkeys.all)].sort(newestFirst);
      }).pipe(Effect.withSpan("ListPasskeys.execute")),
    });
  }),
);
