import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** A quiet line about what is beside it: where a figure comes from, why a list stops; its links underlined. */
function Note({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="note"
      className={cn(
        "m-0 text-sm text-pretty text-text-3 [&_a]:text-text-2 [&_a]:underline [&_a]:decoration-text-3 [&_a]:underline-offset-3 [&_a]:transition-state [&_a:hover]:text-text",
        className,
      )}
      {...props}
    />
  );
}

export { Note };
