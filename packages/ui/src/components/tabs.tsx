import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/**
 * The parts of one subject as links over a rule, the open one underlined in
 * ink; the open part is in the URL, so each is a link and not a button. It
 * scrolls sideways when the links do not fit. `end` holds what acts on the
 * open part, at the rule's right end, or under the links at the left when
 * the row is narrower than 672px.
 */
function Tabs({
  end,
  className,
  ...props
}: ComponentProps<"nav"> & { end?: ReactNode }) {
  const links = (
    <nav
      data-slot="tabs"
      className={cn(
        "flex max-w-full gap-5 overflow-x-auto border-b border-border [scrollbar-width:none]",
        end === undefined ? className : "@2xl/tabs:-mb-px @2xl/tabs:min-w-0",
      )}
      {...props}
    />
  );
  if (end === undefined) return links;
  return (
    <div data-slot="tabs-row" className={cn("@container/tabs", className)}>
      <div className="flex flex-col gap-3 @2xl/tabs:flex-row @2xl/tabs:items-center @2xl/tabs:justify-between @2xl/tabs:gap-4 @2xl/tabs:border-b @2xl/tabs:border-border">
        {links}
        <div data-slot="tabs-end" className="flex min-w-0 items-center">
          {end}
        </div>
      </div>
    </div>
  );
}

/** One part, a link given by `render`; `current` marks the part shown, and `count` is how many things it holds. */
function TabsItem({
  render,
  current,
  count,
  className,
  children,
  ...props
}: useRender.ComponentProps<"a"> & { current: boolean; count?: ReactNode }) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(
          "-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent font-medium whitespace-nowrap text-text-2 transition-state outline-none hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text aria-[current=page]:border-text aria-[current=page]:text-text",
          className,
        ),
        "aria-current": current ? "page" : undefined,
        children: (
          <>
            {children}
            {count === undefined ? null : (
              <span className="font-normal text-text-3 tabular-nums">
                {count}
              </span>
            )}
          </>
        ),
      },
      props,
    ),
  });
}

export { Tabs, TabsItem };
