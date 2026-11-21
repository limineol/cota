import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";
import { cn } from "#lib/utils.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
}

const optionClass =
  "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-control px-2.5 font-medium whitespace-nowrap text-text-2 transition-state outline-none select-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text data-checked:bg-text data-checked:text-on-text [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * One of a few options, side by side or stacked. With `iconOnly`, each option
 * shows its icon, and its label names it for screen readers and in a tooltip.
 * `sm` is a smaller control for a panel, which scrolls sideways when its
 * options do not fit; `xs` is smaller still, unbordered on `surface-2`, for
 * the end of a field.
 */
function Segmented<T extends string>({
  label,
  value,
  options,
  onValueChange,
  iconOnly = false,
  orientation = "horizontal",
  size = "default",
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onValueChange: (value: T) => void;
  iconOnly?: boolean;
  orientation?: "horizontal" | "vertical";
  size?: "default" | "sm" | "xs";
  className?: string;
}) {
  return (
    <RadioGroup
      data-slot="segmented"
      aria-label={label}
      value={value}
      onValueChange={(next: T) => onValueChange(next)}
      className={cn(
        "inline-flex max-w-full gap-0.5 rounded-panel border border-border bg-surface p-0.5",
        orientation === "vertical" && "flex-col",
        size !== "default" && "shrink-0 overflow-x-auto [scrollbar-width:none]",
        size === "xs" && "rounded-control border-0 bg-surface-2",
        className,
      )}
    >
      {options.map((option) =>
        iconOnly ? (
          <Tooltip key={option.value}>
            <TooltipTrigger
              render={
                <Radio.Root
                  value={option.value}
                  aria-label={option.label}
                  className={cn(optionClass, "w-7 px-0")}
                />
              }
            >
              {option.icon}
            </TooltipTrigger>
            <TooltipContent side={orientation === "vertical" ? "right" : "top"}>
              {option.label}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Radio.Root
            key={option.value}
            value={option.value}
            className={cn(
              optionClass,
              size === "sm" &&
                "h-6 px-2 text-sm focus-visible:-outline-offset-2",
              size === "xs" &&
                "h-5 rounded-block px-1.5 text-sm focus-visible:-outline-offset-2",
            )}
          >
            {option.icon}
            {option.label}
          </Radio.Root>
        ),
      )}
    </RadioGroup>
  );
}

export { Segmented, type SegmentedOption };
