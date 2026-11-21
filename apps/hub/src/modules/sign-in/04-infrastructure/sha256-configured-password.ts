import { timingSafeEqual } from "node:crypto";
import { Layer, Option, Redacted } from "effect";
import { ConfiguredPassword } from "#modules/sign-in/02-application/interfaces/configured-password.ts";

const digestOf = (text: string): Buffer =>
  Buffer.from(new Bun.CryptoHasher("sha256").update(text).digest());

/**
 * The configuration's owner password, compared as SHA-256 digests in
 * constant time (ADR-0012); a configuration without one matches nothing.
 */
export const layer = (
  password: Option.Option<Redacted.Redacted<string>>,
): Layer.Layer<ConfiguredPassword> =>
  Layer.succeed(
    ConfiguredPassword,
    Option.match(password, {
      onNone: () =>
        ConfiguredPassword.of({ isSet: false, matches: () => false }),
      onSome: (secret) => {
        const owner = digestOf(Redacted.value(secret));
        return ConfiguredPassword.of({
          isSet: true,
          matches: (given) => timingSafeEqual(digestOf(given), owner),
        });
      },
    }),
  );
