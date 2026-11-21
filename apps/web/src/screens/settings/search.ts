import { Option, Schema } from "effect";
import type { Kind } from "#shared/names.tsx";

/** What the display names can be asked to show: one kind, `pool` left out, and a filter over ids and names. */
export interface NamesSearch {
  readonly kind?: Exclude<Kind, "pool">;
  readonly filter?: string;
}

const decodeKind = Schema.decodeUnknownOption(
  Schema.Literals(["model", "client", "machine", "project"]),
);
const decodeFilter = Schema.decodeUnknownOption(Schema.NonEmptyString);

/** Keeps each parameter that decodes and drops one that does not, so a stale link still opens the part. */
export const validateSearch = (
  search: Record<string, unknown>,
): NamesSearch => {
  const kind = Option.getOrUndefined(decodeKind(search.kind));
  const filter = Option.getOrUndefined(decodeFilter(search.filter));
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(filter === undefined ? {} : { filter }),
  };
};

/** What the routes can be asked to show: one routed client, Claude Code left out, and the project asked about. */
export interface RoutesSearch {
  readonly client?: "codex";
  readonly project?: string;
}

const decodeClient = Schema.decodeUnknownOption(Schema.Literal("codex"));

export const validateRoutesSearch = (
  search: Record<string, unknown>,
): RoutesSearch => {
  const client = Option.getOrUndefined(decodeClient(search.client));
  const project = Option.getOrUndefined(decodeFilter(search.project));
  return {
    ...(client === undefined ? {} : { client }),
    ...(project === undefined ? {} : { project }),
  };
};
