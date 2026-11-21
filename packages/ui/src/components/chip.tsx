import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/** The filters chosen, side by side, each one a chip that removes it. */
function Chips({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="chips"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      {...props}
    />
  );
}

/** A filter that is on: what it filters by, its value, and a cross; pressing it removes the filter. */
function Chip({
  dimension,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { dimension: ReactNode }) {
  return (
    <button
      type="button"
      data-slot="chip"
      className={cn(
        "inline-flex h-6.5 max-w-full cursor-pointer items-center gap-1.5 rounded-control border border-border-strong bg-surface pr-1.5 pl-2 text-sm text-text transition-state outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
        className,
      )}
      {...props}
    >
      <span className="sr-only">Remove the filter </span>
      <span className="text-text-3">{dimension} ·</span>
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      <X aria-hidden="true" className="size-3.5 shrink-0 text-text-3" />
    </button>
  );
}

/** The one button that removes every chip. */
function ChipsClear({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="chips-clear"
      className={cn(
        "ml-1 h-6.5 cursor-pointer rounded-control px-1 text-sm text-text-2 underline decoration-text-3 underline-offset-3 transition-state outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
        className,
      )}
      {...props}
    />
  );
}

export { Chip, Chips, ChipsClear };
