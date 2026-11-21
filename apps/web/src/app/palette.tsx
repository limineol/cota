import {
  Palette,
  PaletteField,
  PaletteFoot,
  PaletteGroup,
  PaletteId,
  PaletteItem,
  PaletteList,
  PaletteMark,
  PaletteNote,
  PaletteSnippet,
} from "@cota/ui/components/palette";
import { PoolMark } from "@cota/ui/components/pool-mark";
import { Link } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  AppWindow,
  Box,
  CircleAlert,
  FolderGit2,
  LayoutGrid,
  MessagesSquare,
  Monitor,
  Search,
  Settings,
  SquareTerminal,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { type Client, useApiQuery } from "#shared/api.ts";
import { poolHues } from "#shared/domain/hues.ts";
import { type Candidate, found } from "#shared/domain/palette.ts";
import { ago } from "#shared/domain/quantities.ts";
import { marks, type Piece } from "#shared/domain/snippet.ts";
import { type Kind, useNameOf } from "#shared/names.tsx";
import { glyphOf } from "#shared/providers.tsx";
import {
  isUnreadable,
  searchQueryOf,
  UnreadableSearch,
  unreadable,
} from "#shared/search-query.ts";
import type { SessionsSearch } from "#shared/sessions-search.ts";
import { millis, plural } from "#shared/words.ts";

/** How long typing must pause before the hub is asked for sessions. */
export const typingPause = 300;

/** Sessions the palette shows of a search; the list behind "Search sessions for" has the rest. */
const sessionsShown = 8;

/** Values the palette shows to filter the sessions by; more text narrows them. */
const filtersShown = 12;

interface Result {
  readonly key: string;
  readonly link: ReactElement;
  readonly icon: ReactNode;
  readonly label: ReactNode;
  readonly detail?: ReactNode;
  readonly secondary?: ReactNode;
}

interface Group {
  readonly label: string;
  readonly results: ReadonlyArray<Result>;
  /** What the group says before its results: that they are being read, that there are none, or that the read failed. */
  readonly note?: ReactNode;
  /** What it says after them: that more are left out. */
  readonly more?: ReactNode;
}

interface Screen extends Candidate {
  readonly link: ReactElement;
  readonly icon: ReactNode;
  readonly detail?: string;
}

const screens: ReadonlyArray<Screen> = [
  {
    id: "/",
    name: "Overview",
    link: <Link to="/" />,
    icon: <LayoutGrid />,
  },
  {
    id: "/sessions",
    name: "Sessions",
    link: <Link to="/sessions" />,
    icon: <MessagesSquare />,
  },
  {
    id: "/errors",
    name: "Errors",
    link: <Link to="/errors" />,
    icon: <CircleAlert />,
  },
  {
    id: "/sql",
    name: "SQL",
    link: <Link to="/sql" />,
    icon: <SquareTerminal />,
  },
  {
    id: "/settings",
    name: "Settings",
    link: <Link to="/settings" />,
    icon: <Settings />,
  },
  {
    id: "/settings/names",
    name: "Display names",
    link: <Link to="/settings/names" />,
    icon: <Settings />,
    detail: "Settings",
  },
  {
    id: "/settings/sign-ins",
    name: "Sign-ins",
    link: <Link to="/settings/sign-ins" />,
    icon: <Settings />,
    detail: "Settings",
  },
  {
    id: "/settings/quota-logins",
    name: "Quota logins",
    link: <Link to="/settings/quota-logins" />,
    icon: <Settings />,
    detail: "Settings",
  },
  {
    id: "/settings/routes",
    name: "Routes",
    link: <Link to="/settings/routes" />,
    icon: <Settings />,
    detail: "Settings",
  },
];

type Filtered = Exclude<Kind, "pool">;

const filtered: ReadonlyArray<{
  readonly kind: Filtered;
  readonly word: string;
  readonly icon: ReactNode;
}> = [
  { kind: "project", word: "Project", icon: <FolderGit2 /> },
  { kind: "model", word: "Model", icon: <Box /> },
  { kind: "client", word: "Client", icon: <AppWindow /> },
  { kind: "machine", word: "Machine", icon: <Monitor /> },
];

const filterBy: Record<Filtered, (id: string) => SessionsSearch> = {
  project: (id) => ({ project: [id] }),
  model: (id) => ({ model: [id] }),
  client: (id) => ({ client: [id] }),
  machine: (id) => ({ machine: [id] }),
};

function Pieces({ pieces }: { readonly pieces: ReadonlyArray<Piece> }) {
  let at = 0;
  return pieces.map((piece) => {
    const key = at;
    at += piece.text.length;
    return piece.marked ? (
      <PaletteMark key={key}>{piece.text}</PaletteMark>
    ) : (
      piece.text
    );
  });
}

/** The id under a name, when the text was found in the id and not in the name. */
const idLine = (name: ReadonlyArray<Piece>, id: ReadonlyArray<Piece>) =>
  id.some((piece) => piece.marked) && !name.some((piece) => piece.marked)
    ? {
        secondary: (
          <PaletteId>
            <Pieces pieces={id} />
          </PaletteId>
        ),
      }
    : {};

const listPools = (client: Client) => client.pools.list();

/* The facets' window defaults to the last 7 days, the sessions list's own default range, so a value leads to sessions it holds. */
const listFacets = (client: Client) => client.traffic.facets({ query: {} });

const searchSessions = (q: string) => (client: Client) =>
  Effect.gen(function* () {
    const searched = searchQueryOf(q);
    if (searched === undefined) return yield* new UnreadableSearch({ q });
    const answer = yield* client.sessions.sessions({
      query: { q: searched, limit: sessionsShown },
    });
    return { q, answer };
  });

/** The text typed, once typing has paused; null while nothing is typed. */
const usePaused = (text: string) => {
  const [paused, setPaused] = useState<string | null>(null);
  useEffect(() => {
    const wanted = text === "" ? null : text;
    if (wanted === paused) return;
    const timer = setTimeout(() => setPaused(wanted), typingPause);
    return () => clearTimeout(timer);
  }, [text, paused]);
  return paused;
};

const plainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

function Results({ onOpened }: { readonly onOpened: () => void }) {
  const [typed, setTyped] = useState("");
  const [chosen, setChosen] = useState(0);
  const [now] = useState(Date.now);
  const listId = useId();
  const nameOf = useNameOf();
  const text = typed.trim();
  const paused = usePaused(text);

  const pools = useApiQuery(["palette", "pools"], listPools);
  const facets = useApiQuery(
    ["palette", "facets"],
    text === "" ? null : listFacets,
  );
  const sessions = useApiQuery(
    ["palette", "sessions", paused],
    paused === null ? null : searchSessions(paused),
    { keepPrevious: true },
  );

  const hues = poolHues((pools.data?.pools ?? []).map((pool) => pool.id));
  const providers = new Map(
    (pools.data?.pools ?? []).map((pool) => [pool.id, pool.provider]),
  );

  /** A session's first pool's mark, as the sessions list draws it beside the session. */
  const sessionMark = (pool: string | undefined) =>
    pool === undefined ? (
      <MessagesSquare />
    ) : (
      <PoolMark
        hue={hues.get(pool) ?? "neutral"}
        name={pool}
        glyph={glyphOf(providers.get(pool) ?? "")}
      />
    );

  const goTo = found(screens, text).map(
    ({ candidate, name }): Result => ({
      key: candidate.id,
      link: candidate.link,
      icon: candidate.icon,
      label: <Pieces pieces={name} />,
      ...(candidate.detail === undefined ? {} : { detail: candidate.detail }),
    }),
  );

  const poolGroup = (): Group => {
    if (pools.data === undefined) {
      return {
        label: "Pools",
        results: [],
        note: pools.isError
          ? "The hub could not read the pools."
          : "Reading the pools…",
      };
    }
    const all = pools.data.pools;
    const results = found(
      all.map((pool) => ({ ...pool, name: nameOf("pool", pool.id) })),
      text,
    ).map(
      ({ candidate, name, id }): Result => ({
        key: candidate.id,
        link: <Link to="/" search={{ pool: candidate.id }} />,
        icon: (
          <PoolMark
            hue={hues.get(candidate.id) ?? "neutral"}
            name={candidate.id}
            glyph={glyphOf(candidate.provider)}
          />
        ),
        label: <Pieces pieces={name} />,
        detail: "Overview",
        ...idLine(name, id),
      }),
    );
    return {
      label: "Pools",
      results,
      ...(all.length === 0 ? { note: "The hub has no pools." } : {}),
    };
  };

  const filterGroup = (): Group => {
    if (facets.data === undefined) {
      return {
        label: "Filter sessions by",
        results: [],
        note: facets.isError
          ? "The hub could not read the values to filter by."
          : "Reading the values…",
      };
    }
    const answer = facets.data;
    const all = found(
      filtered.flatMap(({ kind, word, icon }) =>
        answer[kind].map(({ value }) => ({
          id: value,
          name: nameOf(kind, value),
          kind,
          word,
          icon,
        })),
      ),
      text,
    );
    const results = all.slice(0, filtersShown).map(
      ({ candidate, name, id }): Result => ({
        key: `${candidate.kind}:${candidate.id}`,
        link: (
          <Link
            to="/sessions"
            search={filterBy[candidate.kind](candidate.id)}
          />
        ),
        icon: candidate.icon,
        label: <Pieces pieces={name} />,
        detail: candidate.word,
        ...idLine(name, id),
      }),
    );
    return {
      label: "Filter sessions by",
      results,
      ...(all.length > filtersShown
        ? {
            more: `${filtersShown} of ${all.length} shown: type more to narrow them.`,
          }
        : {}),
    };
  };

  const sessionsGroup = (): Group => {
    const searchFor: Result = {
      key: "search",
      link: <Link to="/sessions" search={{ q: text }} />,
      icon: <Search />,
      label: <>Search sessions for “{text}”</>,
    };
    if (paused === null || (sessions.isPending && !sessions.isError)) {
      return {
        label: "Sessions",
        results: [searchFor],
        note: "Searching the sessions…",
      };
    }
    if (sessions.isError) {
      if (isUnreadable(sessions.error, paused)) {
        return { label: "Sessions", results: [], note: unreadable(paused) };
      }
      return {
        label: "Sessions",
        results: [searchFor],
        note: "The hub could not search the sessions.",
      };
    }
    const { q, answer } = sessions.data;
    const results = answer.sessions.map(
      (row): Result => ({
        key: row.id,
        link: <Link to="/sessions/$session" params={{ session: row.id }} />,
        icon: sessionMark(row.pools[0]),
        label: row.title?.text ?? row.firstPrompt ?? "Untitled session",
        detail: ago(now - millis(row.endedAt)),
        ...(row.snippet === null
          ? {}
          : {
              secondary: (
                <PaletteSnippet>
                  {row.snippet.start > 0 ? "…" : null}
                  <Pieces pieces={marks(row.snippet.text, q)} />
                </PaletteSnippet>
              ),
            }),
      }),
    );
    return {
      label: "Sessions",
      results: [
        ...results,
        {
          ...searchFor,
          ...(answer.total > results.length
            ? { detail: plural(answer.total, "session") }
            : {}),
        },
      ],
      ...(results.length === 0
        ? { note: `No session mentions “${q}” in the last 7 days.` }
        : {}),
    };
  };

  const groups: ReadonlyArray<Group> = [
    { label: "Go to", results: goTo },
    poolGroup(),
    ...(text === "" ? [] : [filterGroup(), sessionsGroup()]),
  ].filter((group) => group.results.length > 0 || group.note !== undefined);

  const results = groups.flatMap((group) => group.results);
  const active = Math.min(chosen, results.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(`${listId}-option-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = results.length - 1;
    if (last < 0) return;
    const moves: Record<string, number> = {
      ArrowDown: active === last ? 0 : active + 1,
      ArrowUp: active <= 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setChosen(next);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById(optionId(active))?.click();
    }
  };

  let index = 0;
  return (
    <>
      <PaletteField
        aria-label="Search"
        aria-controls={listId}
        aria-expanded={results.length > 0}
        {...(active < 0 ? {} : { "aria-activedescendant": optionId(active) })}
        closeLabel="Close the search"
        placeholder="Go to a screen, a pool, a filter or a session"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setChosen(0);
        }}
        onKeyDown={onKeyDown}
      />
      <PaletteList
        id={listId}
        aria-label="Results"
        empty={results.length === 0}
      >
        {groups.map((group) => (
          <PaletteGroup key={group.label} label={group.label}>
            {group.note === undefined ? null : (
              <PaletteNote>{group.note}</PaletteNote>
            )}
            {group.results.map((result) => {
              const at = index++;
              return (
                <PaletteItem
                  key={result.key}
                  id={optionId(at)}
                  active={at === active}
                  render={result.link}
                  icon={result.icon}
                  {...(result.detail === undefined
                    ? {}
                    : { detail: result.detail })}
                  {...(result.secondary === undefined
                    ? {}
                    : { secondary: result.secondary })}
                  onPointerMove={() => {
                    if (at !== active) setChosen(at);
                  }}
                  onClick={(event) => {
                    if (plainClick(event)) onOpened();
                  }}
                >
                  {result.label}
                </PaletteItem>
              );
            })}
            {group.more === undefined ? null : (
              <PaletteNote>{group.more}</PaletteNote>
            )}
          </PaletteGroup>
        ))}
      </PaletteList>
      <PaletteFoot
        end={
          results.length === 0 ? "No results" : plural(results.length, "result")
        }
      />
    </>
  );
}

/** The command palette over every screen: the screens, the pools, the values to filter the sessions by, and the hub's search of the sessions. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Palette open={open} onOpenChange={onOpenChange} label="Search">
      <Results onOpened={() => onOpenChange(false)} />
    </Palette>
  );
}
