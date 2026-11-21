import { ArrowUpRight, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "#lib/utils.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

/**
 * The cause's headline. With `open` given it is a button that opens and
 * closes the whole message, a chevron before it, and is held to two lines
 * while closed; without, it is the whole message, set in line with the
 * headlines that open.
 */
function ErrorCauseTitle({
  open,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "type"> & {
  open?: boolean;
  children: ReactNode;
}) {
  const headline = (
    <span
      className={cn("min-w-0 break-words", open === false && "line-clamp-2")}
    >
      {children}
    </span>
  );
  const shared =
    "grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-1 text-left leading-snug font-medium text-text";
  if (open === undefined) {
    return (
      <div data-slot="error-cause-title" className={cn(shared, className)}>
        <span />
        {headline}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-slot="error-cause-title"
      aria-expanded={open}
      className={cn(
        shared,
        "group/title -mx-1 cursor-pointer rounded-control px-1 decoration-text-3 underline-offset-3 transition-state outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
        className,
      )}
      {...props}
    >
      <ChevronRight
        aria-hidden="true"
        className="mt-0.5 size-4 text-text-3 transition-transform group-aria-expanded/title:rotate-90 motion-reduce:transition-none"
      />
      {headline}
    </button>
  );
}

/** What the cause is, quietly, on one line that wraps: provider, model, status and error type. */
function ErrorCauseFacts({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="error-cause-facts"
      className={cn(
        "mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-sm text-text-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A value of the cause that filters the list by it when pressed; `mark` goes
 * before it, and `action` says what pressing does to assistive technology.
 */
function ErrorCauseValue({
  mark,
  action,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "type"> & {
  mark?: ReactNode;
  action?: string;
}) {
  return (
    <button
      type="button"
      data-slot="error-cause-value"
      className={cn(
        "inline-flex min-w-0 cursor-pointer items-center gap-1.25 rounded-control whitespace-nowrap decoration-text-3 underline-offset-3 transition-state outline-none hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
        className,
      )}
      {...props}
    >
      {action === undefined ? null : <span className="sr-only">{action} </span>}
      {mark}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** A fact that does not filter, such as the status or the error type. */
function ErrorCauseFact({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="error-cause-fact"
      className={cn("whitespace-nowrap tabular-nums", className)}
      {...props}
    />
  );
}

/** The whole message, shown while the cause is open. */
function ErrorCauseDetail({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="error-cause-detail"
      className={cn("mt-1.5 min-w-0 pl-5", className)}
      {...props}
    />
  );
}

/** The way to the cause's latest request: `render` is the link, named by `label` and its tooltip. */
function ErrorCauseLatest({
  render,
  label = "Latest request",
}: {
  render: ReactElement;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        data-slot="error-cause-latest"
        aria-label={label}
        className="-my-1 inline-flex size-7 items-center justify-center rounded-control text-text-2 transition-state outline-none hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
        render={render}
      >
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export {
  ErrorCauseDetail,
  ErrorCauseFact,
  ErrorCauseFacts,
  ErrorCauseLatest,
  ErrorCauseTitle,
  ErrorCauseValue,
};
