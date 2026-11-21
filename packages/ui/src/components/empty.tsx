import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** What is empty, and why, in place of content that has nothing to show. */
function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center gap-1 px-4 py-8 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-title"
      className={cn("font-medium text-text", className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("max-w-md text-sm text-pretty text-text-3", className)}
      {...props}
    />
  );
}

export { Empty, EmptyDescription, EmptyTitle };
