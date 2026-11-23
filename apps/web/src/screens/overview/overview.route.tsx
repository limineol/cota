import { createFileRoute } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import {
  defaultOrder,
  type PoolOrder,
  poolOrders,
} from "#shared/domain/pool-order.ts";
import { defaultRange, Range } from "#shared/range.ts";
import { Overview } from "./overview.tsx";

/** What the overview can be asked to show; a default is left out of the URL. */
export interface OverviewSearch {
  readonly pool?: string;
  readonly range?: Exclude<Range, typeof defaultRange>;
  readonly sort?: Exclude<PoolOrder, typeof defaultOrder>;
}

const decodePool = Schema.decodeUnknownOption(Schema.NonEmptyString);
const decodeRange = Schema.decodeUnknownOption(Range);
const decodeSort = Schema.decodeUnknownOption(Schema.Literals(poolOrders));

/** Keeps each parameter that decodes and drops one that does not, so a stale link still opens the overview. */
const validateSearch = (search: Record<string, unknown>): OverviewSearch => {
  const pool = Option.getOrUndefined(decodePool(search.pool));
  const range = Option.getOrUndefined(decodeRange(search.range));
  const sort = Option.getOrUndefined(decodeSort(search.sort));
  return {
    ...(pool === undefined ? {} : { pool }),
    ...(range === undefined || range === defaultRange ? {} : { range }),
    ...(sort === undefined || sort === defaultOrder ? {} : { sort }),
  };
};

export const Route = createFileRoute("/")({
  validateSearch,
  component: Overview,
});
