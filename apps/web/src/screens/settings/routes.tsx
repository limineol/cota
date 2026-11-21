import { Button } from "@cota/ui/components/button";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { FieldNote } from "@cota/ui/components/field-note";
import { Input } from "@cota/ui/components/input";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFoot,
  ListPanelHead,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { RouteFields, RouteFieldsHead } from "@cota/ui/components/route-fields";
import { Segmented } from "@cota/ui/components/segmented";
import { Select, type SelectOption } from "@cota/ui/components/select";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "@cota/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@cota/ui/components/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type Client, useApiMutation } from "#shared/api.ts";
import { poolHues } from "#shared/domain/hues.ts";
import {
  added,
  type Draft,
  moveDown,
  moveUp,
  offeredPools,
  type Placed,
  placed,
  type Refusal,
  type Refusals,
  type RoutedClient,
  removeAt,
  type Sent,
  sendingOf,
} from "#shared/domain/routes.ts";
import { useNameOf } from "#shared/names.tsx";
import { Problem, problemOf } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import { counted, millis, plural, when } from "#shared/words.ts";
import {
  type RouteList,
  readRoutesAgain,
  usePools,
  useRoutes,
} from "./queries.ts";
import { WhichPool } from "./which-pool.tsx";

/** The most routes one client's list holds (`docs/specs/routes/spec.md`, Values). */
const mostRoutes = 200;

/** A pattern's longest, as the hub takes one; a field held to it in UTF-16 units holds no more code points. */
const longestPattern = 200;

const skeletonRows = 3;

/** A client's list while it is edited: its routes as shown, its default pool, and the revision it was read at. */
export interface Edit {
  readonly revision: number;
  readonly routes: ReadonlyArray<Draft>;
  readonly defaultPool: string | null;
}

const editOf = (list: RouteList): Edit => ({
  revision: list.revision,
  routes: list.routes.map((route, index) => ({
    key: index,
    pattern: route.pattern,
    pool: route.pool,
  })),
  defaultPool: list.defaultPool?.pool ?? null,
});

const sameAs = (edit: Edit, list: RouteList) =>
  edit.routes.length === list.routes.length &&
  edit.routes.every(
    (route, index) =>
      route.pattern === list.routes[index]?.pattern &&
      route.pool === list.routes[index]?.pool,
  ) &&
  edit.defaultPool === (list.defaultPool?.pool ?? null);

type Saved =
  | { readonly _tag: "Stored" }
  | { readonly _tag: "Refused"; readonly refusals: ReadonlyArray<Refusal> }
  | { readonly _tag: "Changed" };

const changeRoutes =
  (client: RoutedClient) =>
  (sent: Sent) =>
  (api: Client): Effect.Effect<Saved, unknown> =>
    api.routes.change({ params: { client }, payload: sent }).pipe(
      Effect.as<Saved>({ _tag: "Stored" }),
      Effect.catchTag("RoutesRefusedProblem", ({ refusals }) =>
        Effect.succeed<Saved>({ _tag: "Refused", refusals }),
      ),
      Effect.catchTag("RoutesChangedProblem", () =>
        Effect.succeed<Saved>({ _tag: "Changed" }),
      ),
    );

type Outcome =
  | { readonly _tag: "Saved" }
  | { readonly _tag: "Refused"; readonly where: Refusals }
  | { readonly _tag: "Changed" }
  | { readonly _tag: "Failed"; readonly error: unknown }
  | { readonly _tag: "Unchosen"; readonly positions: ReadonlyArray<number> };

/** Where the focus goes once the list has changed under it. */
type Focus =
  | { readonly key: number; readonly control: "pattern" | "up" | "down" }
  | { readonly key: null; readonly control: "add" };

/** Settings → Routes: one routed client's routes, edited in place and saved whole, and which pool a project would bill. */
export function Routes({
  owner,
  client,
  project,
  onClientChange,
  onAsk,
}: {
  readonly owner: boolean;
  readonly client: RoutedClient;
  readonly project: string;
  readonly onClientChange: (client: RoutedClient) => void;
  readonly onAsk: (project: string) => void;
}) {
  const [edits, setEdits] = useState<ReadonlyMap<RoutedClient, Edit>>(
    new Map(),
  );
  const edit = edits.get(client) ?? null;
  return (
    <div className="flex flex-col gap-5">
      <RoutesPanel
        key={client}
        owner={owner}
        client={client}
        edit={edit}
        onEdit={(next) =>
          setEdits((before) => {
            const after = new Map(before);
            if (next === null) after.delete(client);
            else after.set(client, next);
            return after;
          })
        }
        onClientChange={onClientChange}
      />
      <WhichPool
        client={client}
        project={project}
        edited={edit !== null}
        onAsk={onAsk}
      />
    </div>
  );
}

function RoutesPanel({
  owner,
  client,
  edit,
  onEdit,
  onClientChange,
}: {
  readonly owner: boolean;
  readonly client: RoutedClient;
  readonly edit: Edit | null;
  readonly onEdit: (edit: Edit | null) => void;
  readonly onClientChange: (client: RoutedClient) => void;
}) {
  const nameOf = useNameOf();
  const queries = useQueryClient();
  const lists = useRoutes();
  const pools = usePools();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const save = useApiMutation(changeRoutes(client), async (saved, queries) => {
    if (saved._tag === "Stored") await readRoutesAgain(queries);
  });

  useEffect(() => {
    if (focus === null) return;
    controls.current.get(`${focus.control}:${focus.key ?? ""}`)?.focus();
    setFocus(null);
  }, [focus]);

  const clientName = nameOf("client", client);
  const stored = lists.data?.clients.find((list) => list.client === client);
  const all = pools.data?.pools;
  const hues = useMemo(
    () => poolHues((all ?? []).map((pool) => pool.id)),
    [all],
  );

  const markOf = (id: string): ReactNode => {
    const pool = all?.find((each) => each.id === id);
    return (
      <PoolMark
        hue={hues.get(id) ?? "neutral"}
        name={nameOf("pool", id)}
        glyph={pool === undefined ? undefined : glyphOf(pool.provider)}
      />
    );
  };

  const optionOf = (id: string): SelectOption<string | null> => ({
    value: id,
    label: nameOf("pool", id),
    mark: markOf(id),
  });

  const optionsFor = (chosen: string | null) => {
    const offered = offeredPools(client, all ?? [], chosen);
    return [
      ...offered.fitting.map((pool) => optionOf(pool.id)),
      ...(offered.unfit === null ? [] : [optionOf(offered.unfit)]),
    ];
  };

  /** Why the hub says a stored pool no longer fits, read from the pools it lists. */
  const unfitWords = (id: string, what: "route" | "default") => {
    const pool = all?.find((each) => each.id === id);
    const stops =
      what === "route"
        ? "launches of the projects this route matches stop until it is changed."
        : "launches no route matches stop until it is changed.";
    return pool === undefined
      ? `The configuration no longer has the pool ${id}: ${stops}`
      : `${nameOf("pool", id)} does not speak ${clientName}'s protocol any more: ${stops}`;
  };

  const unfit = new Set([
    ...(stored?.routes ?? [])
      .filter((route) => !route.fits)
      .map((route) => route.pool),
    ...(stored?.defaultPool?.fits === false ? [stored.defaultPool.pool] : []),
  ]);

  const shown = edit ?? (stored === undefined ? null : editOf(stored));
  const edited = edit !== null && stored !== undefined && !sameAs(edit, stored);

  const editTo = (next: Edit) => {
    if (outcome?._tag !== "Refused" && outcome?._tag !== "Changed") {
      setOutcome(null);
    }
    onEdit(next);
  };

  /** Drops what was said of a route once it changes: the hub's word was about what it was. */
  const forget = (key: number | null) => {
    if (outcome?._tag !== "Refused") return;
    const routes = new Map(outcome.where.routes);
    if (key !== null) routes.delete(key);
    setOutcome({
      _tag: "Refused",
      where: {
        ...outcome.where,
        routes,
        defaultPool: key === null ? [] : outcome.where.defaultPool,
      },
    });
  };

  const sendNow = () => {
    if (shown === null || save.isPending) return;
    const sending = sendingOf(shown.revision, shown.routes, shown.defaultPool);
    if (sending._tag === "Unchosen") {
      setOutcome({ _tag: "Unchosen", positions: sending.positions });
      return;
    }
    setOutcome(null);
    save.mutate(sending.body, {
      onSuccess: (saved) => {
        switch (saved._tag) {
          case "Stored":
            onEdit(null);
            setOutcome({ _tag: "Saved" });
            return;
          case "Refused":
            setOutcome({
              _tag: "Refused",
              where: placed(saved.refusals, sending.keys),
            });
            return;
          case "Changed":
            setOutcome({ _tag: "Changed" });
            return;
        }
      },
      onError: (error) => setOutcome({ _tag: "Failed", error }),
    });
  };

  const drop = () => {
    onEdit(null);
    setOutcome(null);
  };

  const readAgain = () => {
    onEdit(null);
    setOutcome(null);
    void readRoutesAgain(queries);
  };

  const keep =
    (key: string) =>
    (element: HTMLElement | null): void => {
      if (element === null) controls.current.delete(key);
      else controls.current.set(key, element);
    };

  const body = () => {
    if (lists.isError || pools.isError) {
      return (
        <Problem
          inside
          title={
            lists.isError
              ? "The hub could not read the routes."
              : "The hub could not list its pools."
          }
          error={lists.isError ? lists.error : pools.error}
          onRetry={() => {
            if (lists.isError) lists.refetch();
            if (pools.isError) pools.refetch();
          }}
        />
      );
    }
    if (shown === null || all === undefined) {
      return (
        <Table aria-label={`Routes of ${clientName} loading`}>
          <RoutesHead owner={owner} />
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
              <RouteSkeleton key={index} owner={owner} />
            ))}
          </TableBody>
        </Table>
      );
    }

    const refused = outcome?._tag === "Refused" ? outcome.where : null;
    const unchosen = outcome?._tag === "Unchosen";
    const positionOf = (key: number) =>
      shown.routes.findIndex((route) => route.key === key) + 1;

    const refusalWords = (said: Placed, what: "route" | "default") => {
      switch (said.reason) {
        case "not-a-pattern":
          return "Not a project pattern: a project, or the start of one followed by a single *, of at most 200 characters.";
        case "no-such-pool":
          return what === "route"
            ? "The configuration has no such pool."
            : "The configuration has no such pool: choose another, or None.";
        case "pool-not-for-client":
          return `This pool does not speak ${clientName}'s protocol.`;
        case "same-pattern":
          return "An earlier route has the same pattern, so this one would never be reached.";
        case "shadowed": {
          const position =
            said.shadowedBy === null ? 0 : positionOf(said.shadowedBy);
          const shadowing = shown.routes[position - 1];
          return position === 0 || shadowing === undefined
            ? "An earlier route matches every project this one does, so this one would never be reached."
            : `Route ${position}, ${shadowing.pattern.trim() || "with no pattern"}, matches every project this one does, so this one would never be reached.`;
        }
      }
    };

    const rows = shown.routes.map((route, index) => {
      const position = index + 1;
      const notes = [
        ...(refused?.routes.get(route.key) ?? []).map((said) => ({
          text: refusalWords(said, "route"),
          on:
            said.reason === "no-such-pool" ||
            said.reason === "pool-not-for-client"
              ? ("pool" as const)
              : ("pattern" as const),
        })),
        ...(unchosen && route.pool === null
          ? [
              {
                text: "Choose a pool for this route.",
                on: "pool" as const,
              },
            ]
          : []),
        ...(route.pool !== null && unfit.has(route.pool)
          ? [
              {
                text: unfitWords(route.pool, "route"),
                on: "pool" as const,
              },
            ]
          : []),
      ];
      const label = `route ${position}`;
      return (
        <TableRow key={route.key}>
          <TableCell numeric className="w-8 align-top">
            {owner ? (
              <span className="mt-1.5 block">{position}</span>
            ) : (
              position
            )}
          </TableCell>
          <TableCell className="w-full max-w-0">
            <RouteFields
              match={
                owner ? (
                  <Input
                    ref={keep(`pattern:${route.key}`)}
                    aria-label={`Pattern of ${label}`}
                    value={route.pattern}
                    placeholder="acme/*"
                    maxLength={longestPattern}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={
                      notes.some((note) => note.on === "pattern") || undefined
                    }
                    onChange={(event) => {
                      forget(route.key);
                      editTo({
                        ...shown,
                        routes: shown.routes.map((each) =>
                          each.key === route.key
                            ? { ...each, pattern: event.target.value }
                            : each,
                        ),
                      });
                    }}
                  />
                ) : (
                  <TableLabel title={route.pattern}>
                    <code>{route.pattern}</code>
                  </TableLabel>
                )
              }
              target={
                owner ? (
                  <Select
                    label={`Pool of ${label}`}
                    size="field"
                    className="w-full"
                    value={route.pool}
                    placeholder="Choose a pool"
                    invalid={notes.some((note) => note.on === "pool")}
                    options={optionsFor(route.pool)}
                    onValueChange={(pool) => {
                      forget(route.key);
                      editTo({
                        ...shown,
                        routes: shown.routes.map((each) =>
                          each.key === route.key ? { ...each, pool } : each,
                        ),
                      });
                    }}
                  />
                ) : (
                  <PoolName id={route.pool} mark={markOf} />
                )
              }
            />
            {notes.map((note) => (
              <FieldNote key={`${note.on}:${note.text}`} tone="danger">
                {note.text}
              </FieldNote>
            ))}
          </TableCell>
          {owner ? (
            <TableCell className="align-top">
              <span className="mt-0.5 flex items-center gap-0.5">
                <IconAction
                  label={`Move ${label} up`}
                  disabled={index === 0}
                  ref={keep(`up:${route.key}`)}
                  onClick={() => {
                    editTo({ ...shown, routes: moveUp(shown.routes, index) });
                    setFocus({
                      key: route.key,
                      control: index === 1 ? "down" : "up",
                    });
                  }}
                >
                  <ArrowUp />
                </IconAction>
                <IconAction
                  label={`Move ${label} down`}
                  disabled={index === shown.routes.length - 1}
                  ref={keep(`down:${route.key}`)}
                  onClick={() => {
                    editTo({
                      ...shown,
                      routes: moveDown(shown.routes, index),
                    });
                    setFocus({
                      key: route.key,
                      control:
                        index === shown.routes.length - 2 ? "up" : "down",
                    });
                  }}
                >
                  <ArrowDown />
                </IconAction>
                <IconAction
                  label={`Remove ${label}`}
                  onClick={() => {
                    const after = shown.routes[index + 1];
                    forget(route.key);
                    editTo({ ...shown, routes: removeAt(shown.routes, index) });
                    setFocus(
                      after === undefined
                        ? { key: null, control: "add" }
                        : { key: after.key, control: "pattern" },
                    );
                  }}
                >
                  <X />
                </IconAction>
              </span>
            </TableCell>
          ) : null}
        </TableRow>
      );
    });

    const defaultNotes = [
      ...(refused?.defaultPool ?? []).map((said) => ({
        text: refusalWords(said, "default"),
      })),
      ...(shown.defaultPool !== null && unfit.has(shown.defaultPool)
        ? [
            {
              text: unfitWords(shown.defaultPool, "default"),
            },
          ]
        : []),
    ];

    const columns = owner ? 3 : 2;
    return (
      <Table aria-label={`Routes of ${clientName}`}>
        <RoutesHead owner={owner} />
        <TableBody>
          {rows.length > 0 ? (
            rows
          ) : (
            <TableRow>
              <TableCell colSpan={columns}>
                <Empty>
                  <EmptyTitle>{clientName} has no routes.</EmptyTitle>
                  <EmptyDescription>
                    A route sends the launches of every project its pattern
                    matches, such as acme/*, to one pool. Without one, every
                    launch of {clientName} bills the default pool.
                  </EmptyDescription>
                </Empty>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {owner ? (
          <TableBody>
            <TableRow>
              <TableCell />
              <TableCell colSpan={columns - 1}>
                <Button
                  ref={keep("add:")}
                  variant="outline"
                  size="sm"
                  disabled={shown.routes.length >= mostRoutes}
                  onClick={() => {
                    const key =
                      Math.max(-1, ...shown.routes.map((route) => route.key)) +
                      1;
                    editTo({
                      ...shown,
                      routes: added(shown.routes, {
                        key,
                        pattern: "",
                        pool: null,
                      }),
                    });
                    setFocus({ key, control: "pattern" });
                  }}
                >
                  <Plus data-icon="inline-start" />
                  Add a route
                </Button>
                {shown.routes.length >= mostRoutes ? (
                  <Note className="mt-1">
                    A client keeps at most {counted(mostRoutes)} routes.
                  </Note>
                ) : null}
              </TableCell>
            </TableRow>
          </TableBody>
        ) : null}
        <TableBody>
          <TableRow>
            <TableCell numeric className="w-8" />
            <TableCell className="w-full max-w-0">
              <RouteFields
                match={<TableLabel>Any other project</TableLabel>}
                target={
                  owner ? (
                    <Select
                      label={`Default pool of ${clientName}`}
                      size="field"
                      className="w-full"
                      value={shown.defaultPool}
                      invalid={defaultNotes.length > 0}
                      options={[
                        { value: null, label: "None" },
                        ...optionsFor(shown.defaultPool),
                      ]}
                      onValueChange={(defaultPool) => {
                        forget(null);
                        editTo({ ...shown, defaultPool });
                      }}
                    />
                  ) : shown.defaultPool === null ? (
                    <TableLabel>None: the launch stops</TableLabel>
                  ) : (
                    <PoolName id={shown.defaultPool} mark={markOf} />
                  )
                }
              />
              <Note className="mt-1">
                {shown.defaultPool === null
                  ? `The default pool: with None, a launch of ${clientName} that no route matches stops.`
                  : `The default pool: a launch of ${clientName} that no route matches bills it.`}
              </Note>
              {defaultNotes.map((note) => (
                <FieldNote key={note.text} tone="danger">
                  {note.text}
                </FieldNote>
              ))}
            </TableCell>
            {owner ? <TableCell /> : null}
          </TableRow>
        </TableBody>
      </Table>
    );
  };

  const foot = () => {
    if (shown === null || stored === undefined || all === undefined) {
      return null;
    }
    const summary =
      stored.changedAt === null
        ? "Never saved"
        : `Saved ${when(millis(stored.changedAt), Date.now())}`;
    const status = () => {
      if (save.isPending) return <span>Saving…</span>;
      switch (outcome?._tag) {
        case "Saved":
          return <FieldNote className="mt-0">Saved.</FieldNote>;
        case "Unchosen":
          return (
            <FieldNote tone="danger" className="mt-0">
              Not saved: {outcome.positions.length === 1 ? "route" : "routes"}{" "}
              {outcome.positions.join(", ")}{" "}
              {outcome.positions.length === 1 ? "has" : "have"} no pool.
            </FieldNote>
          );
        case "Refused": {
          const count =
            [...outcome.where.routes.values()].length +
            (outcome.where.defaultPool.length > 0 ? 1 : 0);
          return (
            <FieldNote tone="danger" className="mt-0">
              Not saved: the hub refused{" "}
              {count === 0 ? "the routes" : plural(count, "row")}, as said on{" "}
              {count === 1 ? "it" : "each"}.
              {outcome.where.unplaced.length > 0
                ? ` It also refused ${outcome.where.unplaced
                    .map((refusal) => `route ${refusal.position}`)
                    .join(", ")}, which is no longer listed.`
                : ""}
            </FieldNote>
          );
        }
        case "Changed":
          return (
            <FieldNote tone="danger" className="mt-0">
              Not saved: the routes of {clientName} were changed from another
              browser since they were read. Reading them again drops this edit.
            </FieldNote>
          );
        case "Failed":
          return (
            <FieldNote tone="danger" className="mt-0">
              Not saved: {problemOf(outcome.error)}
            </FieldNote>
          );
        case undefined:
          return edited ? (
            <span>Edited, not saved.</span>
          ) : (
            <span>
              {plural(stored.routes.length, "route")} · {summary}
            </span>
          );
      }
    };
    return (
      <ListPanelFoot>
        <div className="min-w-0 flex-1 basis-64">{status()}</div>
        {owner && outcome?._tag === "Changed" ? (
          <Button variant="outline" size="sm" onClick={readAgain}>
            Read them again
          </Button>
        ) : owner && edited ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={drop}
            >
              Drop the edit
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={sendNow}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </span>
        ) : null}
      </ListPanelFoot>
    );
  };

  return (
    <ListPanel aria-label="Routes">
      <ListPanelHead>
        <Segmented
          label="Which client"
          size="sm"
          value={client}
          options={(["claude-code", "codex"] as const).map((each) => ({
            value: each,
            label: nameOf("client", each),
          }))}
          onValueChange={onClientChange}
        />
        <Note className="min-w-0 flex-1 basis-64 self-center">
          Routes are tried in order, and the first whose pattern matches a
          launch's project chooses its pool.
        </Note>
        {owner ? null : (
          <Note className="basis-full">
            A reader key reads the routes but cannot change them: sign in as the
            owner to change them.
          </Note>
        )}
      </ListPanelHead>
      <ListPanelBody>{body()}</ListPanelBody>
      {foot()}
    </ListPanel>
  );
}

function RoutesHead({ owner }: { readonly owner: boolean }) {
  return (
    <TableHeader from="md">
      <TableRow>
        <TableHead scope="col" numeric className="w-8">
          <span aria-hidden="true">#</span>
          <span className="sr-only">Position</span>
        </TableHead>
        <TableHead scope="col">
          <RouteFieldsHead match="Project pattern" target="Pool" />
        </TableHead>
        {owner ? (
          <TableHead scope="col">
            <span className="sr-only">Order and removal</span>
          </TableHead>
        ) : null}
      </TableRow>
    </TableHeader>
  );
}

function PoolName({
  id,
  mark,
}: {
  readonly id: string | null;
  readonly mark: (id: string) => ReactNode;
}) {
  const nameOf = useNameOf();
  if (id === null) return <TableLabel>No pool</TableLabel>;
  return (
    <span className="flex min-w-0 items-center gap-1.75">
      {mark(id)}
      <TableLabel title={id}>{nameOf("pool", id)}</TableLabel>
    </span>
  );
}

function IconAction({
  label,
  disabled = false,
  onClick,
  ref,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly ref?: (element: HTMLElement | null) => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RouteSkeleton({ owner }: { readonly owner: boolean }) {
  return (
    <TableRow aria-hidden="true">
      <TableCell numeric className="w-8">
        <Skeleton className="ml-auto w-3" />
      </TableCell>
      <TableCell className="w-full max-w-0">
        <RouteFields
          match={<Skeleton className="h-8 w-full" />}
          target={<Skeleton className="h-8 w-full" />}
        />
      </TableCell>
      {owner ? (
        <TableCell>
          <Skeleton className="w-24" />
        </TableCell>
      ) : null}
    </TableRow>
  );
}
