import {
  ErrorCauseDetail,
  ErrorCauseFact,
  ErrorCauseFacts,
  ErrorCauseLatest,
  ErrorCauseTitle,
  ErrorCauseValue,
} from "@cota/ui/components/error-cause";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSecondary,
} from "@cota/ui/components/table";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import { headlineOf } from "#shared/domain/headline.ts";
import { ago } from "#shared/domain/quantities.ts";
import { useNameOf } from "#shared/names.tsx";
import { counted, millis, when } from "#shared/words.ts";
import { Written } from "#shared/written.tsx";
import type { Cause } from "./queries.ts";
import type { Filtered } from "./search.ts";

/** What a cause without a message is headed by: a hang-up has none to record. */
const silent: Record<Cause["outcome"], string> = {
  ok: "No message was recorded",
  error: "No message was recorded",
  refused: "No message was recorded",
  cancelled: "The client hung up before the answer ended",
};

/** A dimension's name for people, as its filter button says it. */
export const dimensionName: Record<Filtered, string> = {
  pool: "Pool",
  provider: "Provider",
  model: "Model",
  client: "Client",
};

export function CausesHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">Cause</TableHead>
        <TableHead scope="col" from="lg">
          Where
        </TableHead>
        <TableHead scope="col" numeric>
          Requests
        </TableHead>
        <TableHead scope="col" numeric from="md">
          First seen
        </TableHead>
        <TableHead scope="col" numeric from="md">
          Last seen
        </TableHead>
        <TableHead scope="col" from="sm">
          <span className="sr-only">Latest request</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export function CauseItem({
  cause,
  now,
  markOf,
  onFilter,
}: {
  readonly cause: Cause;
  readonly now: number;
  readonly markOf: (pool: string) => ReactNode;
  readonly onFilter: (dimension: Filtered, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const detail = useId();
  const nameOf = useNameOf();
  const headline = headlineOf(cause.message);
  const opens = cause.message.trim() !== headline;
  const first = millis(cause.firstAt);
  const last = millis(cause.lastAt);
  const value = (dimension: Filtered, raw: string, shown: ReactNode) => (
    <ErrorCauseValue
      key={`${dimension}\u0000${raw}`}
      action={`Filter by ${dimensionName[dimension].toLowerCase()}`}
      title={raw}
      onClick={() => onFilter(dimension, raw)}
      {...(dimension === "pool" ? { mark: markOf(raw) } : {})}
    >
      {shown}
    </ErrorCauseValue>
  );
  const pools = cause.pools.map((pool) =>
    value("pool", pool, nameOf("pool", pool)),
  );
  const clients = cause.clients.map((client) =>
    value("client", client, nameOf("client", client)),
  );
  return (
    <TableRow>
      <TableCell className="w-full max-w-0 align-top">
        <ErrorCauseTitle
          {...(opens
            ? {
                open,
                "aria-controls": detail,
                onClick: () => setOpen(!open),
              }
            : {})}
        >
          {headline === "" ? silent[cause.outcome] : headline}
        </ErrorCauseTitle>
        <ErrorCauseFacts>
          {cause.provider === "" ? (
            <ErrorCauseFact>no provider</ErrorCauseFact>
          ) : (
            value("provider", cause.provider, cause.provider)
          )}
          {cause.model === ""
            ? null
            : value("model", cause.model, nameOf("model", cause.model))}
          <ErrorCauseFact>
            {cause.upstreamStatus === 0
              ? "no status"
              : `status ${cause.upstreamStatus}`}
          </ErrorCauseFact>
          {cause.errorType === "" ? null : (
            <ErrorCauseFact>{cause.errorType}</ErrorCauseFact>
          )}
        </ErrorCauseFacts>
        <ErrorCauseFacts className="@4xl/panel:hidden">
          {pools}
          {clients}
        </ErrorCauseFacts>
        {opens ? (
          <ErrorCauseDetail id={detail} hidden={!open}>
            {open ? <Written text={cause.message} /> : null}
          </ErrorCauseDetail>
        ) : null}
      </TableCell>
      <TableCell from="lg" className="max-w-56 align-top">
        <span className="flex flex-wrap gap-x-3">{pools}</span>
        <TableSecondary>
          <span className="flex flex-wrap gap-x-3">{clients}</span>
        </TableSecondary>
      </TableCell>
      <TableCell numeric className="align-top">
        {counted(cause.requests)}
      </TableCell>
      <TableCell numeric from="md" className="align-top">
        <span title={when(first, now)}>{ago(now - first)}</span>
      </TableCell>
      <TableCell numeric from="md" className="align-top">
        <span title={when(last, now)}>{ago(now - last)}</span>
      </TableCell>
      <TableCell from="sm" className="align-top">
        <ErrorCauseLatest
          render={
            <Link to="/requests/$id" params={{ id: cause.latestRequest }} />
          }
        />
      </TableCell>
    </TableRow>
  );
}

/** A row held while the causes load, shaped like one. */
export function CauseSkeleton() {
  return (
    <TableRow aria-hidden="true">
      <TableCell className="w-full max-w-0">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="mt-2 w-2/5" />
      </TableCell>
      <TableCell from="lg">
        <Skeleton className="w-24" />
        <Skeleton className="mt-2 w-16" />
      </TableCell>
      <TableCell numeric>
        <Skeleton className="ml-auto w-8" />
      </TableCell>
      <TableCell numeric from="md">
        <Skeleton className="ml-auto w-14" />
      </TableCell>
      <TableCell numeric from="md">
        <Skeleton className="ml-auto w-14" />
      </TableCell>
      <TableCell from="sm">
        <Skeleton className="w-7" />
      </TableCell>
    </TableRow>
  );
}
