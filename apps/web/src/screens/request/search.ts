import { Option, Schema } from "effect";
import { hiddenOf } from "#shared/transcript/hidden.ts";
import type { Hideable } from "#shared/transcript/transcript.tsx";

export const tabs = [
  "error",
  "output",
  "input",
  "tools",
  "params",
  "metadata",
  "usage",
] as const;

export type Tab = (typeof tabs)[number];

/** What the inspector can be asked to show: the open tab, and what the transcript's toggles hide; a default is left out of the URL. */
export interface RequestSearch {
  readonly tab?: Tab;
  readonly hide?: ReadonlyArray<Hideable>;
}

const decodeTab = Schema.decodeUnknownOption(Schema.Literals(tabs));

/** Keeps each parameter that decodes and drops one that does not, so a stale link still opens the request. */
export const validateSearch = (
  search: Record<string, unknown>,
): RequestSearch => {
  const tab = Option.getOrUndefined(decodeTab(search.tab));
  const hide = hiddenOf(search.hide);
  return {
    ...(tab === undefined ? {} : { tab }),
    ...(hide.length === 0 ? {} : { hide }),
  };
};
