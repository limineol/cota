import {
  SessionSnippet,
  SessionTitle,
  SnippetMark,
} from "@cota/ui/components/session-table";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  TableBody,
  TableCell,
  TableFlag,
  TableHead,
  TableHeader,
  TableLabel,
  TableMagnitude,
  TableRow,
  TableSecondary,
  TableSort,
} from "@cota/ui/components/table";
import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { ago, span, tokens } from "#shared/domain/quantities.ts";
import { marks, type Tolerance } from "#shared/domain/snippet.ts";
import { Name, useNameOf } from "#shared/names.tsx";
import type { Sort } from "#shared/sessions-search.ts";
import {
  costText,
  counted,
  dollarsOf,
  millis,
  plural,
  tokensIn,
  when,
} from "#shared/words.ts";
import type { SessionRow as Row } from "./queries.ts";

/** The table's columns, which a snippet's row spans. */
const columnCount = 8;

const withoutSession = "request:";

function Heading({ row }: { readonly row: Row }) {
  if (row.title !== null) {
    return <SessionTitle title={row.title.text}>{row.title.text}</SessionTitle>;
  }
  if (row.firstPrompt !== null) {
    return (
      <SessionTitle kind="prompt" title={row.firstPrompt}>
        {row.firstPrompt}
      </SessionTitle>
    );
  }
  return (
    <SessionTitle kind="none">
      {row.id.startsWith(withoutSession)
        ? "A request without a session"
        : "Untitled session"}
    </SessionTitle>
  );
}

function Snippet({
  snippet,
  q,
  tolerance,
}: {
  readonly snippet: NonNullable<Row["snippet"]>;
  readonly q: string;
  readonly tolerance: Tolerance;
}) {
  let at = 0;
  return (
    <SessionSnippet columns={columnCount}>
      {snippet.start > 0 ? "…" : null}
      {marks(snippet.text, q, tolerance).map((piece) => {
        const key = at;
        at += piece.text.length;
        return piece.marked ? (
          <SnippetMark key={key}>{piece.text}</SnippetMark>
        ) : (
          piece.text
        );
      })}
    </SessionSnippet>
  );
}

/** The first of a kind, and how many more after it: `acme/shop +2`. */
function FirstOf({
  kind,
  values,
}: {
  readonly kind: "pool" | "project" | "model" | "client";
  readonly values: ReadonlyArray<string>;
}) {
  const nameOf = useNameOf();
  const [first] = values;
  if (first === undefined) return null;
  return (
    <>
      <Name kind={kind} value={first} />
      {values.length > 1 ? (
        <span
          title={values
            .slice(1)
            .map((value) => nameOf(kind, value))
            .join(", ")}
        >
          {" "}
          +{values.length - 1}
        </span>
      ) : null}
    </>
  );
}

/** Tokens over the requests that reported usage, written as a lower bound while any did not. */
const tokensText = (row: Row) => {
  if (row.usageUnreported === row.requests) return "unreported";
  const total = tokens(tokensIn(row.usage));
  return row.usageUnreported > 0 ? `≥${total}` : total;
};

type Shown = "md" | "lg" | "xl";

const sortable: ReadonlyArray<{
  readonly sort: Sort;
  readonly label: string;
  readonly from: Shown;
}> = [
  { sort: "recent", label: "Ended", from: "md" },
  { sort: "requests", label: "Requests", from: "lg" },
  { sort: "tokens", label: "Tokens", from: "md" },
  { sort: "cost", label: "Cost", from: "md" },
];

/** The table's head; the four figures the hub sorts by are links that sort by them. */
export function SessionsHead({
  sort,
  sortLink,
}: {
  readonly sort: Sort;
  readonly sortLink: (sort: Sort) => ReactElement;
}) {
  return (
    <TableHeader from="md">
      <TableRow>
        <TableHead scope="col">Session</TableHead>
        <TableHead scope="col" from="lg">
          Pool
        </TableHead>
        <TableHead scope="col" from="xl">
          Model
        </TableHead>
        {sortable.map((column) => {
          const sorted = column.sort === sort ? "descending" : undefined;
          return (
            <TableHead
              key={column.sort}
              scope="col"
              numeric
              from={column.from}
              sorted={sorted}
            >
              <TableSort numeric sorted={sorted} render={sortLink(column.sort)}>
                {column.label}
              </TableSort>
            </TableHead>
          );
        })}
        <TableHead scope="col" numeric from="xl">
          Lasted
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export function SessionItem({
  row,
  now,
  q,
  tolerance,
  peak,
  markOf,
}: {
  readonly row: Row;
  readonly now: number;
  readonly q: string | null;
  readonly tolerance: Tolerance;
  readonly peak: number;
  readonly markOf: (pool: string) => ReactNode;
}) {
  const started = millis(row.startedAt);
  const ended = millis(row.endedAt);
  const [pool] = row.pools;
  const cost = costText(dollarsOf(row.costUsd), row.unpricedRequests);
  return (
    <TableBody linked>
      <TableRow>
        <TableCell className="w-full max-w-0">
          <span className="flex min-w-0 items-center gap-1.75">
            <TableLabel
              render={
                <Link to="/sessions/$session" params={{ session: row.id }} />
              }
            >
              <Heading row={row} />
            </TableLabel>
            {row.errors > 0 ? (
              <TableFlag>{plural(row.errors, "error")}</TableFlag>
            ) : null}
          </span>
          {row.title !== null && row.firstPrompt !== null ? (
            <TableSecondary className="hidden @2xl/panel:block">
              {row.firstPrompt}
            </TableSecondary>
          ) : null}
          <TableSecondary className="@2xl/panel:hidden">
            <span title={when(ended, now)}>{ago(now - ended)}</span> ·{" "}
            {tokensText(row)} tokens · {cost} ·{" "}
            {plural(row.requests, "request")}
          </TableSecondary>
        </TableCell>
        <TableCell from="lg" className="max-w-44">
          <span className="flex min-w-0 items-center gap-1.5">
            {pool === undefined ? null : markOf(pool)}
            <TableLabel>
              <FirstOf kind="pool" values={row.pools} />
            </TableLabel>
          </span>
          <TableSecondary>
            <FirstOf kind="project" values={row.projects} />
          </TableSecondary>
        </TableCell>
        <TableCell from="xl" className="max-w-44">
          <TableLabel className="block">
            <FirstOf kind="model" values={row.models} />
          </TableLabel>
          <TableSecondary>
            <FirstOf kind="client" values={row.clients} />
          </TableSecondary>
        </TableCell>
        <TableCell numeric from="md">
          <span title={when(ended, now)}>{ago(now - ended)}</span>
        </TableCell>
        <TableCell numeric from="lg">
          {counted(row.requests)}
        </TableCell>
        <TableCell numeric from="md">
          {tokensText(row)}
          <TableMagnitude fraction={tokensIn(row.usage) / peak} />
        </TableCell>
        <TableCell numeric from="md">
          {cost}
        </TableCell>
        <TableCell numeric from="xl">
          <span title={`${when(started, now)} – ${when(ended, now)}`}>
            {span(ended - started)}
          </span>
        </TableCell>
      </TableRow>
      {row.snippet !== null && q !== null ? (
        <Snippet snippet={row.snippet} q={q} tolerance={tolerance} />
      ) : null}
    </TableBody>
  );
}

const placeholders: ReadonlyArray<Shown> = ["md", "lg", "md", "md", "xl"];

/** A row held while the list loads, shaped like one. */
export function SessionSkeleton() {
  return (
    <TableBody aria-hidden="true">
      <TableRow>
        <TableCell className="w-full max-w-0">
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="mt-2 w-4/5" />
        </TableCell>
        <TableCell from="lg">
          <Skeleton className="w-24" />
          <Skeleton className="mt-2 w-16" />
        </TableCell>
        <TableCell from="xl">
          <Skeleton className="w-24" />
          <Skeleton className="mt-2 w-16" />
        </TableCell>
        {placeholders.map((from, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
          <TableCell key={index} numeric from={from}>
            <Skeleton className="ml-auto w-10" />
          </TableCell>
        ))}
      </TableRow>
    </TableBody>
  );
}
