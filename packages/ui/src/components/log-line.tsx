import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/**
 * A line as a program prints it in its log, in mono, in an inset; `refused`
 * when what the owner took from it was not right. The caption says where the
 * log is.
 */
function LogLine({
  refused = false,
  caption,
  className,
  children,
  ...props
}: Omit<ComponentProps<"figure">, "children"> & {
  readonly refused?: boolean;
  readonly caption?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <figure
      data-slot="log-line"
      className={cn("m-0 flex min-w-0 flex-col gap-2", className)}
      {...props}
    >
      <pre
        data-refused={refused ? "" : undefined}
        className="m-0 w-fit max-w-full rounded-panel border border-border bg-surface px-3.5 py-3 font-mono text-sm break-words whitespace-pre-wrap text-text-2 data-refused:border-danger/40"
      >
        {children}
      </pre>
      {caption === undefined ? null : (
        <figcaption className="m-0 text-sm text-pretty text-text-3">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/** What a log line prints before its message: the time, the level and the fiber. */
function LogLinePrefix({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="log-line-prefix"
      className={cn("text-text-3", className)}
      {...props}
    />
  );
}

/** The part of a log line the owner looks for. */
function LogLineMark({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="log-line-mark"
      className={cn("font-medium whitespace-nowrap text-text", className)}
      {...props}
    />
  );
}

export { LogLine, LogLineMark, LogLinePrefix };
