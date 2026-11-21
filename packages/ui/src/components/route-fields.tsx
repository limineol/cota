import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#lib/utils.ts";

const grid =
  "grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 @2xl/panel:grid-cols-[minmax(0,1fr)_1rem_minmax(0,15rem)]";

/**
 * A rule read as a sentence, in a row of a list panel's table: what it
 * matches, an arrow, and what it leads to, such as a route's pattern and its
 * pool. On one line from the panel's 672px, in columns that line up from row
 * to row; below that, what it leads to goes under what it matches, after the
 * arrow.
 */
function RouteFields({
  match,
  target,
  className,
}: {
  match: ReactNode;
  target: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="route-fields" className={cn(grid, className)}>
      <div className="col-span-2 flex min-w-0 items-center @2xl/panel:col-span-1">
        {match}
      </div>
      <ArrowRight
        aria-hidden="true"
        className="size-4 justify-self-center text-text-3"
      />
      <div className="flex min-w-0 items-center">{target}</div>
    </div>
  );
}

/** The heads of `RouteFields`' two columns, lined up over them, inside one table head. */
function RouteFieldsHead({
  match,
  target,
}: {
  match: ReactNode;
  target: ReactNode;
}) {
  return (
    <span data-slot="route-fields-head" className={grid}>
      <span className="col-span-2 @2xl/panel:col-span-1">{match}</span>
      <span aria-hidden="true" className="hidden @2xl/panel:block" />
      <span>{target}</span>
    </span>
  );
}

export { RouteFields, RouteFieldsHead };
