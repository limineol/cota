import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** A place held for content still loading, shaped like it by the layout classes it is given. */
function Skeleton({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "block h-3 max-w-full rounded-control bg-linear-to-r from-surface-2 via-surface-3 to-surface-2 bg-size-[200%_100%] motion-safe:animate-shimmer",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
