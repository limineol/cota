import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/**
 * Pool cards, as a grid of up to three columns at least 320px wide, or as a
 * list of one row per pool whose columns line up from card to card. A row
 * holds its windows beside its name from 1320px, below it from 640px, and
 * stacks like a grid card when narrower.
 */
function PoolCards({
  className,
  layout,
  ...props
}: ComponentProps<"ul"> & { layout: "grid" | "list" }) {
  return (
    <ul
      data-slot="pool-cards"
      data-layout={layout}
      className={cn(
        layout === "grid"
          ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,max(320px,calc(100%/3-10px))),1fr))] gap-2.5 wide:gap-3"
          : "@container/pools flex flex-col gap-2.5",
        className,
      )}
      {...props}
    />
  );
}

/**
 * One pool's card, which `render` makes a link to the pool. Every card has
 * the same slots, so they line up when scanned; an `idle` pool's name recedes.
 */
function PoolCard({
  render,
  idle = false,
  className,
  ...props
}: useRender.ComponentProps<"a"> & { idle?: boolean }) {
  const card = useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(
          "group/card flex min-w-0 flex-1 flex-col gap-4 rounded-card border border-border bg-surface p-3.5 text-text transition-state outline-none [--meter-ring:var(--surface)] wide:px-4.5 wide:py-4",
          "[&:is(a)]:hover:border-border-strong [&:is(a)]:hover:bg-surface-2 [&:is(a)]:hover:[--meter-ring:var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
          "@min-[640px]/pools:grid @min-[640px]/pools:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] @min-[640px]/pools:items-center @min-[640px]/pools:gap-x-7 @min-[640px]/pools:[grid-template-areas:'head_._foot'_'windows_windows_windows'] @min-[1320px]/pools:[grid-template-areas:'head_windows_foot']",
          className,
        ),
        ...(idle ? { "data-idle": "" } : {}),
      },
      props,
    ),
  });
  return (
    <li data-slot="pool-card" className="flex min-w-0">
      {card}
    </li>
  );
}

/** The mark, the name and the badge on one line, and the pool's state under the name. */
function PoolCardHead({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pool-card-head"
      className={cn(
        "grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 [grid-area:head] [grid-template-areas:'mark_name_badge'_'._state_state'] *:data-[slot=badge]:[grid-area:badge] *:data-[slot=pool-mark]:[grid-area:mark]",
        className,
      )}
      {...props}
    />
  );
}

function PoolCardName({ className, ...props }: ComponentProps<"strong">) {
  return (
    <strong
      data-slot="pool-card-name"
      className={cn(
        "truncate text-lg font-semibold tracking-tight [grid-area:name] group-data-idle/card:text-text-2",
        className,
      )}
      {...props}
    />
  );
}

function PoolCardState({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pool-card-state"
      className={cn(
        "flex min-h-5 min-w-0 items-center text-sm whitespace-nowrap text-text-3 tabular-nums [grid-area:state]",
        className,
      )}
      {...props}
    />
  );
}

function PoolCardWindows({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pool-card-windows"
      className={cn(
        "flex flex-1 flex-col gap-3.5 [grid-area:windows] @min-[640px]/pools:grid @min-[640px]/pools:grid-cols-3 @min-[640px]/pools:items-end @min-[640px]/pools:gap-x-6",
        className,
      )}
      {...props}
    />
  );
}

/** A line among the windows: why a pool has none, or how many more it has. */
function PoolCardNote({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pool-card-note"
      className={cn(
        "text-sm text-text-3 @min-[640px]/pools:col-span-full",
        className,
      )}
      {...props}
    />
  );
}

/** The pool's figures, at the card's edges, or in columns of one width that line up from row to row in the list. */
function PoolCardFoot({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pool-card-foot"
      className={cn(
        "flex justify-between gap-3 border-t border-border pt-3 [grid-area:foot] @min-[640px]/pools:grid @min-[640px]/pools:auto-cols-[96px] @min-[640px]/pools:grid-flow-col @min-[640px]/pools:gap-6 @min-[640px]/pools:border-t-0 @min-[640px]/pools:pt-0",
        className,
      )}
      {...props}
    />
  );
}

/** A figure of the pool's traffic under its `label`; the `strong` part of its children stands out. */
function PoolCardFigure({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-slot="pool-card-figure"
      className={cn(
        "flex min-w-0 flex-col gap-px last:items-end last:text-right @min-[640px]/pools:items-end @min-[640px]/pools:text-right",
        className,
      )}
    >
      <span className="text-xs text-text-3">{label}</span>
      <span className="max-w-full truncate text-sm text-text-3 tabular-nums [&_strong]:mr-0.75 [&_strong]:text-lg [&_strong]:font-semibold [&_strong]:text-text">
        {children}
      </span>
    </span>
  );
}

export {
  PoolCard,
  PoolCardFigure,
  PoolCardFoot,
  PoolCardHead,
  PoolCardName,
  PoolCardNote,
  PoolCardState,
  PoolCards,
  PoolCardWindows,
};
