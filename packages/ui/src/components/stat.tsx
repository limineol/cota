import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

const statVariants = cva("flex min-w-0 flex-col", {
  variants: {
    variant: {
      plain: "gap-1.5",
      tile: "gap-1 rounded-card border border-border bg-surface px-4 py-3.5",
      panel:
        "gap-1.5 rounded-card border border-border bg-surface p-3.5 wide:px-5 wide:py-4.5",
    },
  },
  defaultVariants: {
    variant: "plain",
  },
});

/**
 * A figure with its label, as a tile among others, a panel of its own, or
 * plain inside a card. Given a link by `render`, the whole figure leads where
 * its figure is listed, and shows so on hover and focus.
 */
function Stat({
  render,
  className,
  variant = "plain",
  ...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof statVariants>) {
  return useRender({
    defaultTagName: "div",
    render,
    props: {
      ...mergeProps<"div">(
        {
          className: cn(
            statVariants({ variant }),
            render !== undefined &&
              "group/stat cursor-pointer transition-state outline-none hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
            className,
          ),
        },
        props,
      ),
      "data-slot": "stat",
    },
  });
}

/** The figure's name; an icon in it, such as the arrow of a figure that is a link, is set small and quiet. */
function StatLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-label"
      className={cn(
        "flex items-center gap-1 text-sm text-text-2 group-hover/stat:text-text [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-text-3",
        className,
      )}
      {...props}
    />
  );
}

const valueVariants = cva(
  "flex min-w-0 flex-wrap items-baseline gap-x-2 tabular-nums",
  {
    variants: {
      size: {
        md: "text-2xl leading-tight font-medium tracking-tight",
        lg: "text-[24px] leading-none font-medium tracking-tighter wide:text-[30px]",
        xl: "text-3xl leading-none font-semibold tracking-tighter wide:text-4xl",
      },
      tone: {
        default: "text-text",
        danger: "text-danger",
      },
    },
    defaultVariants: {
      size: "md",
      tone: "default",
    },
  },
);

/** The figure itself, with its unit and delta as children beside it. */
function StatValue({
  className,
  size = "md",
  tone = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof valueVariants>) {
  return (
    <div
      data-slot="stat-value"
      className={cn(valueVariants({ size, tone }), className)}
      {...props}
    />
  );
}

function StatUnit({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="stat-unit"
      className={cn(
        "text-sm font-normal tracking-normal text-text-3 wide:text-base",
        className,
      )}
      {...props}
    />
  );
}

/**
 * How the figure changed since the window before, as `delta` writes it: up or
 * down in `text-2`, no change in `text-3`, and in red when up is worse.
 */
function StatDelta({
  className,
  direction,
  worse = false,
  ...props
}: ComponentProps<"span"> & {
  direction: "up" | "down" | "none";
  worse?: boolean;
}) {
  return (
    <span
      data-slot="stat-delta"
      data-direction={direction}
      className={cn(
        "text-xs font-medium tracking-normal whitespace-nowrap text-text-2 tabular-nums data-[direction=none]:font-normal data-[direction=none]:text-text-3",
        worse && direction === "up" && "text-danger",
        className,
      )}
      {...props}
    />
  );
}

/** A line under the figure; its `strong` parts read as figures. */
function StatMeta({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-meta"
      className={cn(
        "text-sm text-text-3 tabular-nums [&_strong]:font-medium [&_strong]:text-text",
        className,
      )}
      {...props}
    />
  );
}

function StatNote({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-note"
      className={cn("text-xs text-text-3 tabular-nums", className)}
      {...props}
    />
  );
}

export { Stat, StatDelta, StatLabel, StatMeta, StatNote, StatUnit, StatValue };
