import { Option, Schema } from "effect";
import { valuesOf } from "#shared/sessions-search.ts";
import { hiddenOf } from "#shared/transcript/hidden.ts";
import type { Hideable } from "#shared/transcript/transcript.tsx";

export const roles = ["main", "subagent", "title", "utility"] as const;

export type Role = (typeof roles)[number];

export const outcomes = ["ok", "error", "refused", "cancelled"] as const;

export type Outcome = (typeof outcomes)[number];

/** What a session's page can be asked to show: the open tab, the requests' roles and outcomes, and what the toggles hide; a default is left out of the URL. */
export interface SessionSearch {
  readonly tab?: "requests";
  readonly role?: ReadonlyArray<Role>;
  readonly outcome?: ReadonlyArray<Outcome>;
  readonly hide?: ReadonlyArray<Hideable>;
}

const decodeTab = Schema.decodeUnknownOption(Schema.Literal("requests"));

/** The known values among a parameter given once or repeated, in their list's order. */
const known =
  <T extends string>(values: ReadonlyArray<T>) =>
  (given: unknown): ReadonlyArray<T> => {
    const asked = valuesOf(given);
    return values.filter((each) => asked.includes(each));
  };

const rolesOf = known(roles);
const outcomesOf = known(outcomes);

/** Keeps each parameter that decodes and drops one that does not, so a stale link still opens the page. */
export const validateSearch = (
  search: Record<string, unknown>,
): SessionSearch => {
  const tab = Option.getOrUndefined(decodeTab(search.tab));
  const role = rolesOf(search.role);
  const outcome = outcomesOf(search.outcome);
  const hide = hiddenOf(search.hide);
  return {
    ...(tab === undefined ? {} : { tab }),
    ...(role.length === 0 ? {} : { role }),
    ...(outcome.length === 0 ? {} : { outcome }),
    ...(hide.length === 0 ? {} : { hide }),
  };
};
