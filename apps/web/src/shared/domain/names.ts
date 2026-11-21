/** An id the request log has for a kind, with how many requests have it. */
export interface Seen {
  readonly value: string;
  readonly requests: number;
}

/** A display name of the kind, as `GET /api/display-names` answers it. */
export interface Named {
  readonly key: string;
  readonly name: string;
  readonly source: "owner" | "built-in";
}

/** One id on the display names' list: how many requests it has, when known, and its name and where it comes from, when it has one. */
export interface NameRow {
  readonly key: string;
  readonly requests: number | null;
  readonly name: string | null;
  readonly source: Named["source"] | null;
}

/**
 * The rows of a kind's display names: every id seen, in the order given,
 * then every name of an id not seen, in the order given, each id once (V35).
 * An id not seen has no requests when `whole`, the ids seen being all there
 * are, and an unknown count otherwise.
 */
export const nameRows = (
  seen: ReadonlyArray<Seen>,
  names: ReadonlyArray<Named>,
  whole: boolean,
): ReadonlyArray<NameRow> => {
  const byKey = new Map(names.map((named) => [named.key, named]));
  const seenKeys = new Set(seen.map((each) => each.value));
  const row = (key: string, requests: number | null): NameRow => {
    const named = byKey.get(key);
    return {
      key,
      requests,
      name: named?.name ?? null,
      source: named?.source ?? null,
    };
  };
  return [
    ...seen.map((each) => row(each.value, each.requests)),
    ...names
      .filter((named) => !seenKeys.has(named.key))
      .map((named) => row(named.key, whole ? 0 : null)),
  ];
};
