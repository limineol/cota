import { Badge } from "@cota/ui/components/badge";
import {
  PoolFocus,
  PoolFocusBody,
  PoolFocusHead,
  PoolFocusLists,
  PoolFocusMeta,
  PoolFocusName,
  PoolFocusNote,
  PoolFocusProblem,
  PoolFocusState,
  PoolFocusSubheading,
  PoolFocusTitle,
  PoolFocusUsage,
  PoolFocusWindows,
} from "@cota/ui/components/pool-focus";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { RankItem, RankList } from "@cota/ui/components/rank-list";
import { Skeleton } from "@cota/ui/components/skeleton";
import { TriangleAlert } from "lucide-react";
import type { Hue } from "#shared/domain/hues.ts";
import { ago, tokens } from "#shared/domain/quantities.ts";
import { useNameOf } from "#shared/names.tsx";
import { useNow } from "#shared/now.tsx";
import { glyphOf } from "#shared/providers.tsx";
import { millis, tokensIn } from "#shared/words.ts";
import {
  allTimeLabel,
  allTimeNote,
  type Figures,
  LiveState,
  monthNote,
  sumOf,
  UsageFigure,
  WindowLine,
} from "./pools.tsx";
import { type BreakdownRow, type Pool, useTop } from "./queries.ts";
import { FocusReportedThrough } from "./reported.tsx";
import { kindName, noWindows, readingProblem } from "./words.ts";

const topRows = 5;

function TopList({
  title,
  kind,
  rows,
  hue,
  since,
}: {
  readonly title: string;
  readonly kind: "project" | "model";
  readonly rows: ReadonlyArray<BreakdownRow> | undefined;
  readonly hue: Hue;
  readonly since: string | null;
}) {
  const nameOf = useNameOf();
  const heading = `${title} · ${since === null ? "last 30 days" : `since ${since}`}`;
  const id = `top-${kind}`;
  const ranked = (rows ?? [])
    .toSorted((a, b) => tokensIn(b.usage) - tokensIn(a.usage))
    .slice(0, topRows);
  const peak = Math.max(1, ...ranked.map((row) => tokensIn(row.usage)));
  return (
    <section aria-labelledby={id}>
      <PoolFocusSubheading id={id}>{heading}</PoolFocusSubheading>
      {rows === undefined ? (
        <Skeleton className="h-20 w-full" />
      ) : ranked.length === 0 ? (
        <PoolFocusNote>
          {since === null
            ? "Nothing in the last 30 days."
            : `Nothing since ${since}.`}
        </PoolFocusNote>
      ) : (
        <RankList>
          {ranked.map((row) => (
            <RankItem
              key={row.key}
              label={
                <span title={row.key}>
                  {row.key === "" ? `No ${kind}` : nameOf(kind, row.key)}
                </span>
              }
              value={tokens(tokensIn(row.usage))}
              fraction={tokensIn(row.usage) / peak}
              hue={hue}
            />
          ))}
        </RankList>
      )}
    </section>
  );
}

/** One pool in full: its plan and state, every window with its pace, its traffic, and where its tokens went. */
export function PoolInFocus({
  pool,
  hue,
  figures,
  since,
  first,
  showAllTime,
}: {
  readonly pool: Pool;
  readonly hue: Hue;
  readonly figures: Figures;
  readonly since: string | null;
  /** When the request log begins, `null` when it is empty, until read `undefined`. */
  readonly first: number | null | undefined;
  readonly showAllTime: boolean;
}) {
  const now = useNow();
  const nameOf = useNameOf();
  const projects = useTop("project", pool.id, true);
  const models = useTop("model", pool.id, true);
  const problem = pool.windows.length > 0 ? readingProblem(pool) : null;
  const today = sumOf(figures.today === undefined ? [] : [figures.today]);
  const month = sumOf(figures.month === undefined ? [] : [figures.month]);
  return (
    <PoolFocus aria-labelledby="focus-name">
      <PoolFocusHead>
        <PoolFocusTitle>
          <PoolMark
            hue={hue}
            name={pool.id}
            glyph={glyphOf(pool.provider)}
            size="lg"
          />
          <PoolFocusName id="focus-name" title={pool.id}>
            {nameOf("pool", pool.id)}
          </PoolFocusName>
          {pool.plan === null ? null : <Badge>{pool.plan}</Badge>}
          <PoolFocusMeta>
            {kindName[pool.kind]} · {pool.provider}
          </PoolFocusMeta>
        </PoolFocusTitle>
        <PoolFocusState>
          <LiveState figures={figures} since={since} />
          {pool.observedAt === null ? null : (
            <span>Updated {ago(now - millis(pool.observedAt))}</span>
          )}
        </PoolFocusState>
      </PoolFocusHead>
      {problem === null ? null : (
        <PoolFocusProblem>
          <TriangleAlert aria-hidden="true" />
          {problem}
        </PoolFocusProblem>
      )}
      <PoolFocusBody>
        <PoolFocusWindows
          aria-label={
            pool.kind === "observed"
              ? "Quota windows and reported through"
              : "Quota windows"
          }
        >
          {pool.windows.length > 0 ? (
            pool.windows.map((window) => (
              <WindowLine
                key={`${window.lengthMs}-${window.scope ?? ""}`}
                window={window}
                pool={pool.id}
                hue={hue}
                detailed
              />
            ))
          ) : (
            <PoolFocusNote>{noWindows(pool).long}</PoolFocusNote>
          )}
          {pool.kind === "observed" ? (
            <FocusReportedThrough pool={pool} />
          ) : null}
        </PoolFocusWindows>
        <PoolFocusUsage aria-label={`${nameOf("pool", pool.id)} traffic`}>
          {figures.loaded ? (
            <>
              <UsageFigure
                label="Today"
                sum={today}
                size="xl"
                variant="plain"
              />
              <UsageFigure
                label={since === null ? "Last 30 days" : `Since ${since}`}
                sum={month}
                size="xl"
                variant="plain"
                note={monthNote(today, month, since)}
              />
            </>
          ) : (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          )}
          {showAllTime ? (
            figures.allTime === undefined ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <UsageFigure
                label={allTimeLabel}
                sum={figures.allTime}
                size="xl"
                variant="plain"
                note={
                  first === null || first === undefined
                    ? undefined
                    : allTimeNote(first)
                }
              />
            )
          ) : null}
        </PoolFocusUsage>
      </PoolFocusBody>
      <PoolFocusLists>
        <TopList
          title="Top projects"
          kind="project"
          rows={projects.data?.rows}
          hue={hue}
          since={since}
        />
        <TopList
          title="Top models"
          kind="model"
          rows={models.data?.rows}
          hue={hue}
          since={since}
        />
      </PoolFocusLists>
    </PoolFocus>
  );
}
