import { Context, type Option } from "effect";
import type { HubKeyDigest } from "#shared/03-domain/ids.ts";

/** How the hub keeps a hub key: as a digest, never as the secret. */
export class HubKeyHasher extends Context.Service<
  HubKeyHasher,
  {
    readonly digest: (secret: string) => HubKeyDigest;
    /**
     * Gives the known digest that matches what a request presents, in a time
     * that does not tell which one did (ADR-0009).
     */
    readonly match: (
      known: ReadonlyArray<HubKeyDigest>,
      presented: string,
    ) => Option.Option<HubKeyDigest>;
  }
>()("@cota/hub/admission/HubKeyHasher") {}
