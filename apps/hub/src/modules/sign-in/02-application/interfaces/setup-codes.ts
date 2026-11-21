import { Context, type Effect } from "effect";
import type { SetupCodeDigest } from "#modules/sign-in/03-domain/setup-code.ts";

/** Where setup codes come from, and how the hub knows one again without keeping it. */
export class SetupCodes extends Context.Service<
  SetupCodes,
  {
    /** A new setup code as it is printed, and the digest of its characters, which the hub keeps. */
    readonly make: Effect.Effect<{
      readonly written: string;
      readonly digest: SetupCodeDigest;
    }>;
    /**
     * Whether a code's characters, once normalised, are those of the code
     * held by its digest, compared in a time that does not tell how much of
     * them matched.
     */
    readonly matches: (held: SetupCodeDigest, characters: string) => boolean;
  }
>()("@cota/hub/sign-in/SetupCodes") {}
