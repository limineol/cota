import { timingSafeEqual } from "node:crypto";
import { Layer, Option } from "effect";
import { HubKeyHasher } from "#modules/admission/02-application/interfaces/hub-key-hasher.ts";
import { HubKeyDigest } from "#shared/03-domain/ids.ts";

export const digestOf = (secret: string): HubKeyDigest =>
  HubKeyDigest.make(
    new Bun.CryptoHasher("sha256").update(secret).digest("hex"),
  );

/**
 * Gives the known digest that matches what a request presents, comparing the
 * presented key's digest with every known digest in constant time (ADR-0009).
 */
export const match = (
  known: ReadonlyArray<HubKeyDigest>,
  presented: string,
): Option.Option<HubKeyDigest> => {
  const digest = Buffer.from(digestOf(presented), "hex");
  let found: Option.Option<HubKeyDigest> = Option.none();
  for (const candidate of known) {
    if (timingSafeEqual(Buffer.from(candidate, "hex"), digest)) {
      found = Option.some(candidate);
    }
  }
  return found;
};

/** Hub keys as their SHA-256 digests, compared in constant time. */
export const layer: Layer.Layer<HubKeyHasher> = Layer.succeed(
  HubKeyHasher,
  HubKeyHasher.of({ digest: digestOf, match }),
);
