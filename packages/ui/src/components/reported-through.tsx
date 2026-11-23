import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/**
 * How far each machine has reported a client's calls to an observed pool:
 * a quiet title, then one line per machine and client. It sits in a pool
 * card's windows slot (`card`) or a pool in full (`detail`).
 */
function ReportedThrough({
  className,
  size = "card",
  ...props
}: ComponentProps<"span"> & { size?: "card" | "detail" }) {
  return (
    <span
      data-slot="reported-through"
      data-size={size}
      className={cn(
        "group/through flex min-w-0 flex-col gap-1.5 @min-[640px]/pools:col-span-full data-[size=detail]:gap-2",
        className,
      )}
      {...props}
    />
  );
}

function ReportedThroughTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="reported-through-title"
      className={cn(
        "text-sm text-text-3 group-data-[size=detail]/through:font-medium group-data-[size=detail]/through:text-text-2",
        className,
      )}
      {...props}
    />
  );
}

/** One machine and client: its name, a badge such as Late beside it, and how long ago its through was at the end. */
function ReportedThroughLine({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="reported-through-line"
      className={cn(
        "flex min-w-0 items-center gap-x-2 text-sm whitespace-nowrap tabular-nums group-data-[size=detail]/through:text-base",
        className,
      )}
      {...props}
    />
  );
}

function ReportedThroughName({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="reported-through-name"
      className={cn(
        "min-w-0 truncate font-medium text-text-2 group-data-[size=detail]/through:text-text",
        className,
      )}
      {...props}
    />
  );
}

function ReportedThroughWhen({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="reported-through-when"
      className={cn("ml-auto shrink-0 text-text-3", className)}
      {...props}
    />
  );
}

export {
  ReportedThrough,
  ReportedThroughLine,
  ReportedThroughName,
  ReportedThroughTitle,
  ReportedThroughWhen,
};
