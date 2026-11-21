import { Button } from "@cota/ui/components/button";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { FieldNote } from "@cota/ui/components/field-note";
import { Input } from "@cota/ui/components/input";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFoot,
  ListPanelHead,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { SearchField } from "@cota/ui/components/search-field";
import { Segmented } from "@cota/ui/components/segmented";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "@cota/ui/components/table";
import { type ReactNode, useMemo, useState } from "react";
import { useApiMutation } from "#shared/api.ts";
import { poolHues } from "#shared/domain/hues.ts";
import { type NameRow, nameRows } from "#shared/domain/names.ts";
import { type Kind, readNamesAgain, useDisplayNames } from "#shared/names.tsx";
import { Problem, problemOf } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import { counted, plural } from "#shared/words.ts";
import { usePools, useSeen } from "./queries.ts";

const kindOptions: ReadonlyArray<{
  readonly value: Kind;
  readonly label: string;
}> = [
  { value: "pool", label: "Pools" },
  { value: "model", label: "Models" },
  { value: "client", label: "Clients" },
  { value: "machine", label: "Machines" },
  { value: "project", label: "Projects" },
];

const noun: Record<Kind, string> = {
  pool: "pool",
  model: "model",
  client: "client",
  machine: "machine",
  project: "project",
};

/** How many values of a dimension `GET /api/facets` lists at most. */
const facetLimit = 100;

/** A display name's longest, in characters, as the hub counts them. */
const longestName = 80;

const source: Record<NonNullable<NameRow["source"]> | "none", string> = {
  owner: "Yours",
  "built-in": "The hub's own",
  none: "None",
};

const skeletonRows = 6;

/** Display names: one kind's ids, each with its name in a field the owner sets and resets in place. */
export function Names({
  owner,
  kind,
  filter,
  onKindChange,
  onFilterChange,
}: {
  readonly owner: boolean;
  readonly kind: Kind;
  readonly filter: string;
  readonly onKindChange: (kind: Kind) => void;
  readonly onFilterChange: (filter: string) => void;
}) {
  const names = useDisplayNames();
  const seen = useSeen();
  const pools = usePools();

  const poolList = pools.data?.pools;
  const hues = useMemo(
    () => poolHues((poolList ?? []).map((pool) => pool.id)),
    [poolList],
  );
  const glyphs = useMemo(
    () =>
      new Map(
        (poolList ?? []).map((pool) => [pool.id, glyphOf(pool.provider)]),
      ),
    [poolList],
  );
  const markOf = (pool: string, name: string): ReactNode => (
    <PoolMark
      hue={hues.get(pool) ?? "neutral"}
      name={name}
      glyph={glyphs.get(pool)}
    />
  );

  const read = seen.state === "read" ? seen.facets : undefined;
  const rows = useMemo(() => {
    if (names.data === undefined || read === undefined) return undefined;
    const counted = read === null ? [] : read[kind];
    return nameRows(
      counted,
      names.data.names.filter((name) => name.kind === kind),
      counted.length < facetLimit,
    );
  }, [names.data, read, kind]);
  const cut = read != null && read[kind].length >= facetLimit;

  const needle = filter.trim().toLowerCase();
  const shown =
    rows === undefined || needle === ""
      ? rows
      : rows.filter(
          (row) =>
            row.key.toLowerCase().includes(needle) ||
            (row.name ?? "").toLowerCase().includes(needle),
        );

  const body = () => {
    if (names.isError || seen.state === "failed") {
      return (
        <Problem
          inside
          title="The hub could not read the display names."
          error={
            names.isError
              ? names.error
              : seen.state === "failed"
                ? seen.error
                : null
          }
          onRetry={() => {
            if (names.isError) names.refetch();
            if (seen.state === "failed") seen.retry();
          }}
        />
      );
    }
    if (shown === undefined) {
      return (
        <Table aria-label="Display names loading">
          <NamesHead />
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
              <NameSkeleton key={index} />
            ))}
          </TableBody>
        </Table>
      );
    }
    if (rows?.length === 0) {
      return (
        <Empty>
          <EmptyTitle>No {noun[kind]} has been seen yet.</EmptyTitle>
          <EmptyDescription>
            A {noun[kind]} is listed here once a request through the hub has
            one, and can be named from then on.
          </EmptyDescription>
        </Empty>
      );
    }
    if (shown.length === 0) {
      return (
        <Empty>
          <EmptyTitle>
            No {noun[kind]}'s id or name holds “{filter.trim()}”.
          </EmptyTitle>
        </Empty>
      );
    }
    return (
      <Table aria-label="Display names">
        <NamesHead />
        <TableBody>
          {shown.map((row) => (
            <NameItem
              key={`${kind}\u0000${row.key}`}
              kind={kind}
              row={row}
              owner={owner}
              mark={
                kind === "pool" ? markOf(row.key, row.name ?? row.key) : null
              }
            />
          ))}
        </TableBody>
      </Table>
    );
  };

  const yours = rows?.filter((row) => row.source === "owner").length ?? 0;

  return (
    <ListPanel aria-label="Display names">
      <ListPanelHead>
        <Segmented
          label="What to name"
          size="sm"
          value={kind}
          options={kindOptions}
          onValueChange={onKindChange}
        />
        <SearchField
          aria-label={`Filter ${noun[kind]}s by id or name`}
          placeholder={`Filter ${noun[kind]}s by id or name`}
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onSubmit={() => {}}
          className="w-full wide:w-72"
        />
        {owner ? null : (
          <Note className="basis-full">
            A reader key reads display names but cannot change them: sign in as
            the owner to name an id.
          </Note>
        )}
      </ListPanelHead>
      <ListPanelBody>{body()}</ListPanelBody>
      {rows !== undefined && rows.length > 0 ? (
        <ListPanelFoot>
          <span>
            {plural(rows.length, noun[kind])}
            {yours > 0 ? `, ${counted(yours)} named by you` : ""}
          </span>
          <Note>
            {cut
              ? `The ${counted(facetLimit)} ${noun[kind]}s with the most requests are listed, and every ${noun[kind]} with a name. `
              : ""}
            A name shows everywhere but the SQL console; the id stays in the URL
            and on hover.
          </Note>
        </ListPanelFoot>
      ) : null}
    </ListPanel>
  );
}

function NamesHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">Id</TableHead>
        <TableHead scope="col">Display name</TableHead>
        <TableHead scope="col" from="md">
          From
        </TableHead>
        <TableHead scope="col" numeric from="sm">
          Requests
        </TableHead>
        <TableHead scope="col">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

type Said = { readonly tone: "quiet" | "danger"; readonly text: string } | null;

/** One id: its name in a field, set on Enter or Save, put back on Escape, and removed by Reset. */
function NameItem({
  kind,
  row,
  owner,
  mark,
}: {
  readonly kind: Kind;
  readonly row: NameRow;
  readonly owner: boolean;
  readonly mark: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<Said>(null);
  const set = useApiMutation(
    (name: string) => (client) =>
      client["display-names"].set({
        params: { kind, key: row.key },
        payload: { name },
      }),
    async (_, queries) => readNamesAgain(queries),
  );
  const remove = useApiMutation(
    (_: undefined) => (client) =>
      client["display-names"].remove({ params: { kind, key: row.key } }),
    async (_, queries) => readNamesAgain(queries),
  );

  const current = row.name ?? "";
  const value = draft ?? current;
  const edited = draft !== null && draft !== current;
  const pending = set.isPending || remove.isPending;

  const save = () => {
    if (!edited || pending) return;
    const name = value.trim();
    const length = [...name].length;
    if (length === 0) {
      setNote({
        tone: "danger",
        text:
          row.source === "owner"
            ? "A display name needs at least one character; Reset removes yours."
            : "A display name needs at least one character.",
      });
      return;
    }
    if (length > longestName) {
      setNote({
        tone: "danger",
        text: `A display name is at most ${longestName} characters; this one is ${counted(length)}.`,
      });
      return;
    }
    setNote(null);
    set.mutate(name, {
      onSuccess: (answer) => {
        setDraft(null);
        setNote(
          answer.source === "built-in"
            ? {
                tone: "quiet",
                text:
                  answer.name === row.key
                    ? "That is its id, so your name is removed."
                    : "That is its id, so your name is removed and the hub's own shows.",
              }
            : { tone: "quiet", text: "Saved." },
        );
      },
      onError: (error) =>
        setNote({ tone: "danger", text: `Not saved: ${problemOf(error)}` }),
    });
  };
  const reset = () => {
    setNote(null);
    remove.mutate(undefined, {
      onSuccess: () => {
        setDraft(null);
        setNote({ tone: "quiet", text: "Your name is removed." });
      },
      onError: (error) =>
        setNote({ tone: "danger", text: `Not reset: ${problemOf(error)}` }),
    });
  };

  const said = pending
    ? { tone: "quiet" as const, text: set.isPending ? "Saving…" : "Resetting…" }
    : note;
  const from = source[row.source ?? "none"];
  const requests =
    row.requests === null ? "not counted" : plural(row.requests, "request");

  return (
    <TableRow>
      <TableCell className="w-2/5 max-w-0">
        <span className="flex min-w-0 items-center gap-1.75">
          {mark}
          <TableLabel title={row.key}>
            <code>{row.key}</code>
          </TableLabel>
        </span>
        <Note className="mt-0.5 @2xl/panel:hidden">
          {from} · {requests}
        </Note>
      </TableCell>
      <TableCell className="w-2/5 min-w-32 @2xl/panel:min-w-40">
        {owner ? (
          <Input
            aria-label={`Display name of ${row.key}`}
            value={value}
            placeholder={row.key}
            aria-invalid={said?.tone === "danger" || undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setDraft(event.target.value);
              setNote(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") {
                setDraft(null);
                setNote(null);
              }
            }}
          />
        ) : row.name === null ? (
          <Note>Its id shows.</Note>
        ) : (
          <TableLabel>{row.name}</TableLabel>
        )}
        {said === null ? null : (
          <FieldNote tone={said.tone}>{said.text}</FieldNote>
        )}
      </TableCell>
      <TableCell from="md" className="whitespace-nowrap">
        {from}
      </TableCell>
      <TableCell numeric from="sm">
        {row.requests === null ? (
          <span title="Not among the ids with the most requests">—</span>
        ) : (
          counted(row.requests)
        )}
      </TableCell>
      <TableCell className="w-20">
        {!owner ? null : edited ? (
          <Button size="sm" disabled={pending} onClick={save}>
            Save
          </Button>
        ) : row.source === "owner" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={reset}
            aria-label={`Reset the name of ${row.key}`}
          >
            Reset
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

/** A row held while the names load, shaped like one. */
function NameSkeleton() {
  return (
    <TableRow aria-hidden="true">
      <TableCell className="w-2/5 max-w-0">
        <Skeleton className="w-32" />
      </TableCell>
      <TableCell className="w-2/5">
        <Skeleton className="h-8 w-full" />
      </TableCell>
      <TableCell from="md">
        <Skeleton className="w-16" />
      </TableCell>
      <TableCell numeric from="sm">
        <Skeleton className="ml-auto w-10" />
      </TableCell>
      <TableCell className="w-20" />
    </TableRow>
  );
}
