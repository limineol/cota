import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/**
 * Links to the views of one screen side by side, the current one filled as a
 * segmented control's choice is; scrolls sideways when they do not fit.
 */
function Switcher({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      data-slot="switcher"
      className={cn(
        "flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-panel border border-border bg-surface p-0.5 [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  );
}

/** One view, a link given by `render`; `current` marks the view shown. */
function SwitcherItem({
  render,
  current,
  className,
  ...props
}: useRender.ComponentProps<"a"> & { current: boolean }) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(
          "inline-flex h-7 shrink-0 items-center gap-1.75 rounded-control px-2.75 font-medium whitespace-nowrap text-text-2 transition-state outline-none hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text aria-[current=page]:bg-text aria-[current=page]:text-on-text",
          className,
        ),
        "aria-current": current ? "page" : undefined,
      },
      props,
    ),
  });
}

export { Switcher, SwitcherItem };
