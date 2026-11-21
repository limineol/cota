import type { QueryClient } from "@tanstack/react-query";
import type { Effect } from "effect";
import { useMemo } from "react";
import { type Client, useApiQuery } from "./api.ts";

const list = (client: Client) => client["display-names"].list();

type DisplayName = Effect.Success<ReturnType<typeof list>>["names"][number];

export type Kind = DisplayName["kind"];

const fiveMinutes = 5 * 60 * 1000;

const namesKey = ["display-names", "list"];

const keyOf = (kind: Kind, key: string) => `${kind}\u0000${key}`;

/** Every display name the hub answers, read once for the app and again every five minutes. */
export const useDisplayNames = () =>
  useApiQuery(namesKey, list, {
    refetchInterval: fiveMinutes,
  });

/** Reads the display names again, so that every screen shows a name the moment it changes. */
export const readNamesAgain = (queries: QueryClient) =>
  queries.invalidateQueries({ queryKey: namesKey });

/** The name to show for a kind's raw value: the hub's display name for it, or the value itself while it has none. */
export const useNameOf = () => {
  const { data } = useDisplayNames();
  const names = useMemo(
    () =>
      new Map(
        (data?.names ?? []).map(({ kind, key, name }) => [
          keyOf(kind, key),
          name,
        ]),
      ),
    [data],
  );
  return (kind: Kind, value: string) => names.get(keyOf(kind, value)) ?? value;
};

/** A kind's raw value shown by its display name, with the raw value as its title. */
export function Name({
  kind,
  value,
}: {
  readonly kind: Kind;
  readonly value: string;
}) {
  const nameOf = useNameOf();
  return <span title={value}>{nameOf(kind, value)}</span>;
}
