import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

const sizes = {
  default: "gap-5 p-6",
  compact: "gap-3 p-3.5 wide:px-5 wide:py-4.5",
};

/** A panel on `surface`; `compact` for one of several panels in a section. */
function Card({
  className,
  size = "default",
  ...props
}: ComponentProps<"div"> & { size?: keyof typeof sizes }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col rounded-card border border-border bg-surface text-text",
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  );
}

/** A card's title, an `h2` unless `render` gives another heading. */
function CardTitle({
  render,
  className,
  ...props
}: useRender.ComponentProps<"h2">) {
  return useRender({
    defaultTagName: "h2",
    render,
    props: mergeProps<"h2">(
      {
        className: cn(
          "text-xl font-semibold tracking-tight text-text",
          className,
        ),
      },
      props,
    ),
  });
}

function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-text-3", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardHeader, CardTitle };
