import { Schema } from "effect";
import { HubKey } from "./hub-key.ts";
import { SignInId } from "./ids.ts";

/**
 * Who an API request comes from, once the hub has decided: the owner, with
 * the sign-in that admitted them, or a hub key, with its name and scope.
 */
export const Caller = Schema.TaggedUnion({
  Owner: {
    signIn: Schema.Struct({
      id: SignInId,
      createdAt: Schema.DateTimeUtc,
      expiresAt: Schema.DateTimeUtc,
    }),
  },
  HubKey: { hubKey: HubKey },
});
export type Caller = typeof Caller.Type;

/**
 * Who may call an endpoint: only the `owner`; a `reader` key or the owner; or
 * `any-hub-key` the hub knows, whatever its scope, or the owner.
 */
export const MayCall = Schema.Literals(["owner", "reader", "any-hub-key"]);
export type MayCall = typeof MayCall.Type;
