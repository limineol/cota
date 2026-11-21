import {
  type BlockColumn,
  BlockColumns,
  type ColumnsLayout,
  type Series,
} from "@cota/ui/components/block-columns";
import { BlockMix, type MixPart } from "@cota/ui/components/block-mix";
import { Card } from "@cota/ui/components/card";
import { Legend, LegendItem } from "@cota/ui/components/legend";
import { Subheading } from "@cota/ui/components/page";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { Segmented } from "@cota/ui/components/segmented";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  Stat,
  StatDelta,
  StatLabel,
  StatNote,
  StatValue,
} from "@cota/ui/components/stat";
import { ArrowUpRight } from "lucide-react";
import { type ReactElement, type ReactNode, useMemo, useState } from "react";
import { apportion, mixBlocks } from "#shared/domain/blocks.ts";
import { type Bucket, merge, stack } from "#shared/domain/columns.ts";
import type { Hue } from "#shared/domain/hues.ts";
import { cost, delta, share, tokens } from "#shared/domain/quantities.ts";
import { Name, useNameOf } from "#shared/names.tsx";
import {
  costText,
  counted,
  dayOf,
  dollarsOf,
  inputIn,
  millis,
  plural,
  stretch,
  timeOf,
  tokensIn,
} from "#shared/words.ts";
import type { SeriesAnswer, useTotals } from "./queries.ts";

type Overview = NonNullable<ReturnType<typeof useTotals>["data"]>;
type Totals = Overview["totals"];

interface Figure {
  readonly label: string;
  readonly value: string;
  readonly current: number;
  readonly previous: number;
  readonly note?: string | undefined;
  readonly worse?: boolean;
  readonly listed?: Listed;
}

/** The figures that lead to where their requests are listed. */
export type Listed = "sessions" | "errors";

const figuresOf = (totals: Totals, previous: Totals): ReadonlyArray<Figure> => {
  const input = inputIn(totals.usage);
  const errors = totals.outcomes.error;
  const dollars = dollarsOf(totals.costUsd);
  const unreported =
    totals.usageUnreported > 0
      ? `${plural(totals.usageUnreported, "request")} reported no usage`
      : undefined;
  return [
    {
      label: "Requests",
      value: counted(totals.requests),
      current: totals.requests,
      previous: previous.requests,
    },
    {
      label: "Sessions",
      listed: "sessions",
      value: counted(totals.sessions),
      current: totals.sessions,
      previous: previous.sessions,
    },
    {
      label: "Input tokens",
      value: tokens(input),
      current: input,
      previous: inputIn(previous.usage),
      note:
        unreported ??
        (input > 0
          ? `${share(totals.usage.cacheRead / input)} cache reads`
          : undefined),
    },
    {
      label: "Output tokens",
      value: tokens(totals.usage.output),
      current: totals.usage.output,
      previous: previous.usage.output,
      note:
        totals.usage.reasoning > 0
          ? `${tokens(totals.usage.reasoning)} reasoning`
          : undefined,
    },
    {
      label: "Cost",
      value: costText(dollars, totals.unpricedRequests),
      current: dollars,
      previous: dollarsOf(previous.costUsd),
      note:
        totals.unpricedRequests > 0
          ? `${plural(totals.unpricedRequests, "request")} with no price`
          : "at API list prices",
    },
    {
      label: "Errors",
      listed: "errors",
      value: counted(errors),
      current: errors,
      previous: previous.outcomes.error,
      note:
        errors > 0 ? `${share(errors / totals.requests)} of requests` : "none",
      worse: true,
    },
  ];
};

const totalsGrid =
  "grid grid-cols-2 gap-2.5 @3xl:grid-cols-3 @5xl:grid-cols-6 wide:gap-3";

/** The range's six totals, each with how it changed since the window before when that window holds any of the request log; the sessions and the errors lead to their lists by `links`. */
export function TotalsGrid({
  overview,
  compared,
  links,
}: {
  readonly overview: Overview;
  readonly compared: boolean;
  readonly links: Readonly<Record<Listed, ReactElement>>;
}) {
  return (
    <div className={totalsGrid}>
      {figuresOf(overview.totals, overview.previousTotals).map((figure) => {
        const change = delta(figure.current, figure.previous);
        return (
          <Stat
            key={figure.label}
            variant="tile"
            {...(figure.listed === undefined
              ? {}
              : { render: links[figure.listed] })}
          >
            <StatLabel>
              {figure.label}
              {figure.listed === undefined ? null : (
                <ArrowUpRight aria-hidden="true" />
              )}
            </StatLabel>
            <StatValue
              tone={
                figure.worse === true && figure.current > 0
                  ? "danger"
                  : "default"
              }
            >
              {figure.value}
              {compared ? (
                <StatDelta
                  direction={change.direction}
                  worse={figure.worse === true}
                  title={`The ${figure.label.toLowerCase()} of the window before`}
                >
                  {change.text}
                </StatDelta>
              ) : null}
            </StatValue>
            {figure.note === undefined ? null : (
              <StatNote>{figure.note}</StatNote>
            )}
          </Stat>
        );
      })}
    </div>
  );
}

export function TotalsSkeleton() {
  return (
    <div aria-hidden="true" className={totalsGrid}>
      {Array.from({ length: 6 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
        <Stat key={index} variant="tile">
          <Skeleton className="w-16" />
          <Skeleton className="h-6 w-24" />
        </Stat>
      ))}
    </div>
  );
}

/** Where the range's tokens went: cache reads, cache writes, uncached input and output, as fifty blocks. */
export function TokenMix({
  totals,
  empty,
}: {
  readonly totals: Totals;
  readonly empty: string;
}) {
  const usage = totals.usage;
  const values = [
    usage.cacheRead,
    usage.cacheWriteShort + usage.cacheWriteLong,
    usage.input,
    usage.output,
  ];
  const total = tokensIn(usage);
  const blocks = apportion(values, mixBlocks);
  const labels = ["Cache read", "Cache write", "Uncached input", "Output"];
  const tints = ["ramp-1", "ramp-2", "ramp-3", "ramp-4"] as const;
  const parts: ReadonlyArray<MixPart> = values.map((value, index) => ({
    key: labels[index] ?? "",
    label: labels[index] ?? "",
    value: tokens(value),
    share: share(total === 0 ? 0 : value / total),
    blocks: blocks[index] ?? 0,
    tint: tints[index] ?? "ramp-1",
  }));
  return <BlockMix label="Where the tokens went" parts={parts} empty={empty} />;
}

type Metric = "tokens" | "requests" | "cost";

const day = 86_400_000;

const metrics: ReadonlyArray<{
  readonly value: Metric;
  readonly label: string;
}> = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
  { value: "cost", label: "Cost" },
];

const bucketLength: Record<SeriesAnswer["bucket"], number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 3_600_000,
  "3h": 3 * 3_600_000,
  "6h": 6 * 3_600_000,
  "12h": 12 * 3_600_000,
  "1d": day,
  "7d": 7 * day,
};

type Point = SeriesAnswer["points"][number];

const pointValue = (point: Point, metric: Metric) =>
  metric === "tokens"
    ? tokensIn(point.usage)
    : metric === "requests"
      ? point.requests
      : dollarsOf(point.costUsd);

const writerOf = (metric: Metric) =>
  metric === "tokens" ? tokens : metric === "requests" ? counted : cost;

const unitText = (metric: Metric, unit: number) =>
  metric === "tokens"
    ? `${tokens(unit)} ${unit === 1 ? "token" : "tokens"}`
    : metric === "requests"
      ? plural(unit, "request")
      : cost(unit);

/** Lays the series out as buckets from the window's start to its end, one part per key, empty buckets included. */
const bucketsOf = (series: SeriesAnswer, metric: Metric) => {
  const step = bucketLength[series.bucket];
  const starts = series.points.map((point) => millis(point.at));
  let first = starts[0] ?? series.from;
  while (first > series.from) first -= step;
  const byStart = new Map<number, Array<number>>();
  for (let at = first; at < series.to; at += step) {
    byStart.set(
      at,
      series.keys.map(() => 0),
    );
  }
  series.points.forEach((point, index) => {
    const at = starts[index] ?? 0;
    const parts = byStart.get(at) ?? series.keys.map(() => 0);
    const key = series.keys.indexOf(point.key);
    parts[key] = (parts[key] ?? 0) + pointValue(point, metric);
    byStart.set(at, parts);
  });
  return [...byStart.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([start, parts]): Bucket => ({ start, end: start + step, parts }));
};

/** The range's traffic as block columns, one hue per pool. */
export function PoolColumns({
  series,
  hues,
  glyphs,
  empty,
}: {
  readonly series: SeriesAnswer;
  readonly hues: ReadonlyMap<string, Hue>;
  readonly glyphs: ReadonlyMap<string, ReactNode>;
  readonly empty: string;
}) {
  const [metric, setMetric] = useState<Metric>("tokens");
  const nameOf = useNameOf();
  const days = series.to - series.from > day;
  const buckets = useMemo(() => bucketsOf(series, metric), [series, metric]);
  const write = writerOf(metric);
  const entries: ReadonlyArray<Series> = series.keys.map((key) => ({
    key: key ?? "other",
    label: key === null ? "Other pools" : nameOf("pool", key),
    tint: key === null ? "neutral" : (hues.get(key) ?? "neutral"),
    mark: (
      <PoolMark
        hue={key === null ? "neutral" : (hues.get(key) ?? "neutral")}
        name={key === null ? "Other" : nameOf("pool", key)}
        glyph={key === null ? undefined : glyphs.get(key)}
      />
    ),
  }));
  const fit = (capacity: number): ColumnsLayout => {
    const { unit, columns } = stack(
      merge(buckets, capacity),
      metric === "cost" ? 0.01 : 1,
    );
    return {
      unit: unitText(metric, unit),
      columns: columns.map(
        (column): BlockColumn => ({
          key: String(column.bucket.start),
          label: stretch(column.bucket.start, column.bucket.end, series.to),
          tick: !days
            ? timeOf(column.bucket.start)
            : column.bucket.end - column.bucket.start >= day
              ? dayOf(column.bucket.start)
              : `${dayOf(column.bucket.start)} ${timeOf(column.bucket.start)}`,
          total: write(column.total),
          parts: column.parts.map((blocks, index) => {
            const value = column.bucket.parts[index] ?? 0;
            return { blocks, value: value > 0 ? write(value) : null };
          }),
        }),
      ),
    };
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Subheading>Over time, by pool</Subheading>
        <Segmented
          label="Chart metric"
          value={metric}
          options={metrics}
          onValueChange={setMetric}
        />
      </div>
      <BlockColumns
        series={entries}
        fit={fit}
        label={`${metrics.find((each) => each.value === metric)?.label ?? ""} over time, by pool`}
        empty={empty}
      />
      {series.keys.length > 0 ? (
        <Legend aria-label="Pools in this chart">
          {series.keys.map((key) => (
            <LegendItem key={key ?? "other"}>
              <PoolMark
                hue={key === null ? "neutral" : (hues.get(key) ?? "neutral")}
                name={key === null ? "Other" : nameOf("pool", key)}
                glyph={key === null ? undefined : glyphs.get(key)}
              />
              {key === null ? "Other pools" : <Name kind="pool" value={key} />}
            </LegendItem>
          ))}
        </Legend>
      ) : null}
    </>
  );
}

export function TrafficPanels({
  overview,
  series,
  hues,
  glyphs,
  empty,
}: {
  readonly overview: Overview | undefined;
  readonly series: SeriesAnswer | undefined;
  readonly hues: ReadonlyMap<string, Hue>;
  readonly glyphs: ReadonlyMap<string, ReactNode>;
  readonly empty: string;
}) {
  return (
    <div className="mt-3.5 flex flex-col gap-3.5">
      <Card size="compact">
        <Subheading>Where the tokens went</Subheading>
        {overview === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <TokenMix totals={overview.totals} empty={empty} />
        )}
      </Card>
      <Card size="compact">
        {series === undefined ? (
          <>
            <Subheading>Over time, by pool</Subheading>
            <Skeleton className="h-44 w-full" />
          </>
        ) : (
          <PoolColumns
            series={series}
            hues={hues}
            glyphs={glyphs}
            empty={empty}
          />
        )}
      </Card>
    </div>
  );
}
