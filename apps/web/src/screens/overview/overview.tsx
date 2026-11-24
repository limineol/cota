import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import {
  Page,
  PageDescription,
  PageHeader,
  PageTitle,
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from "@cota/ui/components/page";
import { PoolCards } from "@cota/ui/components/pool-card";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { Segmented } from "@cota/ui/components/segmented";
import { Skeleton } from "@cota/ui/components/skeleton";
import { Switcher, SwitcherItem } from "@cota/ui/components/switcher";
import { Updated } from "@cota/ui/components/updated";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { LayoutGrid, List } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { type Hue, poolHues } from "#shared/domain/hues.ts";
import {
  defaultOrder,
  ordered,
  type PoolOrder,
  poolOrders,
} from "#shared/domain/pool-order.ts";
import { ago, span } from "#shared/domain/quantities.ts";
import { Name, useNameOf } from "#shared/names.tsx";
import { NowProvider, useNow } from "#shared/now.tsx";
import { Problem } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import {
  defaultRange,
  during,
  type Range,
  rangeOptions,
  rangeTitle,
  spanOf,
  startOf,
  thirtyDays,
} from "#shared/range.ts";
import type { SessionsSearch } from "#shared/sessions-search.ts";
import { dayOf, millis, plural, when } from "#shared/words.ts";
import { BreakdownTable } from "./breakdowns.tsx";
import { PoolInFocus } from "./focus.tsx";
import {
  allTimeLabel,
  allTimeOf,
  type Figures,
  FleetSummary,
  FleetSummarySkeleton,
  PoolCardsSkeleton,
  PoolCardView,
  type Sum,
  sumOf,
  usageOf,
} from "./pools.tsx";
import {
  type BreakdownRow,
  startOfToday,
  useBeforeToday,
  useBreakdown,
  useLogNow,
  usePoolFigures,
  usePools,
  useSeries,
  useTotals,
} from "./queries.ts";
import { TotalsGrid, TotalsSkeleton, TrafficPanels } from "./traffic.tsx";

type Layout = "grid" | "list";

const layoutKey = "cota-pool-layout";

const storedLayout = (): Layout => {
  try {
    return localStorage.getItem(layoutKey) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

const keepLayout = (layout: Layout) => {
  try {
    localStorage.setItem(layoutKey, layout);
  } catch {
    // A browser that refuses storage keeps the choice for this page only.
  }
};

const layouts: ReadonlyArray<{
  readonly value: Layout;
  readonly label: string;
  readonly icon: ReactNode;
}> = [
  { value: "grid", label: "Grid", icon: <LayoutGrid /> },
  { value: "list", label: "List", icon: <List /> },
];

const orderLabels = {
  usage: "Usage",
  name: "Name",
  "all-time": allTimeLabel,
} satisfies Record<PoolOrder, string>;

const orders = poolOrders.map((value) => ({
  value,
  label: orderLabels[value],
}));

/** A link to the overview is the current page only when its query matches whole, not when it is part of the current one. */
const exactly = { exact: true } as const;

const noRows = { rows: [], distinctKeys: 0 };

const rowsByKey = (rows: ReadonlyArray<BreakdownRow> | undefined) =>
  new Map((rows ?? []).map((row) => [row.key, row]));

export function Overview() {
  return (
    <NowProvider>
      <OverviewPage />
    </NowProvider>
  );
}

function OverviewPage() {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const selected = search.pool ?? null;
  const range = search.range ?? defaultRange;
  const order = search.sort ?? defaultOrder;
  const [layout, setLayout] = useState(storedLayout);
  const queries = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["overview"] });
  const now = useNow();
  const nameOf = useNameOf();

  const dayStart = startOfToday(now);
  const pools = usePools();
  const figures = usePoolFigures(dayStart);
  const log = useLogNow();
  const first = log.data?.firstRequestAt;
  const showAllTime =
    first === undefined || (first !== null && now - first >= thirtyDays);
  const beforeToday = useBeforeToday(first, dayStart, showAllTime);
  const start = startOf(range, first);
  const totals = useTotals(selected, start);
  const series = useSeries(selected, start);
  const projects = useBreakdown("project", selected, start, selected === null);
  const models = useBreakdown("model", selected, start, selected === null);
  const listedIn: Pick<SessionsSearch, "range" | "pool"> = {
    ...(range === "7d" ? {} : { range }),
    ...(selected === null ? {} : { pool: [selected] }),
  };

  const list = pools.data?.pools;
  const hues = useMemo(
    () => poolHues((list ?? []).map((pool) => pool.id)),
    [list],
  );
  const glyphs = useMemo(
    () =>
      new Map((list ?? []).map((pool) => [pool.id, glyphOf(pool.provider)])),
    [list],
  );
  const hueOf = (pool: string): Hue => hues.get(pool) ?? "neutral";
  const today = rowsByKey(figures.today.data?.rows);
  const month = rowsByKey(figures.month.data?.rows);
  const active = rowsByKey(figures.active.data?.rows);
  const loaded =
    figures.today.data !== undefined &&
    figures.month.data !== undefined &&
    figures.active.data !== undefined;
  const sinceTheLogBegan = (pool: string | null): Sum | undefined => {
    const rowsOf = (answer: { readonly rows: ReadonlyArray<BreakdownRow> }) =>
      pool === null
        ? answer.rows
        : answer.rows.filter((row) => row.key === pool);
    if (first === undefined) return undefined;
    if (!showAllTime) {
      return figures.month.data === undefined
        ? undefined
        : sumOf(rowsOf(figures.month.data));
    }
    return beforeToday.data === undefined || figures.today.data === undefined
      ? undefined
      : sumOf([...rowsOf(beforeToday.data), ...rowsOf(figures.today.data)]);
  };
  const figuresOf = (pool: string): Figures => ({
    today: today.get(pool),
    month: month.get(pool),
    active: active.get(pool),
    loaded,
    allTime: sinceTheLogBegan(pool),
  });
  const cards = ordered(
    (list ?? []).map((pool) => {
      const figures = figuresOf(pool.id);
      return {
        pool,
        figures,
        id: pool.id,
        name: nameOf("pool", pool.id),
        usage: loaded ? usageOf(figures) : 0,
        allTime: allTimeOf(figures),
      };
    }),
    order,
  );
  const since =
    first !== undefined && first !== null && now - first < thirtyDays
      ? dayOf(first)
      : null;
  const emptyLog = first === null;
  const nothingToRead = range === "all" && emptyLog;
  const from =
    totals.data === undefined ? undefined : millis(totals.data.window.from);
  const compared =
    range !== "all" &&
    from !== undefined &&
    first !== undefined &&
    first !== null &&
    first < from;
  const focused =
    selected === null ? undefined : list?.find((pool) => pool.id === selected);
  const scope = selected === null ? "All pools" : nameOf("pool", selected);

  const failed = [
    pools,
    figures.today,
    figures.month,
    figures.active,
    beforeToday,
    log,
  ].find((query) => query.isError && query.data === undefined);
  const refresh = () => queries.invalidateQueries({ queryKey: ["overview"] });
  const chooseLayout = (next: Layout) => {
    keepLayout(next);
    setLayout(next);
  };
  const chooseRange = (next: Range) =>
    navigate({
      search: ({ range: _range, ...rest }) =>
        next === defaultRange ? rest : { ...rest, range: next },
      replace: true,
      resetScroll: false,
    });
  const chooseOrder = (next: PoolOrder) =>
    navigate({
      search: ({ sort: _sort, ...rest }) =>
        next === defaultOrder ? rest : { ...rest, sort: next },
      replace: true,
      resetScroll: false,
    });

  const trafficEmpty = emptyLog
    ? "The request log is empty: no client has sent a request through this hub yet."
    : range === "all"
      ? `No traffic ${during[range]}.`
      : `No traffic ${during[range]}. Try a longer range.`;

  const covered = () => {
    if (range === "all") {
      if (first === undefined) return "Loading";
      if (first === null) return "the request log is empty";
      return `the whole request log, since ${when(first, now)} (${span(now - first)})`;
    }
    if (from === undefined) return "Loading";
    const window = `${when(from, now)} → now`;
    if (compared) return `${window}, compared with the ${spanOf[range]} before`;
    if (first !== undefined && first !== null) {
      return `${window} · the request log begins ${when(first, now)}`;
    }
    return window;
  };

  return (
    <Page className="@container">
      <section aria-labelledby="pools-title">
        <PageHeader>
          <div>
            <PageTitle id="pools-title">Pools</PageTitle>
            <PageDescription>
              {list === undefined ? (
                <Skeleton className="inline-block w-72 align-middle" />
              ) : (
                <>
                  {plural(list.length, "pool")} ·{" "}
                  {list.filter((pool) => pool.windows.length > 0).length} with
                  quota windows
                  {log.data === undefined
                    ? null
                    : log.data.sessions > 0
                      ? ` · ${plural(log.data.sessions, "active session")}`
                      : " · nothing running"}
                </>
              )}
            </PageDescription>
          </div>
          <Updated busy={fetching > 0} onRefresh={refresh}>
            {fetching > 0
              ? "Refreshing…"
              : pools.dataUpdatedAt > 0
                ? `Updated ${ago(now - pools.dataUpdatedAt)}`
                : ""}
          </Updated>
        </PageHeader>

        <div className="mb-4.5 flex flex-wrap items-center justify-between gap-3">
          <Switcher aria-label="Pool">
            <SwitcherItem
              current={selected === null}
              render={
                <Link
                  from="/"
                  to="/"
                  search={({ pool: _pool, ...rest }) => rest}
                  activeOptions={exactly}
                />
              }
            >
              All pools
            </SwitcherItem>
            {(list ?? []).map((pool) => (
              <SwitcherItem
                key={pool.id}
                current={selected === pool.id}
                render={
                  <Link
                    from="/"
                    to="/"
                    search={(previous) => ({ ...previous, pool: pool.id })}
                    activeOptions={exactly}
                  />
                }
              >
                <PoolMark
                  hue={hueOf(pool.id)}
                  name={nameOf("pool", pool.id)}
                  glyph={glyphOf(pool.provider)}
                />
                <Name kind="pool" value={pool.id} />
              </SwitcherItem>
            ))}
          </Switcher>
          {selected === null ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Segmented
                label="Sort pools by"
                value={order}
                options={orders}
                onValueChange={chooseOrder}
              />
              <Segmented
                label="Show pools as"
                value={layout}
                options={layouts}
                onValueChange={chooseLayout}
                iconOnly
              />
            </div>
          ) : null}
        </div>

        {failed === undefined ? null : (
          <Problem
            title={
              failed === pools
                ? "The hub could not read the pools."
                : "The hub could not read the request log."
            }
            error={failed.error}
            onRetry={refresh}
          />
        )}

        {selected !== null ? (
          focused !== undefined ? (
            <PoolInFocus
              pool={focused}
              hue={hueOf(focused.id)}
              figures={figuresOf(focused.id)}
              since={since}
              first={first}
              showAllTime={showAllTime}
            />
          ) : list !== undefined ? (
            <Empty>
              <EmptyTitle>There is no pool called “{selected}”.</EmptyTitle>
              <EmptyDescription>
                The hub's configuration has no pool by that id.{" "}
                <Link
                  from="/"
                  to="/"
                  search={({ pool: _pool, ...rest }) => rest}
                >
                  Show all pools
                </Link>
              </EmptyDescription>
            </Empty>
          ) : (
            <Skeleton className="h-96 w-full" />
          )
        ) : list === undefined ? (
          pools.isError ? null : (
            <>
              <FleetSummarySkeleton showAllTime={showAllTime} />
              <PoolCardsSkeleton layout={layout} />
            </>
          )
        ) : (
          <>
            {loaded && log.data !== undefined ? (
              <FleetSummary
                pools={list}
                today={figures.today.data?.rows ?? []}
                month={figures.month.data?.rows ?? []}
                allTime={showAllTime ? sinceTheLogBegan(null) : null}
                active={figures.active.data?.rows ?? []}
                sessions={log.data.sessions}
                since={since}
                first={log.data.firstRequestAt}
              />
            ) : (
              <FleetSummarySkeleton showAllTime={showAllTime} />
            )}
            {list.length === 0 ? (
              <Empty>
                <EmptyTitle>The hub has no pools.</EmptyTitle>
                <EmptyDescription>
                  Pools are the subscriptions and keys in the hub's
                  configuration. Add one there and restart the hub.
                </EmptyDescription>
              </Empty>
            ) : (
              <PoolCards layout={layout} aria-label="Pools">
                {cards.map(({ pool, figures }) => (
                  <PoolCardView
                    key={pool.id}
                    pool={pool}
                    hue={hueOf(pool.id)}
                    figures={figures}
                    since={since}
                    showAllTime={showAllTime}
                  />
                ))}
              </PoolCards>
            )}
          </>
        )}
      </section>

      <Section
        aria-labelledby="traffic-title"
        stale={
          !nothingToRead &&
          (totals.isPlaceholderData || series.isPlaceholderData)
        }
      >
        <SectionHeader>
          <div>
            <SectionTitle id="traffic-title">Traffic</SectionTitle>
            <SectionDescription>
              {scope} · {covered()}
            </SectionDescription>
          </div>
          <Segmented
            label="Time range"
            value={range}
            options={rangeOptions}
            onValueChange={chooseRange}
          />
        </SectionHeader>
        {nothingToRead ? (
          <Empty>
            <EmptyTitle>The request log is empty.</EmptyTitle>
            <EmptyDescription>
              No client has sent a request through this hub yet. Point a client
              at one of its pools to see its traffic here.
            </EmptyDescription>
          </Empty>
        ) : (
          <>
            {totals.isError && totals.data === undefined ? (
              <Problem
                title="The hub could not read the request log."
                error={totals.error}
                onRetry={() => totals.refetch()}
              />
            ) : totals.data === undefined ? (
              <TotalsSkeleton />
            ) : (
              <TotalsGrid
                overview={totals.data}
                compared={compared}
                links={{
                  sessions: <Link to="/sessions" search={listedIn} />,
                  errors: <Link to="/errors" search={listedIn} />,
                }}
              />
            )}
            <TrafficPanels
              overview={totals.data}
              series={series.data}
              hues={hues}
              glyphs={glyphs}
              empty={trafficEmpty}
            />
          </>
        )}
      </Section>

      {selected === null ? (
        <Section
          aria-labelledby="breakdowns-title"
          stale={
            !nothingToRead &&
            (projects.isPlaceholderData || models.isPlaceholderData)
          }
        >
          <SectionHeader>
            <div>
              <SectionTitle id="breakdowns-title">
                Projects and models
              </SectionTitle>
              <SectionDescription>{rangeTitle[range]}</SectionDescription>
            </div>
          </SectionHeader>
          <div className="grid gap-3.5 @5xl:grid-cols-2">
            <BreakdownTable
              title="Projects"
              kind="project"
              breakdown={nothingToRead ? noRows : projects.data}
              during={nothingToRead ? "yet" : during[range]}
              linkOf={(key) => (
                <Link to="/sessions" search={{ ...listedIn, project: [key] }} />
              )}
            />
            <BreakdownTable
              title="Models"
              kind="model"
              breakdown={nothingToRead ? noRows : models.data}
              during={nothingToRead ? "yet" : during[range]}
              linkOf={(key) => (
                <Link to="/sessions" search={{ ...listedIn, model: [key] }} />
              )}
            />
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
