import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ChevronLeft } from "lucide-react";
import { cn } from "#lib/utils.ts";

/** A link back to the screen this one was opened from, above its title; the link is given by `render`. */
function BackLink({
  render,
  className,
  children,
  ...props
}: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(
          "mb-4 inline-flex items-center gap-1 rounded-control text-sm text-text-2 transition-state outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
          className,
        ),
        children: (
          <>
            <ChevronLeft aria-hidden="true" className="size-3.5" />
            {children}
          </>
        ),
      },
      props,
    ),
  });
}

export { BackLink };
