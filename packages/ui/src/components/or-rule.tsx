import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

const line = "m-0 h-px flex-1 border-0 bg-border";

/** A rule with "or" in its middle, between two ways to do one thing. */
function OrRule({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="or-rule"
      className={cn("flex items-center gap-3 text-sm text-text-3", className)}
      {...props}
    >
      <hr className={line} />
      or
      <hr className={line} />
    </div>
  );
}

export { OrRule };
