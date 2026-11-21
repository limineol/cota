import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";
import { Button, buttonVariants } from "./button.tsx";

/** The pages of a list, in its panel's foot: which rows are shown on the left, the way to the pages beside it on the right. */
function Pager({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      data-slot="pager"
      className={cn(
        "flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2",
        className,
      )}
      {...props}
    />
  );
}

function PagerCount({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pager-count"
      className={cn("text-sm text-text-3 tabular-nums", className)}
      {...props}
    />
  );
}

/** The previous and next pages' buttons, with the page shown between them. */
function PagerControls({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="pager-controls"
      className={cn("flex items-center gap-2.5", className)}
      {...props}
    />
  );
}

/** The way to a neighbouring page: a link given by `render`, or a disabled button when there is no such page. */
function PagerStep({
  render,
  disabled = false,
  className,
  children,
  ...props
}: useRender.ComponentProps<"a"> & { readonly disabled?: boolean }) {
  const link = useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          className,
        ),
        children,
      },
      props,
    ),
  });
  return disabled ? (
    <Button variant="outline" size="sm" disabled className={className}>
      {children}
    </Button>
  ) : (
    link
  );
}

function PagerPage({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="pager-page"
      className={cn("text-sm text-text-2 tabular-nums", className)}
      {...props}
    />
  );
}

/** Why the list stops where it does, on the last page that can be shown. */
function PagerNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="pager-note"
      className={cn("w-full text-sm text-pretty text-text-3", className)}
      {...props}
    />
  );
}

export { Pager, PagerControls, PagerCount, PagerNote, PagerPage, PagerStep };
