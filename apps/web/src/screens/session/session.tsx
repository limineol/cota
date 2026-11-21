import { BackLink } from "@cota/ui/components/back-link";
import { Button } from "@cota/ui/components/button";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { Identifier } from "@cota/ui/components/identifier";
import { Page } from "@cota/ui/components/page";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { Skeleton } from "@cota/ui/components/skeleton";
import { Tabs, TabsItem } from "@cota/ui/components/tabs";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { Predicate } from "effect";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { poolHues } from "#shared/domain/hues.ts";
import { rememberedList } from "#shared/last-list.ts";
import { useNameOf } from "#shared/names.tsx";
import { NowProvider, useNow } from "#shared/now.tsx";
import { Problem } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import { TranscriptControls } from "#shared/transcript/controls.tsx";
import { switched } from "#shared/transcript/hidden.ts";
import {
  type Expansion,
  type Hideable,
  hiddenCounts,
} from "#shared/transcript/transcript.tsx";
import { counted } from "#shared/words.ts";
import { Conversation } from "./conversation.tsx";
import { Figures } from "./figures.tsx";
import { Header } from "./header.tsx";
import { type RequestSummary, usePoolList, useSession } from "./queries.ts";
import { listedOf, Requests, rowIdOf, shownAtOnce } from "./requests.tsx";
import {
  type Outcome,
  outcomes,
  type Role,
  roles,
  type SessionSearch,
} from "./search.ts";
import { Timeline } from "./timeline.tsx";

export function Session() {
  return (
    <NowProvider>
      <SessionPage />
    </NowProvider>
  );
}

function Back() {
  return (
    <BackLink render={<Link to="/sessions" search={rememberedList()} />}>
      Sessions
    </BackLink>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="The session is loading">
      <Skeleton className="mb-3 h-8 w-2/3" />
      <Skeleton className="mb-3 w-1/3" />
      <Skeleton className="mb-8 w-1/2" />
      <div className="mb-10 grid grid-cols-2 gap-2.5 @3xl:grid-cols-4 @7xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the tiles held are counted, not named
          <Skeleton key={at} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="mb-10 h-48 w-full" />
    </div>
  );
}

/** A tab's link is the current page only when its query matches whole, not when it is part of the current one. */
const exactly = { exact: true } as const;

const isMissing = (error: unknown) =>
  Predicate.isTagged(error, "NoSuchSessionProblem");

function SessionPage() {
  const { session } = useParams({ from: "/sessions/$session" });
  const now = useNow();
  const nameOf = useNameOf();
  const search = useSearch({ from: "/sessions/$session" });
  const navigate = useNavigate({ from: "/sessions/$session" });
  const detail = useSession(session);
  const pools = usePoolList();
  const tab = search.tab ?? "conversation";
  const role = search.role ?? [];
  const outcome = search.outcome ?? [];
  const [shown, setShown] = useState(shownAtOnce);
  const [marked, setMarked] = useState<{
    readonly request: string;
    readonly count: number;
  } | null>(null);
  const focusing = useRef<string | null>(null);

  useEffect(() => {
    if (tab !== "requests" || marked === null) return;
    if (focusing.current !== marked.request) return;
    const link = document.getElementById(rowIdOf(marked.request));
    if (link === null) return;
    focusing.current = null;
    link.scrollIntoView({ block: "center", behavior: "smooth" });
    link.focus({ preventScroll: true });
  }, [tab, marked]);

  const hidden = new Set(search.hide ?? []);
  const [expansion, setExpansion] = useState<Expansion>({ open: false });

  const choose = (change: (previous: SessionSearch) => SessionSearch) =>
    navigate({ search: change, replace: true, resetScroll: false });

  const switchHidden = (key: Hideable, hide: boolean) =>
    choose(switched(key, hide));

  const chooseRole = (each: Role, on: boolean) => {
    setShown(shownAtOnce);
    choose(({ role: before = [], ...rest }) => {
      const after = roles.filter((value) =>
        value === each ? on : before.includes(value),
      );
      return after.length === 0 ? rest : { ...rest, role: after };
    });
  };

  const chooseOutcome = (each: Outcome, on: boolean) => {
    setShown(shownAtOnce);
    choose(({ outcome: before = [], ...rest }) => {
      const after = outcomes.filter((value) =>
        value === each ? on : before.includes(value),
      );
      return after.length === 0 ? rest : { ...rest, outcome: after };
    });
  };

  const reset = () => {
    setShown(shownAtOnce);
    choose(({ role: _role, outcome: _outcome, ...rest }) => rest);
  };

  const activate = (request: RequestSummary) => {
    const keptRole = role.includes(request.requestRole) ? role : [];
    const keptOutcome = outcome.includes(request.outcome) ? outcome : [];
    const at = listedOf(
      detail.data?.requests ?? [],
      keptRole,
      keptOutcome,
    ).findIndex((each) => each.id === request.id);
    const kept = keptRole === role && keptOutcome === outcome;
    setShown((before) =>
      Math.max(
        kept ? before : shownAtOnce,
        Math.ceil((at + 1) / shownAtOnce) * shownAtOnce,
      ),
    );
    navigate({
      search: ({ role: _role, outcome: _outcome, ...rest }) => ({
        ...rest,
        tab: "requests",
        ...(keptRole.length === 0 ? {} : { role: keptRole }),
        ...(keptOutcome.length === 0 ? {} : { outcome: keptOutcome }),
      }),
      resetScroll: false,
    });
    focusing.current = request.id;
    setMarked((before) => ({
      request: request.id,
      count: (before?.count ?? 0) + 1,
    }));
  };

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

  if (detail.isError && isMissing(detail.error)) {
    return (
      <Page className="@container">
        <Back />
        <Empty className="my-12">
          <EmptyTitle>There is no such session.</EmptyTitle>
          <EmptyDescription>
            No request in the request log carries this session id. It may have
            been mistyped, or its requests may be older than the log keeps.
          </EmptyDescription>
          <Identifier value={session} label="session id" className="my-2" />
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/sessions" search={rememberedList()} />}
          >
            Back to the sessions
          </Button>
        </Empty>
      </Page>
    );
  }

  const answer = detail.data;
  const [onlyPool] = answer?.session.pools ?? [];
  const hue =
    answer?.session.pools.length === 1 && onlyPool !== undefined
      ? (hues.get(onlyPool) ?? "neutral")
      : "neutral";

  return (
    <Page className="@container">
      <Back />
      {detail.isError ? (
        <Problem
          title="The hub could not read this session."
          error={detail.error}
          onRetry={() => detail.refetch()}
        />
      ) : null}
      {answer === undefined ? (
        detail.isError ? null : (
          <Loading />
        )
      ) : (
        <>
          <Header row={answer.session} markOf={markOf} />
          <Figures answer={answer} now={now} />
          <Timeline
            requests={answer.requests}
            segments={answer.segments}
            hue={hue}
            now={now}
            onActivate={activate}
          />
          <Tabs
            aria-label="What the session holds"
            className="mt-10 mb-6 wide:mt-14"
            end={
              tab === "conversation" && answer.transcript !== null ? (
                <TranscriptControls
                  counts={hiddenCounts(answer.transcript.entries)}
                  hidden={hidden}
                  onHiddenChange={switchHidden}
                  onExpansion={setExpansion}
                />
              ) : null
            }
          >
            <TabsItem
              current={tab === "conversation"}
              render={
                <Link
                  from="/sessions/$session"
                  to="/sessions/$session"
                  params={{ session }}
                  search={({ tab: _tab, ...rest }) => rest}
                  activeOptions={exactly}
                  replace
                  resetScroll={false}
                />
              }
            >
              Conversation
            </TabsItem>
            <TabsItem
              current={tab === "requests"}
              count={counted(answer.requests.length)}
              render={
                <Link
                  from="/sessions/$session"
                  to="/sessions/$session"
                  params={{ session }}
                  search={(previous) => ({ ...previous, tab: "requests" })}
                  activeOptions={exactly}
                  replace
                  resetScroll={false}
                />
              }
            >
              Requests
            </TabsItem>
          </Tabs>
          {tab === "conversation" ? (
            <Conversation
              answer={answer}
              now={now}
              hidden={hidden}
              expansion={expansion}
            />
          ) : (
            <Requests
              requests={answer.requests}
              requestsCut={answer.requestsCut}
              role={role}
              outcome={outcome}
              onRoleChange={chooseRole}
              onOutcomeChange={chooseOutcome}
              onReset={reset}
              shown={shown}
              onShowMore={() => setShown((before) => before + shownAtOnce)}
              marked={marked?.request ?? null}
            />
          )}
        </>
      )}
    </Page>
  );
}
