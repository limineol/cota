import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/**
 * One pool in full: a head of its name, plan and state, then its windows
 * beside its figures, then its lists. The columns stack when the card is
 * narrow.
 */
function PoolFocus({ className, ...props }: ComponentProps<"article">) {
  return (
    <article
      data-slot="pool-focus"
      className={cn(
        "@container/focus grid gap-5.5 rounded-card border border-border bg-surface p-4 text-text [--meter-ring:var(--surface)] wide:px-6 wide:py-5.5",
        className,
      )}
      {...props}
    />
  );
}

function PoolFocusHead({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="pool-focus-head"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3",
        className,
      )}
      {...props}
    />
  );
}

/** The mark, the name, the plan's badge and what kind of pool it is, on one line. */
function PoolFocusTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="pool-focus-title"
      className={cn("flex min-w-0 flex-wrap items-center gap-2.5", className)}
      {...props}
    />
  );
}

function PoolFocusName({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="pool-focus-name"
      className={cn(
        "min-w-0 truncate text-[19px] font-semibold tracking-tight wide:text-2xl",
        className,
      )}
      {...props}
    />
  );
}

function PoolFocusMeta({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pool-focus-meta"
      className={cn(
        "inline-flex items-center gap-2 text-sm text-text-3",
        className,
      )}
      {...props}
    />
  );
}

function PoolFocusState({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="pool-focus-state"
      className={cn(
        "flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-text-2 tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

/** Why the pool's quota could not be read, with an icon in amber. */
function PoolFocusProblem({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="pool-focus-problem"
      className={cn(
        "-mt-2 flex items-start gap-1.75 text-sm text-pretty text-text-2 [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-warn",
        className,
      )}
      {...props}
    />
  );
}

function PoolFocusBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="pool-focus-body"
      className={cn(
        "grid gap-6 @min-[960px]/focus:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @min-[960px]/focus:gap-9",
        className,
      )}
      {...props}
    />
  );
}

function PoolFocusWindows({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="pool-focus-windows"
      className={cn("grid content-start gap-6", className)}
      {...props}
    />
  );
}

/** A sentence in place of the windows, saying why there are none. */
function PoolFocusNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="pool-focus-note"
      className={cn("text-base text-pretty text-text-2", className)}
      {...props}
    />
  );
}

function PoolFocusUsage({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="pool-focus-usage"
      className={cn(
        "grid grid-cols-2 content-start gap-4 border-t border-border pt-5 @min-[960px]/focus:gap-6 @min-[960px]/focus:border-t-0 @min-[960px]/focus:border-l @min-[960px]/focus:pt-0 @min-[960px]/focus:pl-9",
        className,
      )}
      {...props}
    />
  );
}

function PoolFocusLists({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="pool-focus-lists"
      className={cn(
        "grid gap-5 border-t border-border pt-4.5 @min-[720px]/focus:grid-cols-2 @min-[720px]/focus:gap-9",
        className,
      )}
      {...props}
    />
  );
}

function PoolFocusSubheading({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="pool-focus-subheading"
      className={cn("mb-1.5 text-sm font-medium text-text-2", className)}
      {...props}
    />
  );
}

export {
  PoolFocus,
  PoolFocusBody,
  PoolFocusHead,
  PoolFocusLists,
  PoolFocusMeta,
  PoolFocusName,
  PoolFocusNote,
  PoolFocusProblem,
  PoolFocusState,
  PoolFocusSubheading,
  PoolFocusTitle,
  PoolFocusUsage,
  PoolFocusWindows,
};
