import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** A request's role in words: the main conversation in ink, the others quieter. */
function RequestRole({
  main,
  className,
  ...props
}: ComponentProps<"span"> & { main: boolean }) {
  return (
    <span
      data-slot="request-role"
      className={cn(main ? "text-text" : "text-text-3", className)}
      {...props}
    />
  );
}

/** How a request ended, in words: red only for an error; `quiet` for a note on an answer, and `unseen` for an answer, said to assistive technology only, so the eye finds what did not answer. */
function RequestEnded({
  tone,
  className,
  ...props
}: ComponentProps<"span"> & { tone?: "danger" | "quiet" | "unseen" }) {
  return (
    <span
      data-slot="request-ended"
      className={cn(
        "whitespace-nowrap text-text-2",
        tone === "danger" && "text-danger",
        tone === "quiet" && "text-text-3",
        tone === "unseen" && "sr-only",
        className,
      )}
      {...props}
    />
  );
}

export { RequestEnded, RequestRole };
