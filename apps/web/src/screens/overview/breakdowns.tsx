import { Button } from "@cota/ui/components/button";
import { Card } from "@cota/ui/components/card";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { MagnitudeBar } from "@cota/ui/components/magnitude-bar";
import { SectionDescription, Subheading } from "@cota/ui/components/page";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFlag,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "@cota/ui/components/table";
import { type ReactElement, useState } from "react";
import { tokens } from "#shared/domain/quantities.ts";
import { useNameOf } from "#shared/names.tsx";
import {
  costText,
  counted,
  dollarsOf,
  plural,
  tokensIn,
} from "#shared/words.ts";
import type { Breakdown } from "./queries.ts";

const shownFirst = 6;

/** The range's traffic by project or by model, its first six rows and the rest on asking; a row's name leads to its sessions by `linkOf`. */
export function BreakdownTable({
  title,
  kind,
  breakdown,
  during,
  linkOf,
}: {
  readonly title: string;
  readonly kind: "project" | "model";
  readonly breakdown: Breakdown | undefined;
  readonly during: string;
  readonly linkOf: (key: string) => ReactElement;
}) {
  const [expanded, setExpanded] = useState(false);
  const nameOf = useNameOf();
  const rows = breakdown?.rows ?? [];
  const shown = expanded ? rows : rows.slice(0, shownFirst);
  const peak = Math.max(1, ...rows.map((row) => tokensIn(row.usage)));
  const headingId = `breakdown-${kind}`;
  return (
    <Card size="compact" aria-labelledby={headingId} role="region">
      <Subheading id={headingId}>{title}</Subheading>
      {breakdown === undefined ? (
        <Skeleton className="h-36 w-full" />
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyTitle>No {kind} traffic</EmptyTitle>
          <EmptyDescription>Nothing was logged {during}.</EmptyDescription>
        </Empty>
      ) : (
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {kind === "project" ? "Project" : "Model"}
              </TableHead>
              <TableHead scope="col" numeric>
                Requests
              </TableHead>
              <TableHead scope="col" numeric wide>
                Sessions
              </TableHead>
              <TableHead scope="col" numeric>
                Tokens
              </TableHead>
              <TableHead scope="col" numeric wide>
                Cost
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => {
              const total = tokensIn(row.usage);
              return (
                <TableRow key={row.key}>
                  <TableCell className="w-full max-w-0">
                    <span className="flex min-w-0 items-center gap-1.75">
                      <TableLabel
                        title={row.key}
                        {...(row.key === "" ? {} : { render: linkOf(row.key) })}
                      >
                        {row.key === "" ? `No ${kind}` : nameOf(kind, row.key)}
                      </TableLabel>
                      {row.errors > 0 ? (
                        <TableFlag>{plural(row.errors, "error")}</TableFlag>
                      ) : null}
                    </span>
                    <MagnitudeBar
                      fraction={total / peak}
                      className="mt-1.25 max-w-55"
                    />
                  </TableCell>
                  <TableCell numeric>{counted(row.requests)}</TableCell>
                  <TableCell numeric wide>
                    {counted(row.sessions)}
                  </TableCell>
                  <TableCell numeric>{tokens(total)}</TableCell>
                  <TableCell numeric wide>
                    {costText(dollarsOf(row.costUsd), row.unpricedRequests)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {rows.length > shownFirst ||
      (breakdown?.distinctKeys ?? 0) > rows.length ? (
        <div className="flex flex-wrap items-center gap-3">
          {rows.length > shownFirst ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show fewer" : `Show all ${counted(rows.length)}`}
            </Button>
          ) : null}
          {breakdown !== undefined && breakdown.distinctKeys > rows.length ? (
            <SectionDescription>
              The {counted(rows.length)} with the most requests, of{" "}
              {counted(breakdown.distinctKeys)}.
            </SectionDescription>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
