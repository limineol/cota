import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/** A screen's content, centred at most 1600px wide, with gutters of 32px or 16px on a phone. */
function Page({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="page"
      className={cn(
        "mx-auto w-full max-w-[1600px] px-4 pt-6 pb-24 wide:px-8 wide:pt-9",
        className,
      )}
      {...props}
    />
  );
}

function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-title"
      className={cn(
        "text-3xl font-semibold tracking-tight text-balance text-text",
        className,
      )}
      {...props}
    />
  );
}

/** The title and its description on the left, the screen's actions on the right. */
function PageHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        className,
      )}
      {...props}
    />
  );
}

function PageDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="page-description"
      className={cn("mt-1.5 text-base text-text-2 tabular-nums", className)}
      {...props}
    />
  );
}

/**
 * A part of a screen after the first, set off by a rule. While `stale`, what
 * it shows is dimmed, after a moment, until a new answer replaces it.
 */
function Section({
  className,
  stale = false,
  ...props
}: ComponentProps<"section"> & { stale?: boolean }) {
  return (
    <section
      data-slot="section"
      data-stale={stale ? "" : undefined}
      aria-busy={stale || undefined}
      className={cn(
        "mt-10 transition-state delay-150 data-stale:opacity-55 wide:mt-14",
        className,
      )}
      {...props}
    />
  );
}

function SectionHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section-header"
      className={cn(
        "mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t border-border pt-5",
        className,
      )}
      {...props}
    />
  );
}

function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="section-title"
      className={cn(
        "text-xl font-semibold tracking-tight text-text",
        className,
      )}
      {...props}
    />
  );
}

function SectionDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="section-description"
      className={cn("mt-0.75 text-sm text-text-3 tabular-nums", className)}
      {...props}
    />
  );
}

/** The heading of a panel inside a section; `level` 2 where the panel is the page's own part, as a tab's is. */
function Subheading({
  className,
  level = 3,
  ...props
}: ComponentProps<"h3"> & { level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Heading
      data-slot="subheading"
      className={cn("text-base font-semibold text-text", className)}
      {...props}
    />
  );
}

export {
  Page,
  PageDescription,
  PageHeader,
  PageTitle,
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
  Subheading,
};
