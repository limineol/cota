import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "#lib/utils.ts";

/** A box that is ticked or not, ink when ticked; named by the label around it. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-text-3 bg-surface text-on-text transition-state outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text data-checked:border-text data-checked:bg-text data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex data-unchecked:hidden">
        <Check className="size-2.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
