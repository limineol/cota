import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type { ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/** A setting that is on or off, ink when on; named by the label around it. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-text-3 bg-surface-2 p-px transition-state outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text data-checked:border-text data-checked:bg-text data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-3 rounded-full bg-text-3 transition-move data-checked:translate-x-3 data-checked:bg-on-text" />
    </SwitchPrimitive.Root>
  );
}

/** A switch and its name side by side, pressed anywhere; `count` is written after the name. */
function SwitchField({
  className,
  children,
  count,
  ...props
}: SwitchPrimitive.Root.Props & { children: ReactNode; count?: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the switch inside it is the control
    <label
      data-slot="switch-field"
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-sm whitespace-nowrap text-text-2 select-none hover:text-text",
        className,
      )}
    >
      <Switch {...props} />
      <span>
        {children}
        {count === undefined ? null : (
          <span className="ml-1.5 text-text-3 tabular-nums">{count}</span>
        )}
      </span>
    </label>
  );
}

export { Switch, SwitchField };
