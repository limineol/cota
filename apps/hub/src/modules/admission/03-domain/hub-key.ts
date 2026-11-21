import { Option } from "effect";
import type { Kind } from "./admission.ts";

/**
 * The values a request's headers carry that can be its hub key: its
 * `x-cota-key`, the bearer token of its `authorization`, and its `x-api-key`.
 */
export interface Candidates {
  readonly cotaKey: string | undefined;
  readonly bearer: Option.Option<string>;
  readonly apiKey: string | undefined;
}

/**
 * Gives the hub key a request presents to a pool of the given kind: its
 * `x-cota-key`, or, to a keyed pool only, its bearer token, else a non-empty
 * `x-api-key`; a pool the hub does not have is read as a subscription pool.
 */
export const presented = (
  candidates: Candidates,
  kind: Option.Option<Kind>,
): Option.Option<string> => {
  const key = candidates.cotaKey?.trim() ?? "";
  if (key !== "") return Option.some(key);
  if (!Option.contains(kind, "keyed")) return Option.none();
  if (Option.isSome(candidates.bearer)) return candidates.bearer;
  const apiKey = candidates.apiKey?.trim() ?? "";
  return apiKey === "" ? Option.none() : Option.some(apiKey);
};

/**
 * Gives the hub key a request to the hub's API presents: its `x-cota-key`,
 * else the bearer token of its `authorization`.
 */
export const presentedToApi = (
  candidates: Pick<Candidates, "cotaKey" | "bearer">,
): Option.Option<string> => {
  const key = candidates.cotaKey?.trim() ?? "";
  return key === "" ? candidates.bearer : Option.some(key);
};
