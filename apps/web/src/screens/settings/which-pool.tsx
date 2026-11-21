import { Button } from "@cota/ui/components/button";
import { FieldNote } from "@cota/ui/components/field-note";
import { Input } from "@cota/ui/components/input";
import {
  ListPanel,
  ListPanelHead,
  ListPanelInset,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { Subheading } from "@cota/ui/components/page";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { Skeleton } from "@cota/ui/components/skeleton";
import { Effect } from "effect";
import { type FormEvent, useId, useMemo, useState } from "react";
import { type Client, useApiQuery } from "#shared/api.ts";
import { poolHues } from "#shared/domain/hues.ts";
import type { RoutedClient } from "#shared/domain/routes.ts";
import { useNameOf } from "#shared/names.tsx";
import { problemOf } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import { usePools } from "./queries.ts";

/** A project's longest, as the hub takes one. */
const longestProject = 200;

const ask = (client: RoutedClient, project: string) => (api: Client) =>
  api.routes.answer({ query: { client, project } }).pipe(
    Effect.map((answer) => ({ _tag: "Answer", answer }) as const),
    Effect.catchTag("NoRouteProblem", () =>
      Effect.succeed({ _tag: "NoRoute" } as const),
    ),
    Effect.catchTag("RoutePoolGoneProblem", (gone) =>
      Effect.succeed({ _tag: "Gone", detail: problemOf(gone) } as const),
    ),
  );

/** "Which pool would a project bill?": the hub's answer for one launch of the client, from the routes as saved. */
export function WhichPool({
  client,
  project,
  edited,
  onAsk,
}: {
  readonly client: RoutedClient;
  readonly project: string;
  readonly edited: boolean;
  readonly onAsk: (project: string) => void;
}) {
  const title = useId();
  const nameOf = useNameOf();
  const clientName = nameOf("client", client);
  const [typed, setTyped] = useState(project);
  const [asked, setAsked] = useState(project);
  if (asked !== project) {
    setAsked(project);
    setTyped(project);
  }
  const answer = useApiQuery(
    ["settings", "route", client, project],
    project === "" ? null : ask(client, project),
  );
  const pools = usePools();
  const all = pools.data?.pools;
  const hues = useMemo(
    () => poolHues((all ?? []).map((pool) => pool.id)),
    [all],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAsk(typed.trim());
  };

  const said = () => {
    if (project === "") {
      return (
        <Note>
          Name a project as a launch reads it, such as acme/api, to see the pool
          a launch of {clientName} there bills.
        </Note>
      );
    }
    if (answer.isError) {
      return (
        <div className="flex flex-col items-start gap-2">
          <FieldNote tone="danger" className="mt-0">
            The hub could not answer: {problemOf(answer.error)}
          </FieldNote>
          <Button variant="outline" size="sm" onClick={() => answer.refetch()}>
            Try again
          </Button>
        </div>
      );
    }
    if (answer.data === undefined) {
      return (
        <div className="flex flex-col gap-1.5" aria-busy="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="w-64" />
        </div>
      );
    }
    const quoted = `“${project}”`;
    switch (answer.data._tag) {
      case "NoRoute":
        return (
          <FieldNote className="mt-0">
            No route of {clientName} matches {quoted}, and {clientName} has no
            default pool: a launch there stops.
          </FieldNote>
        );
      case "Gone":
        return (
          <div className="flex flex-col gap-0.5">
            <FieldNote tone="danger" className="mt-0">
              The route that answers {quoted} names a pool {clientName} cannot
              bill now, so a launch there stops until the route is changed.
            </FieldNote>
            <Note>{answer.data.detail}</Note>
          </div>
        );
      case "Answer": {
        const { pool, by, route } = answer.data.answer;
        const name = nameOf("pool", pool.id);
        return (
          <div className="flex flex-col gap-0.5" role="status">
            <span className="flex min-w-0 items-center gap-1.75">
              <PoolMark
                hue={hues.get(pool.id) ?? "neutral"}
                name={name}
                glyph={glyphOf(pool.provider)}
              />
              <span title={pool.id}>{name}</span>
            </span>
            <Note>
              {by === "route" && route !== null
                ? `Route ${route.position}, ${route.pattern}, is the first to match ${quoted}.`
                : by === "default"
                  ? `No route matches ${quoted}, so the default pool answers.`
                  : `Named for this launch, whatever the routes.`}
            </Note>
          </div>
        );
      }
    }
  };

  return (
    <ListPanel aria-labelledby={title}>
      <ListPanelHead>
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <Subheading level={2} id={title}>
            Which pool would a project bill?
          </Subheading>
          <Note>
            The hub's answer to a launch of {clientName}, from the routes as
            saved{edited ? ", not the edit above" : ""}.
          </Note>
        </div>
      </ListPanelHead>
      <ListPanelInset>
        <div className="flex flex-col gap-3">
          <form
            className="flex max-w-lg items-center gap-1.5"
            aria-label="Which pool would a project bill?"
            onSubmit={submit}
          >
            <Input
              aria-label="Project"
              placeholder="acme/api"
              value={typed}
              maxLength={longestProject}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
            <Button type="submit" variant="outline">
              Ask
            </Button>
          </form>
          {said()}
        </div>
      </ListPanelInset>
    </ListPanel>
  );
}
