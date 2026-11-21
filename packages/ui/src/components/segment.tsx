import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** A stretch of a conversation under its heading, set off by a rule; the first of its list has none, the rule above it being the list's own. */
function Segment({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="segment"
      className={cn("group/segment flex min-w-0 flex-col gap-3", className)}
      {...props}
    />
  );
}

/** The segment's title, what it holds, and what can be done with it, on a line that wraps. */
function SegmentHead({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="segment-head"
      className={cn(
        "flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-3 group-first/segment:border-t-0 group-first/segment:pt-0",
        className,
      )}
      {...props}
    />
  );
}

function SegmentTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="segment-title"
      className={cn("m-0 text-base font-semibold text-text", className)}
      {...props}
    />
  );
}

function SegmentMeta({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="segment-meta"
      className={cn("m-0 flex-1 text-sm text-text-3 tabular-nums", className)}
      {...props}
    />
  );
}

/** The wide button that reads a closed segment's transcript. */
function SegmentShow({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="segment-show"
      className={cn(
        "flex w-full cursor-pointer flex-wrap items-baseline gap-x-2 rounded-panel border border-dashed border-border-strong px-4 py-3 text-left font-medium text-text transition-state outline-none hover:border-text-3 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text [&_span]:font-normal [&_span]:text-text-3",
        className,
      )}
      {...props}
    />
  );
}

export { Segment, SegmentHead, SegmentMeta, SegmentShow, SegmentTitle };
