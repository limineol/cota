import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the caller gives htmlFor or wraps the control
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm font-medium text-text-2 select-none",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
