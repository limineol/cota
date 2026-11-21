import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/** Tags side by side, wrapping. */
function Tags({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="tags"
      className={cn(
        "m-0 flex list-none flex-wrap items-center gap-1.5 p-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A value something was made with, as a link given by `render`: its kind
 * (`dimension`), its mark when it has one, and its name.
 */
function Tag({
  dimension,
  render,
  className,
  children,
  ...props
}: useRender.ComponentProps<"a"> & { dimension: ReactNode }) {
  const link = useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(
          "inline-flex h-6.5 max-w-full items-center gap-1.5 rounded-control border border-border bg-surface px-2 text-sm text-text transition-state outline-none hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
          className,
        ),
        children: (
          <>
            <span className="text-text-3">{dimension}</span>
            <span className="flex min-w-0 items-center gap-1.25 truncate">
              {children}
            </span>
          </>
        ),
      },
      props,
    ),
  });
  return (
    <li data-slot="tag" className="min-w-0 max-w-full">
      {link}
    </li>
  );
}

export { Tag, Tags };
