import { Effect, Layer } from "effect";
import { SignInTokens } from "#modules/sign-in/02-application/interfaces/sign-in-tokens.ts";
import { TokenDigest } from "#modules/sign-in/03-domain/sign-in.entity.ts";

export const digestOf = (token: string): TokenDigest =>
  TokenDigest.make(new Bun.CryptoHasher("sha256").update(token).digest("hex"));

/** Tokens of 32 bytes from the platform's cryptographic source, written as base64url (43 characters). */
export const layer: Layer.Layer<SignInTokens> = Layer.succeed(
  SignInTokens,
  SignInTokens.of({
    make: Effect.sync(() => {
      const token = Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString("base64url");
      return { token, digest: digestOf(token) };
    }),
    digestOf,
  }),
);
