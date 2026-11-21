import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { ReactNode } from "react";
import { cn } from "#lib/utils.ts";

interface ToggleOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count?: ReactNode;
}

/**
 * A few settings side by side, each pressed or not on its own, in the shape
 * of a small `segmented`: a pressed option is filled as `segmented`'s chosen
 * one; one not pressed has no ground, is quiet and has its name struck
 * through. Each may carry a count.
 */
function Toggles<T extends string>({
  label,
  pressed,
  options,
  onPressedChange,
  className,
}: {
  label: string;
  pressed: ReadonlyArray<T>;
  options: ReadonlyArray<ToggleOption<T>>;
  onPressedChange: (value: T, pressed: boolean) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      data-slot="toggles"
      aria-label={label}
      multiple
      value={pressed}
      onValueChange={(next: Array<T>) => {
        for (const option of options) {
          const now = next.includes(option.value);
          if (now !== pressed.includes(option.value)) {
            onPressedChange(option.value, now);
          }
        }
      }}
      className={cn(
        "inline-flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-panel border border-border bg-surface p-0.5 [scrollbar-width:none]",
        className,
      )}
    >
      {options.map((option) => (
        <TogglePrimitive
          key={option.value}
          value={option.value}
          className="group/toggle inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2 text-sm font-medium whitespace-nowrap text-text-3 transition-state outline-none select-none hover:text-text-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text data-pressed:bg-text data-pressed:text-on-text"
        >
          <span className="line-through decoration-text-3 group-data-pressed/toggle:no-underline">
            {option.label}
          </span>
          {option.count === undefined ? null : (
            <>
              {" "}
              <span className="font-normal tabular-nums">{option.count}</span>
            </>
          )}
        </TogglePrimitive>
      ))}
    </ToggleGroup>
  );
}

export { type ToggleOption, Toggles };
