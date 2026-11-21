import { ChevronRight } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "#lib/utils.ts";
import { Skeleton } from "./skeleton.tsx";

/** A conversation's entries, one under another; each renders only once it nears the screen. */
function Transcript({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="transcript"
      className={cn(
        "flex min-w-0 flex-col gap-1.5 [&>*]:[contain-intrinsic-size:auto_2.75rem] [&>*]:[content-visibility:auto]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * What a participant said, under its role: a user's as a filled block, an
 * assistant's as bare text on the ground.
 */
function TranscriptMessage({
  from,
  label,
  className,
  children,
  ...props
}: ComponentProps<"section"> & {
  from: "user" | "assistant";
  label: ReactNode;
}) {
  return (
    <section
      data-slot="transcript-message"
      data-from={from}
      className={cn(
        "flex min-w-0 flex-col gap-2 px-4.5",
        from === "user"
          ? "my-1 rounded-panel border border-border-strong bg-surface-2 py-3.5"
          : "py-2",
        className,
      )}
      {...props}
    >
      <header
        className={cn(
          "text-xs font-semibold",
          from === "user" ? "text-text" : "text-text-2",
        )}
      >
        {label}
      </header>
      {children}
    </section>
  );
}

/**
 * A quiet row that opens on click: a tool call, reasoning, a system message,
 * a reminder, an image or what the dashboard cannot read. Closed, it is one
 * line of its `label`, a `preview` and a `meta`; `danger` marks a failure.
 */
function TranscriptRow({
  open,
  onOpenChange,
  icon,
  label,
  preview,
  mono = false,
  meta,
  tone,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: ReactNode;
  label: ReactNode;
  preview?: ReactNode;
  mono?: boolean;
  meta?: ReactNode;
  tone?: "danger";
  className?: string;
  children: ReactNode;
}) {
  const detail = useId();
  return (
    <div
      data-slot="transcript-row"
      data-open={open ? "" : undefined}
      data-tone={tone}
      className={cn(
        "group/row min-w-0 rounded-panel border border-transparent transition-state data-open:border-border data-open:bg-surface",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? detail : undefined}
        onClick={() => onOpenChange(!open)}
        className="grid min-h-8 w-full cursor-pointer grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-panel px-3 py-1.5 text-left text-sm text-text-2 transition-state outline-none hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text group-data-open/row:hover:bg-transparent [&_svg]:size-3.5 [&_svg]:shrink-0"
      >
        <ChevronRight
          aria-hidden="true"
          className="text-text-3 transition-move group-data-open/row:rotate-90"
        />
        <span className="flex text-text-3 group-data-[tone=danger]/row:text-danger">
          {icon}
        </span>
        <span className="font-medium whitespace-nowrap text-text">{label}</span>
        <span
          className={cn(
            "truncate text-text-3",
            mono && "font-mono text-xs",
            open && "invisible",
          )}
        >
          {preview}
        </span>
        <span className="text-xs whitespace-nowrap text-text-3 tabular-nums group-data-[tone=danger]/row:text-danger">
          {meta}
        </span>
      </button>
      {open ? (
        <div
          id={detail}
          className="flex min-w-0 flex-col gap-2.5 pt-1 pr-3.5 pb-3.5 pl-3.5 wide:pl-9"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A part of an open row under its label: a call's input, its result. */
function TranscriptPart({
  label,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { label: ReactNode }) {
  return (
    <div
      data-slot="transcript-part"
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      {...props}
    >
      <span className="text-xs text-text-3">{label}</span>
      {children}
    </div>
  );
}

/** A line about the text above it: how much was cut, or that a provider withheld it. */
function TranscriptNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="transcript-note"
      className={cn(
        "m-0 text-sm text-text-3 [&_a]:text-text-2 [&_a]:underline [&_a]:decoration-text-3 [&_a]:underline-offset-3 [&_a:hover]:text-text",
        className,
      )}
      {...props}
    />
  );
}

/** What follows the entries: those still to render, those the switches hide, and what was cut. */
function TranscriptFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="transcript-foot"
      className={cn(
        "flex flex-col items-center gap-2 py-3 text-center text-sm text-text-3 tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

/** The switches and buttons that choose what a transcript shows, on a line that wraps. */
/** Entries held while a transcript loads, shaped like a prompt, an answer and a few tool calls. */
function TranscriptSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="transcript-skeleton"
      aria-hidden="true"
      className={cn("flex flex-col gap-3 py-2", className)}
    >
      <Skeleton className="h-16 w-full rounded-panel" />
      <Skeleton className="w-11/12" />
      <Skeleton className="w-3/4" />
      <Skeleton className="w-2/3" />
      <Skeleton className="w-1/2" />
    </div>
  );
}

export {
  Transcript,
  TranscriptFoot,
  TranscriptMessage,
  TranscriptNote,
  TranscriptPart,
  TranscriptRow,
  TranscriptSkeleton,
};
