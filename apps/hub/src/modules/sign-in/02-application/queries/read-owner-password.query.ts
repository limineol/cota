import { Context, type DateTime, Effect, Layer, Option } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import * as OwnerPassword from "#modules/sign-in/03-domain/owner-password.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

/** Where the owner password is kept, and when the stored one was set. */
export interface Source {
  readonly source: "configuration" | "hub-store" | "none";
  readonly setAt: Option.Option<DateTime.Utc>;
}

export class ReadOwnerPassword extends Context.Service<
  ReadOwnerPassword,
  { readonly execute: Effect.Effect<Source, HubStoreUnavailable> }
>()("@cota/hub/sign-in/ReadOwnerPassword") {}

export const layer: Layer.Layer<
  ReadOwnerPassword,
  never,
  ConfiguredPassword | StoredPasswords
> = Layer.effect(
  ReadOwnerPassword,
  Effect.gen(function* () {
    const configured = yield* ConfiguredPassword;
    const stored = yield* StoredPasswords;
    return ReadOwnerPassword.of({
      execute: Effect.gen(function* () {
        const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);
        const source: Source =
          kept._tag === "HubStore"
            ? { source: "hub-store", setAt: Option.some(kept.stored.setAt) }
            : {
                source:
                  kept._tag === "Configuration" ? "configuration" : "none",
                setAt: Option.none(),
              };
        return source;
      }).pipe(Effect.withSpan("ReadOwnerPassword.execute")),
    });
  }),
);
