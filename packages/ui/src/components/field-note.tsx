import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/**
 * A short line under a field about what became of it: quiet for what
 * happened (saving, saved, removed), `danger` for why it was refused, which
 * is announced as an alert. The field keeps what was typed beside it.
 */
function FieldNote({
  tone = "quiet",
  className,
  ...props
}: ComponentProps<"p"> & { tone?: "quiet" | "danger" }) {
  return (
    <p
      data-slot="field-note"
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "m-0 mt-1 text-sm text-pretty text-text-3 data-[tone=danger]:text-danger",
        className,
      )}
      {...props}
    />
  );
}

export { FieldNote };
