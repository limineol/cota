import { Check, CircleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/**
 * A rule a field's value must meet, under the field: a quiet dot until it
 * is met, then a tick. `refused` when the form was sent while it was not
 * met: in `danger`, announced, and the value was not sent.
 */
function FieldRule({
  met,
  refused = false,
  className,
  children,
  ...props
}: ComponentProps<"p"> & { met: boolean; refused?: boolean }) {
  return (
    <p
      data-slot="field-rule"
      data-met={met ? "" : undefined}
      data-refused={refused && !met ? "" : undefined}
      role={refused && !met ? "alert" : undefined}
      className={cn(
        "m-0 mt-1 flex items-start gap-1.5 text-sm text-pretty text-text-3 data-met:text-text-2 data-refused:text-danger",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="grid h-4 w-3.5 shrink-0 place-items-center"
      >
        {met ? (
          <Check className="size-3.5" />
        ) : refused ? (
          <CircleAlert className="size-3.5" />
        ) : (
          <span className="size-2 rounded-block bg-border-strong" />
        )}
      </span>
      <span>
        {children}
        <span className="sr-only">{met ? ": met" : ": not met yet"}</span>
      </span>
    </p>
  );
}

export { FieldRule };
