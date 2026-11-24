import { Badge } from "@cota/ui/components/badge";
import { BlockMeter } from "@cota/ui/components/block-meter";
import {
  PoolCard,
  PoolCardFigure,
  PoolCardFoot,
  PoolCardHead,
  PoolCardName,
  PoolCardNote,
  PoolCardState,
  PoolCards,
  PoolCardWindows,
} from "@cota/ui/components/pool-card";
import { PoolMark } from "@cota/ui/components/pool-mark";
import {
  Pace,
  QuotaWindow,
  QuotaWindowFoot,
  QuotaWindowHead,
  QuotaWindowLabel,
  QuotaWindowReset,
  QuotaWindowUsed,
} from "@cota/ui/components/quota-window";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  Stat,
  StatLabel,
  StatMeta,
  StatNote,
  StatUnit,
  StatValue,
} from "@cota/ui/components/stat";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Hue } from "#shared/domain/hues.ts";
import { meter } from "#shared/domain/meter.ts";
import { ago, share, span, tokens } from "#shared/domain/quantities.ts";
import { Name, useNameOf } from "#shared/names.tsx";
import { useNow } from "#shared/now.tsx";
import { glyphOf } from "#shared/providers.tsx";
import {
  costText,
  dayOf,
  dollarsOf,
  inputIn,
  millis,
  plural,
  tokensIn,
  when,
} from "#shared/words.ts";
import type { BreakdownRow, Pool, QuotaWindow as Window } from "./queries.ts";
import { CardReportedThrough } from "./reported.tsx";
import { kindName, noWindows, paceOf, usedText, windowName } from "./words.ts";

const cardWindows = 3;

/** One pool's traffic in each window the cards show; a pool absent from a window had no traffic in it. */
export interface Figures {
  readonly today: BreakdownRow | undefined;
  readonly month: BreakdownRow | undefined;
  readonly active: BreakdownRow | undefined;
  /** Whether the windows' answers have arrived. */
  readonly loaded: boolean;
  /** Its traffic since the request log began, until read `undefined`. */
  readonly allTime: Sum | undefined;
}

/** One quota window: its name, how much is used, the countdown to its reset, and its block meter. */
export function WindowLine({
  window,
  pool,
  hue,
  detailed,
}: {
  readonly window: Window;
  readonly pool: string;
  readonly hue: Hue;
  readonly detailed: boolean;
}) {
  const now = useNow();
  const nameOf = useNameOf();
  const name = windowName(window);
  const pace = paceOf(window, now);
  const {
    blocks,
    severity,
    pace: marker,
  } = meter({
    usedPercent: window.usedPercent,
    elapsed: window.standing?.elapsed ?? null,
  });
  const resetsAt = window.resetsAt === null ? null : millis(window.resetsAt);
  const used = usedText(window);
  return (
    <QuotaWindow size={detailed ? "detail" : "card"}>
      <QuotaWindowHead>
        <QuotaWindowLabel>{name}</QuotaWindowLabel>
        <QuotaWindowUsed>{used}</QuotaWindowUsed>
        <QuotaWindowReset
          title={
            resetsAt === null ? undefined : `Resets ${when(resetsAt, now)}`
          }
        >
          {resetsAt === null
            ? "Not started"
            : `Resets in ${span(resetsAt - now)}`}
        </QuotaWindowReset>
      </QuotaWindowHead>
      <BlockMeter
        blocks={blocks}
        pace={marker}
        severity={severity}
        hue={hue}
        size={detailed ? "detail" : "card"}
        label={`${nameOf("pool", pool)}, ${name} window`}
        valueText={pace === null ? used : `${used}, ${pace.text}`}
      />
      {detailed && (pace !== null || resetsAt !== null) ? (
        <QuotaWindowFoot>
          {pace === null ? null : <Pace tone={pace.tone}>{pace.text}</Pace>}
          {resetsAt === null ? null : <span>Resets {when(resetsAt, now)}</span>}
        </QuotaWindowFoot>
      ) : null}
    </QuotaWindow>
  );
}

/** Whether the pool is busy now, else when it was last asked anything. */
export function LiveState({
  figures,
  since,
}: {
  readonly figures: Figures;
  readonly since: string | null;
}) {
  const now = useNow();
  if (!figures.loaded) return <Skeleton className="w-28" />;
  const sessions = figures.active?.sessions ?? 0;
  if (sessions > 0) {
    return (
      <Badge
        variant="live"
        title="Sessions with a request in the last 15 minutes"
      >
        {plural(sessions, "active session")}
      </Badge>
    );
  }
  if (figures.month !== undefined) {
    return <span>Last request {ago(now - millis(figures.month.lastAt))}</span>;
  }
  return (
    <span>
      {since === null ? "No requests in 30 days" : `No requests since ${since}`}
    </span>
  );
}

/** A pool's usage as the cards are ordered by it: its tokens over the last 30 days, every class summed, none without traffic. */
export const usageOf = (figures: Figures): number =>
  figures.month === undefined ? 0 : tokensIn(figures.month.usage);

/** A pool's usage since the request log began, as the cards are ordered by it; none until it is read. */
export const allTimeOf = (figures: Figures): number =>
  figures.allTime?.tokens ?? 0;

const figureOf = (sum: Sum) => (
  <>
    <strong>{tokens(sum.tokens)}</strong>
    {costText(sum.dollars, sum.unpriced)}
  </>
);

const rowFigure = (row: BreakdownRow | undefined) =>
  figureOf(sumOf(row === undefined ? [] : [row]));

/** A pool in the All view: its state, up to three windows and its traffic. It opens the pool. */
export function PoolCardView({
  pool,
  hue,
  figures,
  since,
  showAllTime,
}: {
  readonly pool: Pool;
  readonly hue: Hue;
  readonly figures: Figures;
  readonly since: string | null;
  /** Whether the figure since the request log began stands apart from the 30 days', which it is not while the log is younger. */
  readonly showAllTime: boolean;
}) {
  const hidden = pool.windows.length - cardWindows;
  const observed = pool.kind === "observed";
  const none = pool.windows.length === 0 && !observed ? noWindows(pool) : null;
  return (
    <PoolCard
      render={
        <Link
          from="/"
          to="/"
          search={(previous) => ({ ...previous, pool: pool.id })}
        />
      }
      idle={figures.loaded && figures.month === undefined}
    >
      <PoolCardHead>
        <PoolMark
          hue={hue}
          name={pool.id}
          glyph={glyphOf(pool.provider)}
          size="md"
        />
        <PoolCardName>
          <Name kind="pool" value={pool.id} />
        </PoolCardName>
        <Badge>{pool.plan ?? kindName[pool.kind]}</Badge>
        <PoolCardState>
          <LiveState figures={figures} since={since} />
        </PoolCardState>
      </PoolCardHead>
      <PoolCardWindows>
        {pool.windows.slice(0, cardWindows).map((window) => (
          <WindowLine
            key={`${window.lengthMs}-${window.scope ?? ""}`}
            window={window}
            pool={pool.id}
            hue={hue}
            detailed={false}
          />
        ))}
        {observed ? <CardReportedThrough pool={pool} /> : null}
        {none === null ? null : (
          <PoolCardNote title={none.long}>{none.short}</PoolCardNote>
        )}
        {hidden > 0 ? (
          <PoolCardNote>+{plural(hidden, "more window")}</PoolCardNote>
        ) : null}
      </PoolCardWindows>
      <PoolCardFoot>
        <PoolCardFigure label="Today">
          {figures.loaded ? (
            rowFigure(figures.today)
          ) : (
            <Skeleton className="mt-1 w-24" />
          )}
        </PoolCardFigure>
        <PoolCardFigure
          label={since === null ? "Last 30 days" : `Since ${since}`}
        >
          {figures.loaded ? (
            rowFigure(figures.month)
          ) : (
            <Skeleton className="mt-1 w-24" />
          )}
        </PoolCardFigure>
        {showAllTime ? (
          <PoolCardFigure label={allTimeLabel}>
            {figures.allTime === undefined ? (
              <Skeleton className="mt-1 w-24" />
            ) : (
              figureOf(figures.allTime)
            )}
          </PoolCardFigure>
        ) : null}
      </PoolCardFoot>
    </PoolCard>
  );
}

export function PoolCardsSkeleton({
  layout,
}: {
  readonly layout: "grid" | "list";
}) {
  return (
    <PoolCards layout={layout} aria-label="Pools" aria-busy>
      {Array.from({ length: 6 }, (_, index) => (
        <PoolCard
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
          key={index}
          render={<div aria-hidden="true" />}
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="w-3/4" />
        </PoolCard>
      ))}
    </PoolCards>
  );
}

export interface Sum {
  readonly requests: number;
  readonly tokens: number;
  readonly input: number;
  readonly cacheRead: number;
  readonly dollars: number;
  readonly unpriced: number;
}

export const sumOf = (rows: ReadonlyArray<BreakdownRow>): Sum =>
  rows.reduce<Sum>(
    (sum, row) => ({
      requests: sum.requests + row.requests,
      tokens: sum.tokens + tokensIn(row.usage),
      input: sum.input + inputIn(row.usage),
      cacheRead: sum.cacheRead + row.usage.cacheRead,
      dollars: sum.dollars + dollarsOf(row.costUsd),
      unpriced: sum.unpriced + row.unpricedRequests,
    }),
    { requests: 0, tokens: 0, input: 0, cacheRead: 0, dollars: 0, unpriced: 0 },
  );

/** A window's traffic as a large figure: its tokens, then its cost, requests and the share read from cache. */
export function UsageFigure({
  label,
  sum,
  size,
  variant,
  note,
}: {
  readonly label: string;
  readonly sum: Sum;
  readonly size: "lg" | "xl";
  readonly variant: "panel" | "plain";
  readonly note?: string | undefined;
}) {
  return (
    <Stat variant={variant}>
      <StatLabel>{label}</StatLabel>
      <StatValue size={size}>
        {tokens(sum.tokens)}
        <StatUnit>tokens</StatUnit>
      </StatValue>
      <StatMeta>
        <strong>{costText(sum.dollars, sum.unpriced)}</strong> ·{" "}
        {plural(sum.requests, "request")}
        {sum.input > 0
          ? ` · ${share(sum.cacheRead / sum.input)} from cache`
          : ""}
      </StatMeta>
      {note === undefined ? null : <StatNote>{note}</StatNote>}
    </Stat>
  );
}

/** What the figure since the request log began is called, on its card and as the order of the cards. */
export const allTimeLabel = "All time";

/**
 * What the 30-day figure's note says: that it is all from today, rather than
 * show one figure twice unexplained, or else, while the request log is younger
 * than 30 days (`since` its first day), that it is the whole log.
 */
export const monthNote = (today: Sum, month: Sum, since: string | null) =>
  month.requests > 0 && month.requests === today.requests
    ? "All of it from today"
    : since === null
      ? undefined
      : "The whole request log";

/** Since when the figure of the whole request log counts, from its first request's day. */
export const allTimeNote = (first: number) =>
  `The whole request log, since ${dayOf(first)}`;

interface NextReset {
  readonly pool: string;
  readonly window: Window;
  readonly at: number;
}

const soonestReset = (
  pools: ReadonlyArray<Pool>,
  now: number,
): NextReset | null => {
  let best: NextReset | null = null;
  for (const pool of pools) {
    for (const window of pool.windows) {
      if (window.resetsAt === null) continue;
      const at = millis(window.resetsAt);
      if (at > now && (best === null || at < best.at)) {
        best = { pool: pool.id, window, at };
      }
    }
  }
  return best;
};

const summaryGrid = {
  three: "mb-3 grid grid-cols-2 gap-2.5 @3xl:grid-cols-3 wide:gap-3",
  four: "mb-3 grid grid-cols-2 gap-2.5 @5xl:grid-cols-4 wide:gap-3",
} as const;

/** Every pool together: today, the last 30 days, since the request log began when that is longer, and now. */
export function FleetSummary({
  pools,
  today,
  month,
  allTime,
  active,
  sessions,
  since,
  first,
}: {
  readonly pools: ReadonlyArray<Pool>;
  readonly today: ReadonlyArray<BreakdownRow>;
  readonly month: ReadonlyArray<BreakdownRow>;
  /** Every pool's traffic since the request log began, until read `undefined`, or `null` while it is the 30 days'. */
  readonly allTime: Sum | null | undefined;
  readonly active: ReadonlyArray<BreakdownRow>;
  readonly sessions: number;
  readonly since: string | null;
  readonly first: number | null;
}) {
  const now = useNow();
  const daySum = sumOf(today);
  const monthSum = sumOf(month);
  const busy = active.filter((row) => row.sessions > 0).length;
  const next = soonestReset(pools, now);
  const cards = allTime === null ? "three" : "four";
  return (
    <div className={summaryGrid[cards]}>
      <UsageFigure label="Today" sum={daySum} size="lg" variant="panel" />
      <UsageFigure
        label={since === null ? "Last 30 days" : `Since ${since}`}
        sum={monthSum}
        size="lg"
        variant="panel"
        note={monthNote(daySum, monthSum, since)}
      />
      {allTime === null ? null : allTime === undefined ? (
        <UsageFigureSkeleton />
      ) : (
        <UsageFigure
          label={allTimeLabel}
          sum={allTime}
          size="lg"
          variant="panel"
          note={first === null ? undefined : allTimeNote(first)}
        />
      )}
      <NowStat wide={cards === "three"}>
        <StatLabel>Now</StatLabel>
        <StatValue size="lg">
          {sessions}
          <StatUnit>
            {sessions === 1 ? "active session" : "active sessions"}
          </StatUnit>
        </StatValue>
        <StatMeta>
          {busy > 0 ? `${plural(busy, "pool")} busy` : "Nothing running"}
          {next === null ? null : (
            <>
              {" · "}next reset{" "}
              <strong>
                <Name kind="pool" value={next.pool} />
              </strong>{" "}
              {windowName(next.window)} in{" "}
              <strong>{span(next.at - now)}</strong>
            </>
          )}
        </StatMeta>
      </NowStat>
    </div>
  );
}

/** The Now card, across both columns of a phone's summary when it is the third of three. */
function NowStat({
  wide,
  children,
}: {
  readonly wide: boolean;
  readonly children: ReactNode;
}) {
  return wide ? (
    <Stat variant="panel" className="col-span-2 @3xl:col-span-1">
      {children}
    </Stat>
  ) : (
    <Stat variant="panel">{children}</Stat>
  );
}

const skeletonLines = (
  <>
    <Skeleton className="w-20" />
    <Skeleton className="h-7 w-36" />
    <Skeleton className="w-44" />
  </>
);

function UsageFigureSkeleton() {
  return (
    <Stat variant="panel" aria-hidden="true">
      {skeletonLines}
    </Stat>
  );
}

/** The summary while it is read, with as many cards as it will have when that is known. */
export function FleetSummarySkeleton({
  showAllTime,
}: {
  readonly showAllTime: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={summaryGrid[showAllTime ? "four" : "three"]}
    >
      <UsageFigureSkeleton />
      <UsageFigureSkeleton />
      {showAllTime ? <UsageFigureSkeleton /> : null}
      <NowStat wide={!showAllTime}>{skeletonLines}</NowStat>
    </div>
  );
}
