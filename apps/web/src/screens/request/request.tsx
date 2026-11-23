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
import { type ReactNode, useMemo } from "react";
import { poolHues } from "#shared/domain/hues.ts";
import { rememberedList } from "#shared/last-list.ts";
import { useNameOf } from "#shared/names.tsx";
import { NowProvider } from "#shared/now.tsx";
import { Problem } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import { switched } from "#shared/transcript/hidden.ts";
import type { Hideable } from "#shared/transcript/transcript.tsx";
import { counted } from "#shared/words.ts";
import { Conversation } from "./conversation.tsx";
import { Figures } from "./figures.tsx";
import { Header } from "./header.tsx";
import { MetadataPanel } from "./metadata.tsx";
import { ErrorPanel, ParamsPanel, ToolsPanel } from "./panels.tsx";
import { type Inspected, useInspected, usePoolList } from "./queries.ts";
import type { Tab } from "./search.ts";
import { UsagePanel } from "./usage.tsx";
import { failed, reported } from "./words.ts";

export function Request() {
  return (
    <NowProvider>
      <RequestPage />
    </NowProvider>
  );
}

const withoutSession = "request:";

function Back({ answer }: { readonly answer: Inspected | undefined }) {
  const session = answer?.request.session;
  if (session === undefined || session.startsWith(withoutSession)) {
    return (
      <BackLink render={<Link to="/sessions" search={rememberedList()} />}>
        Sessions
      </BackLink>
    );
  }
  return (
    <BackLink render={<Link to="/sessions/$session" params={{ session }} />}>
      Session
    </BackLink>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="The request is loading">
      <Skeleton className="mb-3 h-8 w-1/2" />
      <Skeleton className="mb-3 w-1/3" />
      <Skeleton className="mb-8 w-1/4" />
      <div className="mb-10 grid grid-cols-2 gap-2.5 @3xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the tiles held are counted, not named
          <Skeleton key={at} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="mb-6 h-9 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const isMissing = (error: unknown) =>
  Predicate.isTagged(error, "NoSuchRequestProblem");

/** A tab's link is the current page only when its query matches whole, not when it is part of the current one. */
const exactly = { exact: true } as const;

const tabNames: Record<Tab, string> = {
  error: "Error",
  output: "Output",
  input: "Input",
  tools: "Tools",
  params: "Params",
  metadata: "Metadata",
  usage: "Token usage",
};

/** The tabs a request has, in order, each with what it counts: the Error tab only for a request that failed or was refused, and no count of tools a reported request cannot know. */
const tabsOf = (answer: Inspected) => {
  const input =
    answer.system === null && answer.input === null
      ? null
      : (answer.system?.length ?? 0) + (answer.input?.length ?? 0);
  const all: ReadonlyArray<{ readonly tab: Tab; readonly count?: number }> = [
    { tab: "error" },
    ...(answer.output === null
      ? [{ tab: "output" as const }]
      : [{ tab: "output" as const, count: answer.output.length }]),
    ...(input === null
      ? [{ tab: "input" as const }]
      : [{ tab: "input" as const, count: input }]),
    ...(answer.tools === null || reported(answer.request)
      ? [{ tab: "tools" as const }]
      : [{ tab: "tools" as const, count: answer.tools.length }]),
    { tab: "params" },
    { tab: "metadata" },
    { tab: "usage" },
  ];
  return failed(answer.request)
    ? all
    : all.filter((each) => each.tab !== "error");
};

function RequestPage() {
  const { id } = useParams({ from: "/requests/$id" });
  const search = useSearch({ from: "/requests/$id" });
  const navigate = useNavigate({ from: "/requests/$id" });
  const nameOf = useNameOf();
  const inspected = useInspected(id);
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

  const answer = inspected.data;

  if (inspected.isError && isMissing(inspected.error)) {
    return (
      <Page className="@container">
        <Back answer={undefined} />
        <Empty className="my-12">
          <EmptyTitle>There is no such request.</EmptyTitle>
          <EmptyDescription>
            The request log has no request with this id. It may have been
            mistyped, or the request may be older than the log keeps.
          </EmptyDescription>
          <Identifier value={id} label="request id" className="my-2" />
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

  const hidden = new Set(search.hide ?? []);
  const switchHidden = (key: Hideable, hide: boolean) =>
    navigate({
      search: switched(key, hide),
      replace: true,
      resetScroll: false,
    });

  return (
    <Page className="@container">
      <Back answer={answer} />
      {inspected.isError ? (
        <Problem
          title="The hub could not read this request."
          error={inspected.error}
          onRetry={() => inspected.refetch()}
        />
      ) : null}
      {answer === undefined ? (
        inspected.isError ? null : (
          <Loading />
        )
      ) : (
        <Inspector
          answer={answer}
          asked={search.tab}
          hidden={hidden}
          onHiddenChange={switchHidden}
          markOf={markOf}
        />
      )}
    </Page>
  );
}

function Inspector({
  answer,
  asked,
  hidden,
  onHiddenChange,
  markOf,
}: {
  readonly answer: Inspected;
  readonly asked: Tab | undefined;
  readonly hidden: ReadonlySet<Hideable>;
  readonly onHiddenChange: (switched: Hideable, hide: boolean) => void;
  readonly markOf: (pool: string) => ReactNode;
}) {
  const { request } = answer;
  const tabs = tabsOf(answer);
  const fallback: Tab = failed(request) ? "error" : "output";
  const tab =
    tabs.some((each) => each.tab === asked) && asked !== undefined
      ? asked
      : fallback;
  const input =
    answer.system === null && answer.input === null
      ? null
      : [...(answer.system ?? []), ...(answer.input ?? [])];

  return (
    <>
      <Header answer={answer} markOf={markOf} />
      <Figures request={request} />
      <Tabs aria-label="What the request holds" className="mb-6">
        {tabs.map((each) => (
          <TabsItem
            key={each.tab}
            current={each.tab === tab}
            {...(each.count === undefined
              ? {}
              : { count: counted(each.count) })}
            render={
              <Link
                to="/requests/$id"
                params={{ id: request.id }}
                search={({ tab: _tab, ...rest }) =>
                  each.tab === fallback ? rest : { ...rest, tab: each.tab }
                }
                activeOptions={exactly}
                replace
                resetScroll={false}
              />
            }
          >
            {tabNames[each.tab]}
          </TabsItem>
        ))}
      </Tabs>
      <section aria-label={tabNames[tab]} className="min-w-0">
        {tab === "error" ? <ErrorPanel request={request} /> : null}
        {tab === "output" ? (
          <Conversation
            key="output"
            part="output"
            entries={answer.output}
            request={request}
            cutCharacters={answer.cutCharacters}
            hidden={hidden}
            onHiddenChange={onHiddenChange}
          />
        ) : null}
        {tab === "input" ? (
          <Conversation
            key="input"
            part="input"
            entries={input}
            request={request}
            cutCharacters={answer.cutCharacters}
            hidden={hidden}
            onHiddenChange={onHiddenChange}
          />
        ) : null}
        {tab === "tools" ? <ToolsPanel answer={answer} /> : null}
        {tab === "params" ? <ParamsPanel answer={answer} /> : null}
        {tab === "metadata" ? <MetadataPanel request={request} /> : null}
        {tab === "usage" ? <UsagePanel request={request} /> : null}
      </section>
    </>
  );
}
