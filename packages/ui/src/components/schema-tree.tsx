import { ChevronRight, Table2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";
import { Skeleton } from "./skeleton.tsx";

/**
 * A rail of a database's tables beside what uses them, in a page that is a
 * `@container`: side by side from 896px of the page, the rail sticky as the
 * page scrolls; below that the rail above, shown only while `open`.
 */
function SchemaLayout({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="schema-layout"
      className={cn(
        "grid items-start gap-4 @4xl:grid-cols-[17rem_minmax(0,1fr)] @4xl:gap-5",
        className,
      )}
      {...props}
    />
  );
}

function SchemaRail({
  open = false,
  className,
  ...props
}: ComponentProps<"aside"> & { open?: boolean }) {
  return (
    <aside
      data-slot="schema-rail"
      data-open={open ? "" : undefined}
      className={cn(
        "hidden max-h-80 min-w-0 flex-col gap-2.5 rounded-card border border-border bg-surface p-3.5 data-open:flex",
        "@4xl:sticky @4xl:top-6 @4xl:flex @4xl:max-h-[calc(100dvh-3rem)]",
        className,
      )}
      {...props}
    />
  );
}

/** The rail's button below the width where it fits beside the editor. */
function SchemaToggle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="schema-toggle"
      className={cn("@4xl:hidden", className)}
      {...props}
    />
  );
}

/** The rail's heading and a quiet note beside it. */
function SchemaHead({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="schema-head"
      className={cn(
        "flex items-baseline justify-between gap-3 text-sm text-text-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text",
        className,
      )}
      {...props}
    />
  );
}

/** The tables, scrolling on their own inside the rail. */
function SchemaTables({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="schema-tables"
      className={cn(
        "-mx-1.5 m-0 flex min-h-0 list-none flex-col overflow-y-auto p-0 [scrollbar-width:thin]",
        className,
      )}
      {...props}
    />
  );
}

const nameButton =
  "flex min-w-0 cursor-pointer items-center gap-1.5 rounded-control text-left font-mono text-sm text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text";

/**
 * A table: a button that opens its columns, its name as a button that calls
 * `onInsert`, and a `figure` beside it, with `detail` as its tooltip. Open,
 * it shows `about` it above its columns.
 */
function SchemaTable({
  name,
  figure,
  detail,
  about,
  open,
  onOpenChange,
  onInsert,
  className,
  children,
}: {
  name: string;
  figure?: ReactNode;
  detail?: string;
  about?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <li data-slot="schema-table" className={cn("min-w-0", className)}>
      <div className="grid h-7 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-0.5 rounded-control pr-1.5 transition-state hover:bg-surface-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Columns of ${name}`}
          onClick={() => onOpenChange(!open)}
          className="grid size-6 cursor-pointer place-items-center rounded-control text-text-3 outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn("size-3.5 transition-move", open && "rotate-90")}
          />
        </button>
        <button
          type="button"
          onClick={onInsert}
          {...(detail === undefined ? {} : { title: detail })}
          className={nameButton}
        >
          <Table2
            aria-hidden="true"
            className="size-3.5 shrink-0 text-text-3"
          />
          <span className="truncate">{name}</span>
        </button>
        {figure === undefined ? null : (
          <span className="text-xs text-text-3 tabular-nums">{figure}</span>
        )}
      </div>
      {open ? (
        <div className="mb-1.5 ml-3 border-l border-border pl-2">
          {about === undefined ? null : (
            <div className="px-1.5 pt-0.5 pb-1 text-xs text-pretty text-text-3 tabular-nums [&_p]:m-0">
              {about}
            </div>
          )}
          <ul className="m-0 list-none p-0">{children}</ul>
        </div>
      ) : null}
    </li>
  );
}

/** A column: its name as a button that calls `onInsert`, its type, and its comment under them when it has one. */
function SchemaColumn({
  name,
  type,
  comment = "",
  onInsert,
  className,
}: {
  name: string;
  type: string;
  comment?: string;
  onInsert: () => void;
  className?: string;
}) {
  return (
    <li data-slot="schema-column" className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={onInsert}
        className="flex w-full min-w-0 cursor-pointer items-baseline justify-between gap-2.5 rounded-control px-1.5 py-0.75 text-left font-mono text-sm outline-none transition-state hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text"
      >
        <span className="truncate text-text">{name}</span>
        <span className="max-w-1/2 shrink-0 truncate text-xs text-text-3">
          {type}
        </span>
      </button>
      {comment === "" ? null : (
        <p className="m-0 line-clamp-2 px-1.5 pb-1 text-xs text-text-3">
          {comment}
        </p>
      )}
    </li>
  );
}

/** A line in place of the tables: while they load, when none match, or why they cannot be read. */
function SchemaNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="schema-note"
      className={cn(
        "m-0 px-1.5 py-1 text-sm text-pretty text-text-3",
        className,
      )}
      {...props}
    />
  );
}

/** The tables held while they load, shaped like five of them. */
function SchemaSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="schema-skeleton"
      className={cn("flex flex-col gap-3 py-1.5", className)}
    >
      <Skeleton className="w-3/5" />
      <Skeleton className="w-2/5" />
      <Skeleton className="w-1/2" />
      <Skeleton className="w-3/5" />
      <Skeleton className="w-1/3" />
    </div>
  );
}

export {
  SchemaColumn,
  SchemaHead,
  SchemaLayout,
  SchemaNote,
  SchemaRail,
  SchemaSkeleton,
  SchemaTable,
  SchemaTables,
  SchemaToggle,
};
