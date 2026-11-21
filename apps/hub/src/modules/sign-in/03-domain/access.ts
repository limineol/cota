import { Option } from "effect";
import type { Caller, MayCall } from "#shared/03-domain/caller.ts";

export interface Request {
  readonly caller: Option.Option<Caller>;
  readonly mayCall: MayCall;
  /** Whether the request's method changes something: any but GET and HEAD. */
  readonly changes: boolean;
  /** The request's `sec-fetch-site`, which a browser sets. */
  readonly fetchSite: string | undefined;
}

export type Verdict =
  | { readonly _tag: "Admitted"; readonly caller: Caller }
  | { readonly _tag: "SignInRequired" }
  | { readonly _tag: "NotAllowed"; readonly scope: string }
  | { readonly _tag: "CrossSite" };

const otherSites = ["cross-site", "same-site"];

/** Whether a browser sent the request from a page of another site, or of a sibling one under the same domain. */
export const fromAnotherSite = (fetchSite: string | undefined): boolean =>
  otherSites.includes(fetchSite?.toLowerCase() ?? "");

/**
 * Admits a request whose caller may call the endpoint: the owner anywhere, but
 * not from another site when the request changes something; a reader key
 * where readers may call; any hub key where any may. A request without a
 * caller is told to sign in (I1 to I3).
 */
export const decide = (request: Request): Verdict => {
  if (Option.isNone(request.caller)) return { _tag: "SignInRequired" };
  const caller = request.caller.value;
  if (caller._tag === "Owner") {
    if (request.changes && fromAnotherSite(request.fetchSite)) {
      return { _tag: "CrossSite" };
    }
    return { _tag: "Admitted", caller };
  }
  const { scope } = caller.hubKey;
  if (request.mayCall === "any-hub-key") return { _tag: "Admitted", caller };
  if (request.mayCall === "reader" && scope === "reader") {
    return { _tag: "Admitted", caller };
  }
  return { _tag: "NotAllowed", scope };
};
