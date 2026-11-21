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
import {
  Pager,
  PagerControls,
  PagerCount,
  PagerNote,
  PagerPage,
  PagerStep,
} from "@cota/ui/components/pager";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { SearchField } from "@cota/ui/components/search-field";
import { Segmented } from "@cota/ui/components/segmented";
import { Skeleton } from "@cota/ui/components/skeleton";
import { Table } from "@cota/ui/components/table";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { poolHues } from "#shared/domain/hues.ts";
import { pageOf } from "#shared/domain/pages.ts";
import { exact } from "#shared/domain/snippet.ts";
import { countedIn, ValuesFilter } from "#shared/filter.tsx";
import { rememberList } from "#shared/last-list.ts";
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
import { isUnreadable, unreadable } from "#shared/search-query.ts";
import {
  type Dimension,
  defaultRange,
  dimensions,
  type SessionsSearch,
  type Sort,
} from "#shared/sessions-search.ts";
import { counted, plural, tokensIn } from "#shared/words.ts";
import {
  type Chosen,
  limit,
  loose,
  useFacets,
  usePoolList,
  useSessions,
} from "./queries.ts";
import { SessionItem, SessionSkeleton, SessionsHead } from "./rows.tsx";

const typingPause = 450;

type Outcome = "ok" | "error";

const outcomeName: Record<Outcome, string> = { ok: "OK", error: "Errors" };

const isOutcome = (value: string): value is Outcome =>
  value === "ok" || value === "error";

/** A dimension's name for people, as its filter button says it. */
const dimensionName: Record<Dimension, string> = {
  pool: "Pool",
  project: "Project",
  machine: "Machine",
  client: "Client",
  provider: "Provider",
  model: "Model",
};

type Match = "exact" | "loose";

const matches: ReadonlyArray<{
  readonly value: Match;
  readonly label: string;
}> = [
  { value: "exact", label: "Exact" },
  { value: "loose", label: "Loose" },
];

const skeletonRows = 8;

const listOf = (parts: ReadonlyArray<string>) =>
  parts.length < 2
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}`;

function SearchBox({
  q,
  onSearch,
  end,
}: {
  readonly q: string | null;
  readonly onSearch: (q: string) => void;
  readonly end: ReactNode;
}) {
  const [typed, setTyped] = useState(q ?? "");
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    if ((q ?? "") !== typed.trim()) setTyped(q ?? "");
  }
  useEffect(() => {
    const wanted = typed.trim();
    if (wanted === (q ?? "")) return;
    const timer = setTimeout(() => onSearch(wanted), typingPause);
    return () => clearTimeout(timer);
  }, [typed, q, onSearch]);
  return (
    <SearchField
      aria-label="Search the sessions"
      placeholder="Search prompts, replies and tool output"
      value={typed}
      onChange={(event) => setTyped(event.target.value)}
      onSubmit={() => onSearch(typed.trim())}
      end={end}
      className="w-full @2xl/panel:w-80 @5xl/panel:w-96"
    />
  );
}

export function Sessions() {
  return (
    <NowProvider>
      <SessionsPage />
    </NowProvider>
  );
}

function SessionsPage() {
  const search = useSearch({ from: "/sessions" });
  const navigate = useNavigate({ from: "/sessions" });
  const now = useNow();
  const nameOf = useNameOf();
  useEffect(() => rememberList(search), [search]);

  const range: Range = search.range ?? defaultRange;
  const q = search.q ?? null;
  const isLoose = q !== null && search.match === "loose";
  const outcome = search.outcome ?? null;
  const sort: Sort = search.sort ?? "recent";
  const page = search.page ?? 1;
  const chosen: Chosen = {
    pool: search.pool ?? [],
    project: search.project ?? [],
    machine: search.machine ?? [],
    client: search.client ?? [],
    provider: search.provider ?? [],
    model: search.model ?? [],
  };
  const filtered =
    dimensions.some((dimension) => chosen[dimension].length > 0) ||
    outcome !== null;

  const log = useLogBegins(range === "all");
  const first = range === "all" ? log.data : undefined;
  const start = startOf(range, first);
  const emptyLog = range === "all" && first === null;
  const listing = {
    chosen,
    outcome,
    q,
    loose: isLoose,
    sort,
    page,
  };
  const list = useSessions(listing, start);
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
  const valueName = (dimension: Dimension) => (value: string) =>
    dimension === "provider" ? value : nameOf(dimension, value);

  const choose = (change: (previous: SessionsSearch) => SessionsSearch) =>
    navigate({
      search: (previous) => {
        const { page: _page, ...rest } = change(previous);
        return rest;
      },
      replace: true,
      resetScroll: false,
    });
  const toggle = (dimension: Dimension, value: string, on: boolean) =>
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
        project: _project,
        machine: _machine,
        client: _client,
        provider: _provider,
        model: _model,
        outcome: _outcome,
        ...rest
      }) => rest,
    );
  const searchFor = (next: string) =>
    choose(({ q: _q, match: _match, ...rest }) =>
      next === ""
        ? rest
        : {
            ...rest,
            q: next,
            ...(search.match === undefined ? {} : { match: search.match }),
          },
    );
  const chooseMatch = (next: Match) =>
    choose(({ match: _match, ...rest }) =>
      next === "exact" ? rest : { ...rest, match: next },
    );
  const chooseRange = (next: Range) =>
    choose(({ range: _range, ...rest }) =>
      next === defaultRange ? rest : { ...rest, range: next },
    );
  const chooseOutcome = (value: string, on: boolean) =>
    choose(({ outcome: _outcome, ...rest }) =>
      on && isOutcome(value) ? { ...rest, outcome: value } : rest,
    );

  const answer = list.data;
  const shown =
    answer === undefined ? undefined : pageOf(page, answer.total, limit);
  const tolerance = isLoose ? loose : exact;
  const failed = list.isError && answer === undefined;
  const refused = failed && isUnreadable(list.error, q);
  const facetsFailed = facets.isError && facets.data === undefined;
  const peak = Math.max(
    1,
    ...(answer?.sessions ?? []).map((row) => tokensIn(row.usage)),
  );

  const description = () => {
    if (emptyLog) return "The request log is empty";
    if (answer === undefined) {
      return failed ? (
        rangeTitle[range]
      ) : (
        <Skeleton className="inline-block w-64 align-middle" />
      );
    }
    return (
      <>
        {plural(answer.total, "session")} {during[range]}
        {q === null ? null : <> mentioning “{q}”</>}
      </>
    );
  };

  const nothing = () => {
    const tries = [
      ...(range === "all" ? [] : ["a longer range"]),
      ...(filtered ? ["fewer filters"] : []),
      ...(q !== null && !isLoose
        ? [
            "Loose, which also finds words that begin with these or are spelt nearly so",
          ]
        : []),
    ];
    const title =
      q !== null
        ? `Nothing mentions “${q}”.`
        : filtered
          ? "No sessions match."
          : `No sessions ${during[range]}.`;
    const hint =
      tries.length > 0
        ? `Try ${listOf(tries)}.`
        : q !== null
          ? "Try other words."
          : "No client has sent a request through this hub in this range.";
    return (
      <Empty>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{hint}</EmptyDescription>
      </Empty>
    );
  };

  const pageLink = (to: number) => (
    <Link
      from="/sessions"
      to="/sessions"
      search={({ page: _page, ...rest }) =>
        to === 1 ? rest : { ...rest, page: to }
      }
    />
  );
  const sortLink = (by: Sort) => (
    <Link
      from="/sessions"
      to="/sessions"
      search={({ page: _page, sort: _sort, ...rest }) =>
        by === "recent" ? rest : { ...rest, sort: by }
      }
      replace
      resetScroll={false}
    />
  );

  const body = () => {
    if (refused) {
      return (
        <Empty role="alert">
          <EmptyTitle>The hub cannot run this search.</EmptyTitle>
          <EmptyDescription>
            {q === null ? null : unreadable(q)}
          </EmptyDescription>
        </Empty>
      );
    }
    if (failed) {
      return (
        <Problem
          inside
          title="The hub could not read the sessions."
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
            No client has sent a request through this hub yet. Point a client at
            one of its pools to see its sessions here.
          </EmptyDescription>
        </Empty>
      );
    }
    if (answer === undefined) {
      return (
        <Table aria-label="Sessions loading">
          <SessionsHead sort={sort} sortLink={sortLink} />
          {Array.from({ length: skeletonRows }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
            <SessionSkeleton key={index} />
          ))}
        </Table>
      );
    }
    if (answer.total === 0) return nothing();
    if (answer.sessions.length === 0 && shown !== undefined) {
      return (
        <Empty>
          <EmptyTitle>There is no page {counted(page)}.</EmptyTitle>
          <EmptyDescription>
            The list has {plural(shown.pages, "page")} now.{" "}
            <Link
              from="/sessions"
              to="/sessions"
              search={({ page: _page, ...rest }) =>
                shown.reachable === 1
                  ? rest
                  : { ...rest, page: shown.reachable }
              }
            >
              Go to the last page
            </Link>
          </EmptyDescription>
        </Empty>
      );
    }
    return (
      <Table aria-label="Sessions">
        <SessionsHead sort={sort} sortLink={sortLink} />
        {answer.sessions.map((row) => (
          <SessionItem
            key={row.id}
            row={row}
            now={now}
            q={q}
            tolerance={tolerance}
            peak={peak}
            markOf={markOf}
          />
        ))}
      </Table>
    );
  };

  return (
    <Page className="@container">
      <PageHeader>
        <div>
          <PageTitle>Sessions</PageTitle>
          <PageDescription>{description()}</PageDescription>
        </div>
        <Segmented
          label="Time range"
          size="sm"
          value={range}
          options={rangeOptions}
          onValueChange={chooseRange}
        />
      </PageHeader>

      <ListPanel aria-label="The sessions found">
        <ListPanelHead>
          <SearchBox
            q={q}
            onSearch={searchFor}
            end={
              q === null ? null : (
                <Segmented
                  label="How the search matches words"
                  size="xs"
                  value={isLoose ? "loose" : "exact"}
                  options={matches}
                  onValueChange={chooseMatch}
                />
              )
            }
          />
          <ListPanelFilters
            end={
              filtered ? (
                <Button variant="ghost" size="sm" onClick={reset}>
                  Reset <X aria-hidden="true" />
                </Button>
              ) : null
            }
          >
            {dimensions.map((dimension) => (
              <ValuesFilter
                key={dimension}
                label={dimensionName[dimension]}
                values={emptyLog ? [] : facets.data?.[dimension]}
                failed={facetsFailed}
                chosen={chosen[dimension]}
                nameOf={valueName(dimension)}
                markOf={dimension === "pool" ? markOf : undefined}
                onToggle={(value, on) => toggle(dimension, value, on)}
                note={countedIn}
              />
            ))}
            <ValuesFilter
              label="Outcome"
              values={
                emptyLog
                  ? []
                  : facets.data?.outcome.filter((each) => isOutcome(each.value))
              }
              failed={facetsFailed}
              chosen={outcome === null ? [] : [outcome]}
              nameOf={(value) =>
                isOutcome(value) ? outcomeName[value] : value
              }
              onToggle={chooseOutcome}
              note={countedIn}
            />
          </ListPanelFilters>
          {facetsFailed ? (
            <div role="alert" className="flex items-center gap-2">
              <Note>The hub could not read the filters.</Note>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => facets.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : null}
        </ListPanelHead>

        <ListPanelBody stale={list.isPlaceholderData}>{body()}</ListPanelBody>

        {answer !== undefined &&
        shown !== undefined &&
        answer.sessions.length > 0 ? (
          <ListPanelFoot>
            <Pager aria-label="Pages">
              <PagerCount>
                {shown.pages > 1 ? (
                  <>
                    {counted(shown.first)}–{counted(shown.last)} of{" "}
                    {counted(answer.total)}
                  </>
                ) : (
                  plural(answer.total, "session")
                )}
              </PagerCount>
              {shown.pages > 1 ? (
                <PagerControls>
                  <PagerPage>
                    Page {counted(shown.page)} of {counted(shown.pages)}
                  </PagerPage>
                  <PagerStep
                    disabled={shown.page === 1}
                    render={pageLink(shown.page - 1)}
                  >
                    <ChevronLeft /> Newer
                  </PagerStep>
                  <PagerStep
                    disabled={shown.page >= shown.reachable}
                    render={pageLink(shown.page + 1)}
                  >
                    Older <ChevronRight />
                  </PagerStep>
                </PagerControls>
              ) : null}
              {shown.page === shown.reachable &&
              shown.reachable < shown.pages ? (
                <PagerNote>
                  The hub lists the first {plural(shown.last, "session")}.
                  Narrow the range or the filters to see the rest.
                </PagerNote>
              ) : null}
            </Pager>
          </ListPanelFoot>
        ) : null}
      </ListPanel>
    </Page>
  );
}
