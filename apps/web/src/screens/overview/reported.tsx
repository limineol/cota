import { Badge } from "@cota/ui/components/badge";
import { PoolCardNote } from "@cota/ui/components/pool-card";
import { PoolFocusNote } from "@cota/ui/components/pool-focus";
import {
  ReportedThrough,
  ReportedThroughLine,
  ReportedThroughName,
  ReportedThroughTitle,
  ReportedThroughWhen,
} from "@cota/ui/components/reported-through";
import { Skeleton } from "@cota/ui/components/skeleton";
import { ago } from "#shared/domain/quantities.ts";
import { useNameOf } from "#shared/names.tsx";
import { useNow } from "#shared/now.tsx";
import { problemOf } from "#shared/problem.tsx";
import { millis, when } from "#shared/words.ts";
import { type Pool, type Reporter, useReportedThrough } from "./queries.ts";

const nothingYet = {
  short: "Nothing has reported to it yet",
  long: "No machine has reported to this pool yet: cota requests add, on the machine whose client bills it, starts its request reporter.",
};

function Lines({
  reporters,
  size,
}: {
  readonly reporters: ReadonlyArray<Reporter>;
  readonly size: "card" | "detail";
}) {
  const now = useNow();
  const nameOf = useNameOf();
  return (
    <ReportedThrough size={size}>
      <ReportedThroughTitle>Reported through</ReportedThroughTitle>
      {reporters.map((reporter) => {
        const through = millis(reporter.through);
        return (
          <ReportedThroughLine key={`${reporter.machine}\n${reporter.client}`}>
            <ReportedThroughName title={reporter.machine}>
              {nameOf("machine", reporter.machine)} ·{" "}
              {nameOf("client", reporter.client)}
            </ReportedThroughName>
            {reporter.late ? <Badge>Late</Badge> : null}
            <ReportedThroughWhen
              title={`Through ${when(through, now)}; last reported ${when(millis(reporter.reportedAt), now)} by ${reporter.reportedBy}`}
            >
              {ago(now - through)}
            </ReportedThroughWhen>
          </ReportedThroughLine>
        );
      })}
    </ReportedThrough>
  );
}

const ofPool = (reporters: ReadonlyArray<Reporter>, pool: Pool) =>
  reporters.filter((reporter) => reporter.pool === pool.id);

/** An observed pool card's windows slot: how far each machine has reported to it, or why nothing shows. */
export function CardReportedThrough({ pool }: { readonly pool: Pool }) {
  const read = useReportedThrough();
  if (read.data === undefined) {
    return read.isError ? (
      <PoolCardNote title={problemOf(read.error)}>
        Reported through could not be read
      </PoolCardNote>
    ) : (
      <Skeleton className="w-40" />
    );
  }
  const reporters = ofPool(read.data.reporters, pool);
  return reporters.length === 0 ? (
    <PoolCardNote title={nothingYet.long}>{nothingYet.short}</PoolCardNote>
  ) : (
    <Lines reporters={reporters} size="card" />
  );
}

/** An observed pool in full: why it has no windows, then how far each machine has reported to it. */
export function FocusReportedThrough({ pool }: { readonly pool: Pool }) {
  const read = useReportedThrough();
  if (read.data === undefined) {
    return read.isError ? (
      <PoolFocusNote>
        Reported through could not be read. {problemOf(read.error)}
      </PoolFocusNote>
    ) : (
      <Skeleton className="h-12 w-full" />
    );
  }
  const reporters = ofPool(read.data.reporters, pool);
  return reporters.length === 0 ? (
    <PoolFocusNote>{nothingYet.long}</PoolFocusNote>
  ) : (
    <Lines reporters={reporters} size="detail" />
  );
}
