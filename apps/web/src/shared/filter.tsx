import {
  FilterMenu,
  FilterMenuItem,
  FilterMenuNote,
} from "@cota/ui/components/filter-menu";
import type { ReactNode } from "react";
import { counted, plural } from "#shared/words.ts";

/** A value of a dimension and how many requests have it, as the facets count them. */
export interface Counted<T extends string = string> {
  readonly value: T;
  readonly requests: number;
}

/** Counts are of requests: the words a dimension's menu heads its values with. */
export const countedIn = "Counted in requests";

/**
 * A dimension's filter button and its menu of values, each with its count and
 * its share of the largest; a value chosen but no longer counted is listed
 * with none, so it can still be unticked.
 */
export function ValuesFilter<T extends string>({
  label,
  values,
  failed,
  chosen,
  nameOf,
  markOf,
  onToggle,
  note,
}: {
  readonly label: string;
  readonly values: ReadonlyArray<Counted<T>> | undefined;
  readonly failed: boolean;
  readonly chosen: ReadonlyArray<T>;
  readonly nameOf: (value: T) => string;
  readonly markOf?: ((value: T) => ReactNode) | undefined;
  readonly onToggle: (value: T, on: boolean) => void;
  readonly note?: string;
}) {
  const listed =
    values === undefined
      ? undefined
      : [
          ...values,
          ...chosen
            .filter((value) => !values.some((each) => each.value === value))
            .map((value) => ({ value, requests: 0 })),
        ];
  const peak = Math.max(1, ...(listed ?? []).map((each) => each.requests));
  return (
    <FilterMenu
      label={label}
      chosen={chosen.map(nameOf)}
      {...(note === undefined ? {} : { note })}
    >
      {listed === undefined ? (
        <FilterMenuNote>
          {failed ? "The hub could not read the values" : "Reading the values…"}
        </FilterMenuNote>
      ) : listed.length === 0 ? (
        <FilterMenuNote>None in range</FilterMenuNote>
      ) : (
        listed.map((each) => (
          <FilterMenuItem
            key={each.value}
            checked={chosen.includes(each.value)}
            onCheckedChange={(on) => onToggle(each.value, on)}
            {...(markOf === undefined ? {} : { mark: markOf(each.value) })}
            count={
              <span title={plural(each.requests, "request")}>
                {counted(each.requests)}
              </span>
            }
            fraction={each.requests / peak}
          >
            <span title={each.value}>{nameOf(each.value)}</span>
          </FilterMenuItem>
        ))
      )}
    </FilterMenu>
  );
}
