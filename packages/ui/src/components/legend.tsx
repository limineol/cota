import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** What each colour of a chart stands for, as a wrapping row of entries. */
function Legend({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="legend"
      className={cn(
        "mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-text-2",
        className,
      )}
      {...props}
    />
  );
}

/** One entry: its mark or swatch, then its name. */
function LegendItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="legend-item"
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      {...props}
    />
  );
}

export { Legend, LegendItem };
