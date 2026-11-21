import { Identifier } from "@cota/ui/components/identifier";
import { PageDescription, PageTitle } from "@cota/ui/components/page";
import { Tag, Tags } from "@cota/ui/components/tag";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { rememberedList } from "#shared/last-list.ts";
import { type Kind, useNameOf } from "#shared/names.tsx";
import type { Dimension } from "#shared/sessions-search.ts";
import type { SessionAnswer } from "./queries.ts";

type Row = SessionAnswer["session"];

const withoutSession = "request:";

const longest = 160;

/** The session's title, the first line of its first prompt without one, or what it is without either. */
export const headingOf = (row: Row) => {
  if (row.title !== null) return row.title.text;
  const line = row.firstPrompt?.split("\n").find((each) => each.trim() !== "");
  if (line !== undefined) {
    const trimmed = line.trim();
    return trimmed.length > longest
      ? `${trimmed.slice(0, longest - 1)}…`
      : trimmed;
  }
  return row.id.startsWith(withoutSession)
    ? "A request without a session"
    : "Untitled session";
};

function Source({ row }: { readonly row: Row }) {
  const nameOf = useNameOf();
  if (row.title === null) {
    return row.firstPrompt === null ? null : (
      <>Untitled; the first line of its first prompt</>
    );
  }
  if (row.title.source === "generated") {
    return <>A title the client had a model write</>;
  }
  return row.title.machine === null ? (
    <>A title reported by a machine</>
  ) : (
    <>A title reported by {nameOf("machine", row.title.machine)}</>
  );
}

const tagged: ReadonlyArray<{
  readonly key: "pools" | "projects" | "clients" | "machines" | "models";
  readonly dimension: Dimension & Kind;
  readonly label: string;
}> = [
  { key: "pools", dimension: "pool", label: "Pool" },
  { key: "projects", dimension: "project", label: "Project" },
  { key: "clients", dimension: "client", label: "Client" },
  { key: "machines", dimension: "machine", label: "Machine" },
  { key: "models", dimension: "model", label: "Model" },
];

export function Header({
  row,
  markOf,
}: {
  readonly row: Row;
  readonly markOf: (pool: string) => ReactNode;
}) {
  const nameOf = useNameOf();
  const { range } = rememberedList();
  return (
    <header className="mb-6 flex flex-col gap-3">
      <div>
        <PageTitle>{headingOf(row)}</PageTitle>
        <PageDescription>
          <Source row={row} />
        </PageDescription>
      </div>
      <Identifier value={row.id} label="session id" />
      <Tags aria-label="What the session was made with">
        {tagged.flatMap(({ key, dimension, label }) =>
          row[key].map((value) => (
            <Tag
              key={`${dimension}:${value}`}
              dimension={label}
              title={`The sessions of ${label.toLowerCase()} ${nameOf(dimension, value)}`}
              render={
                <Link
                  to="/sessions"
                  search={{
                    ...(range === undefined ? {} : { range }),
                    [dimension]: [value],
                  }}
                />
              }
            >
              {dimension === "pool" ? markOf(value) : null}
              <span title={value}>{nameOf(dimension, value)}</span>
            </Tag>
          )),
        )}
      </Tags>
    </header>
  );
}
