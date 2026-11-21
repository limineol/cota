import { Context, type Effect } from "effect";
import type { TokenDigest } from "#modules/sign-in/03-domain/sign-in.entity.ts";

/** Where sign-in tokens come from, and how the hub knows one again without keeping it. */
export class SignInTokens extends Context.Service<
  SignInTokens,
  {
    /** A new token, given to the browser once, and its digest, which the hub keeps. */
    readonly make: Effect.Effect<{
      readonly token: string;
      readonly digest: TokenDigest;
    }>;
    readonly digestOf: (token: string) => TokenDigest;
  }
>()("@cota/hub/sign-in/SignInTokens") {}
