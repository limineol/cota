import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/**
 * A list as one panel: `ListPanelHead`, the toolbar that chooses what is
 * listed; `ListPanelBody`, its table or what stands in for it; and
 * `ListPanelFoot`, how much is shown and the way to the rest. Its columns
 * leave by the panel's width (`TableHead`'s `from`).
 */
function ListPanel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="list-panel"
      className={cn(
        "@container/panel flex min-w-0 flex-col rounded-card border border-border bg-surface text-text",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The panel's toolbar: a search, and the filter buttons with their reset in
 * `ListPanelFilters`, the filters going under the search when they do not
 * fit beside it; or a heading and what acts on the list. `alone` when it is
 * all the panel holds, so it has as much room under it as over it.
 */
function ListPanelHead({
  alone = false,
  className,
  ...props
}: ComponentProps<"div"> & { alone?: boolean }) {
  return (
    <div
      data-slot="list-panel-head"
      data-alone={alone ? "" : undefined}
      className={cn(
        "flex flex-wrap items-start gap-2 px-3.5 pt-3.5 pb-2.5 data-alone:pb-3.5 wide:px-5 wide:pt-4 wide:data-alone:pb-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The head's filter buttons on one line that scrolls sideways while the
 * panel is narrower than 1024px, and may wrap from there; `end`, such as
 * their reset, stays beside them, outside the scroll.
 */
function ListPanelFilters({
  end,
  className,
  children,
}: {
  end?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="list-panel-filters"
      className={cn(
        "mt-0.5 flex w-full min-w-0 items-start gap-2 @2xl/panel:w-auto @2xl/panel:flex-1",
        className,
      )}
    >
      <div className="-m-1 flex min-w-0 flex-1 gap-2 overflow-x-auto p-1 [scrollbar-width:none] @5xl/panel:flex-wrap @5xl/panel:overflow-visible">
        {children}
      </div>
      {end}
    </div>
  );
}

/**
 * What is listed. A table in it runs from edge to edge, its first and last
 * columns lined up with the head. While `stale` it is dimmed, after a
 * moment, until a new answer replaces it.
 */
function ListPanelBody({
  stale = false,
  className,
  ...props
}: ComponentProps<"div"> & { stale?: boolean }) {
  return (
    <div
      data-slot="list-panel-body"
      data-stale={stale ? "" : undefined}
      aria-busy={stale || undefined}
      className={cn(
        "min-w-0 transition-state delay-150 data-stale:opacity-55",
        "[&_td:first-child]:pl-3.5 [&_td:last-child]:pr-3.5 [&_th:first-child]:pl-3.5 [&_th:last-child]:pr-3.5 wide:[&_td:first-child]:pl-5 wide:[&_td:last-child]:pr-5 wide:[&_th:first-child]:pl-5 wide:[&_th:last-child]:pr-5",
        className,
      )}
      {...props}
    />
  );
}

/** What the panel holds in place of a table, such as a form, inset to the head's padding. */
function ListPanelInset({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="list-panel-inset"
      className={cn("min-w-0 px-3.5 pb-4 wide:px-5 wide:pb-5", className)}
      {...props}
    />
  );
}

/** Under the rows: how many are shown on the left, the way to the others on the right, and a note under both. */
function ListPanelFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="list-panel-foot"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-3.5 py-2.5 text-sm text-text-3 tabular-nums wide:px-5",
        className,
      )}
      {...props}
    />
  );
}

export {
  ListPanel,
  ListPanelBody,
  ListPanelFilters,
  ListPanelFoot,
  ListPanelHead,
  ListPanelInset,
};
