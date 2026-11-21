import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

/** Crockford's base32: the digits and the capitals but I, L, O and U. */
export const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How many characters of `alphabet` a setup code has: 60 bits. */
export const length = 12;

/** The SHA-256 of a setup code's characters, 64 hex digits: all the hub keeps of it. */
export const SetupCodeDigest = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
).pipe(Schema.brand("SetupCodeDigest"));
export type SetupCodeDigest = typeof SetupCodeDigest.Type;

/** A setup code's characters as it is printed: three groups of four, `K7QM-2F9X-HD3P`. */
export const written = (characters: string): string =>
  (characters.match(/.{1,4}/g) ?? []).join("-");

/**
 * A setup code as it is given, read as Crockford's base32 is: ignoring case,
 * hyphens and spaces, and reading O as 0, and I and L as 1, which the
 * alphabet does not have.
 */
export const normalised = (given: string): string =>
  given
    .replaceAll(/[-\s]/g, "")
    .toUpperCase()
    .replaceAll("O", "0")
    .replaceAll(/[IL]/g, "1");

export class WrongSetupCode extends Schema.TaggedError<
  WrongSetupCode,
  { readonly brand: unique symbol }
>()("WrongSetupCode", {}) {}

export class AlreadySetUp extends Schema.TaggedError<
  AlreadySetUp,
  { readonly brand: unique symbol }
>()("AlreadySetUp", {}) {}

/** The setup code of a hub that is not set up, held by its digest, in memory, until the hub is set up. */
export class SetupCode extends Context.Service<
  SetupCode,
  {
    readonly hold: (digest: SetupCodeDigest) => Effect.Effect<void>;
    /** Whether a code given opens the one held, by the comparison given; nothing does, once forgotten or before one is held. */
    readonly opens: (
      matches: (held: SetupCodeDigest) => boolean,
    ) => Effect.Effect<boolean>;
    readonly forget: Effect.Effect<void>;
  }
>()("@cota/hub/sign-in/SetupCode") {}

export const layer: Layer.Layer<SetupCode> = Layer.effect(
  SetupCode,
  Effect.gen(function* () {
    const held = yield* Ref.make(Option.none<SetupCodeDigest>());
    return SetupCode.of({
      hold: (digest) => Ref.set(held, Option.some(digest)),
      opens: (matches) =>
        Effect.gen(function* () {
          return Option.exists(yield* Ref.get(held), matches);
        }),
      forget: Ref.set(held, Option.none()),
    });
  }),
);
