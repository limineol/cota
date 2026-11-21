import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** A field; `code` for a code the owner copies from elsewhere, in mono and spaced so each character reads apart. */
function Input({
  className,
  type,
  code = false,
  ...props
}: ComponentProps<"input"> & { code?: boolean }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-code={code ? "" : undefined}
      className={cn(
        "h-8 w-full min-w-0 rounded-control border border-border-strong bg-surface px-2.5 text-base text-text transition-state outline-none placeholder:text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger data-code:font-mono data-code:tracking-wide",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
