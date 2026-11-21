import { Button } from "@cota/ui/components/button";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFilters,
  ListPanelFoot,
  ListPanelHead,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import {
  Page,
  PageDescription,
  PageHeader,
  PageTitle,
} from "@cota/ui/components/page";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { Segmented } from "@cota/ui/components/segmented";
import { Skeleton } from "@cota/ui/components/skeleton";
import { Table, TableBody } from "@cota/ui/components/table";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpRight, X } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { poolHues } from "#shared/domain/hues.ts";
import { ValuesFilter } from "#shared/filter.tsx";
import { useLogBegins } from "#shared/log-begins.ts";
import { useNameOf } from "#shared/names.tsx";
import { NowProvider, useNow } from "#shared/now.tsx";
import { Problem } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import {
  during,
  type Range,
  rangeOptions,
  rangeTitle,
  startOf,
} from "#shared/range.ts";
import { counted, plural } from "#shared/words.ts";
import {
  CauseItem,
  CauseSkeleton,
  CausesHead,
  dimensionName,
} from "./causes.tsx";
import { type Chosen, useErrors, useFacets, usePoolList } from "./queries.ts";
import {
  defaultRange,
  type ErrorsSearch,
  type Failure,
  type Filtered,
  filtered,
} from "./search.ts";

const outcomes: ReadonlyArray<{
  readonly value: Failure;
  readonly label: string;
}> = [
  { value: "error", label: "Errors" },
  { value: "refused", label: "Refused" },
  { value: "cancelled", label: "Cancelled" },
];

/** What the listed requests are called, by outcome. */
const failedRequest: Record<Failure, string> = {
  error: "failed request",
  refused: "refused request",
  cancelled: "cancelled request",
};

/** What happened to none of them, by outcome. */
const noneOf: Record<Failure, string> = {
  error: "No request failed",
  refused: "No request was refused",
  cancelled: "No request was cancelled",
};

const skeletonRows = 6;

export function Errors() {
  return (
    <NowProvider>
      <ErrorsPage />
    </NowProvider>
  );
}

function ErrorsPage() {
  const search = useSearch({ from: "/errors" });
  const navigate = useNavigate({ from: "/errors" });
  const now = useNow();
  const nameOf = useNameOf();

  const range: Range = search.range ?? defaultRange;
  const outcome: Failure = search.outcome ?? "error";
  const chosen: Chosen = {
    pool: search.pool ?? [],
    provider: search.provider ?? [],
    model: search.model ?? [],
    client: search.client ?? [],
  };
  const someChosen = filtered.some((dimension) => chosen[dimension].length > 0);

  const log = useLogBegins(range === "all");
  const first = range === "all" ? log.data : undefined;
  const start = startOf(range, first);
  const emptyLog = range === "all" && first === null;
  const list = useErrors({ chosen, outcome }, start);
  const facets = useFacets({ chosen, outcome }, start);
  const pools = usePoolList();

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
  const markOf = (pool: string): ReactNode => (
    <PoolMark
      hue={hues.get(pool) ?? "neutral"}
      name={nameOf("pool", pool)}
      glyph={glyphs.get(pool)}
    />
  );
  const valueName = (dimension: Filtered) => (value: string) =>
    dimension === "provider" ? value : nameOf(dimension, value);

  const choose = (change: (previous: ErrorsSearch) => ErrorsSearch) =>
    navigate({ search: change, replace: true, resetScroll: false });
  const toggle = (dimension: Filtered, value: string, on: boolean) =>
    choose((previous) => {
      const { [dimension]: values = [], ...rest } = previous;
      const kept = values.filter((each) => each !== value);
      const next = on ? [...kept, value] : kept;
      return next.length === 0 ? rest : { ...rest, [dimension]: next };
    });
  const reset = () =>
    choose(
      ({
        pool: _pool,
        provider: _provider,
        model: _model,
        client: _client,
        ...rest
      }) => rest,
    );
  const chooseRange = (next: Range) =>
    choose(({ range: _range, ...rest }) =>
      next === defaultRange ? rest : { ...rest, range: next },
    );
  const chooseOutcome = (next: Failure) =>
    choose(({ outcome: _outcome, ...rest }) =>
      next === "error" ? rest : { ...rest, outcome: next },
    );

  const answer = list.data;
  const failed = list.isError && answer === undefined;

  const description = () => {
    if (emptyLog) return "The request log is empty";
    if (answer === undefined) {
      return failed ? (
        rangeTitle[range]
      ) : (
        <Skeleton className="inline-block w-64 align-middle" />
      );
    }
    if (answer.requests === 0) return rangeTitle[range];
    return `${plural(answer.requests, failedRequest[outcome])} ${during[range]}, of ${plural(answer.distinctGroups, "cause")}`;
  };

  const body = () => {
    if (failed) {
      return (
        <Problem
          inside
          title="The hub could not read the errors."
          error={list.error}
          onRetry={() => list.refetch()}
        />
      );
    }
    if (emptyLog) {
      return (
        <Empty>
          <EmptyTitle>The request log is empty.</EmptyTitle>
          <EmptyDescription>
            No client has sent a request through this hub yet.
          </EmptyDescription>
        </Empty>
      );
    }
    if (answer === undefined) {
      return (
        <Table aria-label="Causes loading">
          <CausesHead />
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
              <CauseSkeleton key={index} />
            ))}
          </TableBody>
        </Table>
      );
    }
    if (answer.groups.length === 0) {
      return (
        <Empty>
          <EmptyTitle>
            {noneOf[outcome]} {during[range]}
            {someChosen ? " under these filters" : ""}.
          </EmptyTitle>
        </Empty>
      );
    }
    return (
      <Table aria-label="Causes">
        <CausesHead />
        <TableBody>
          {answer.groups.map((cause) => (
            <CauseItem
              key={cause.latestRequest}
              cause={cause}
              now={now}
              markOf={markOf}
              onFilter={(dimension, value) => toggle(dimension, value, true)}
            />
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <Page className="@container">
      <PageHeader>
        <div>
          <PageTitle>Errors</PageTitle>
          <PageDescription>{description()}</PageDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {outcome === "error" ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/sessions"
                  search={{
                    outcome: "error",
                    ...(range === "7d" ? {} : { range }),
                  }}
                />
              }
            >
              Sessions with errors <ArrowUpRight aria-hidden="true" />
            </Button>
          ) : null}
          <Segmented
            label="Time range"
            size="sm"
            value={range}
            options={rangeOptions}
            onValueChange={chooseRange}
          />
        </div>
      </PageHeader>

      <ListPanel aria-label="The causes found">
        <ListPanelHead>
          <Segmented
            label="Outcome"
            size="sm"
            value={outcome}
            options={outcomes}
            onValueChange={chooseOutcome}
          />
          <ListPanelFilters
            end={
              someChosen ? (
                <Button variant="ghost" size="sm" onClick={reset}>
                  Reset <X aria-hidden="true" />
                </Button>
              ) : null
            }
          >
            {filtered.map((dimension) => (
              <ValuesFilter
                key={dimension}
                label={dimensionName[dimension]}
                values={emptyLog ? [] : facets.data?.[dimension]}
                failed={facets.isError}
                chosen={chosen[dimension]}
                nameOf={valueName(dimension)}
                markOf={dimension === "pool" ? markOf : undefined}
                onToggle={(value, on) => toggle(dimension, value, on)}
              />
            ))}
          </ListPanelFilters>
        </ListPanelHead>

        <ListPanelBody stale={list.isPlaceholderData}>{body()}</ListPanelBody>

        {answer !== undefined && answer.groups.length > 0 ? (
          <ListPanelFoot>
            {answer.distinctGroups > answer.groups.length ? (
              <Note>
                The {counted(answer.groups.length)} latest causes are shown, of{" "}
                {counted(answer.distinctGroups)}. Narrow the range or the
                filters to see the rest.
              </Note>
            ) : (
              <span>{plural(answer.groups.length, "cause")}</span>
            )}
          </ListPanelFoot>
        ) : null}
      </ListPanel>
    </Page>
  );
}
