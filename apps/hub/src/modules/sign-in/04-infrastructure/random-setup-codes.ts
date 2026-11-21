import { timingSafeEqual } from "node:crypto";
import { Effect, Layer } from "effect";
import { SetupCodes } from "#modules/sign-in/02-application/interfaces/setup-codes.ts";
import * as SetupCode from "#modules/sign-in/03-domain/setup-code.ts";

export const digestOf = (characters: string): SetupCode.SetupCodeDigest =>
  SetupCode.SetupCodeDigest.make(
    new Bun.CryptoHasher("sha256").update(characters).digest("hex"),
  );

/** Whether characters are the code held by its digest, the digests compared in constant time. */
export const matches = (
  held: SetupCode.SetupCodeDigest,
  characters: string,
): boolean =>
  timingSafeEqual(
    Buffer.from(held, "hex"),
    Buffer.from(digestOf(characters), "hex"),
  );

/** Setup codes from the platform's cryptographic source: each character 5 bits of a random byte, so all are equally likely. */
export const layer: Layer.Layer<SetupCodes> = Layer.succeed(
  SetupCodes,
  SetupCodes.of({
    make: Effect.sync(() => {
      const characters = [
        ...crypto.getRandomValues(new Uint8Array(SetupCode.length)),
      ]
        .map((byte) => SetupCode.alphabet[byte % SetupCode.alphabet.length])
        .join("");
      return {
        written: SetupCode.written(characters),
        digest: digestOf(characters),
      };
    }),
    matches,
  }),
);
