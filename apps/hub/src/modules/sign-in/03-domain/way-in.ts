import { Effect, Schema } from "effect";
import type { Kept } from "./owner-password.ts";

/**
 * Whether a hub is set up: it has a way in, an owner password (in the
 * configuration or the hub store) or, read only when it has none, a passkey.
 */
export const isSetUp = <E>(
  password: Kept,
  anyPasskey: Effect.Effect<boolean, E>,
): Effect.Effect<boolean, E> =>
  password._tag === "None" ? anyPasskey : Effect.succeed(true);

/** What the hub store answers a command that would leave the owner no way in, which it refuses (I17). */
export class LastWayIn extends Schema.TaggedError<
  LastWayIn,
  { readonly brand: unique symbol }
>()("LastWayIn", {}) {}
