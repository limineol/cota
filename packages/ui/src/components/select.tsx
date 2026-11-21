import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#lib/utils.ts";

interface SelectOption<T extends string | null> {
  readonly value: T;
  readonly label: string;
  readonly mark?: ReactNode;
}

const triggers = {
  default:
    "h-8.5 rounded-panel border-border pr-2 pl-3 font-medium hover:border-border-strong data-popup-open:border-border-strong",
  field: "h-8 rounded-control border-border-strong pr-1.5 pl-2.5",
};

const labelOf = (option: SelectOption<string | null>) => (
  <span className="flex min-w-0 items-center gap-1.75">
    {option.mark}
    <span className="truncate">{option.label}</span>
  </span>
);

/**
 * One of several options, named by `label`, chosen from a list that opens
 * under it; an option may carry a mark, such as a pool's, before its words.
 * `field` is as tall and as edged as an input, for a row of fields; with a
 * value no option has, it shows `placeholder`; `invalid` edges it in
 * `danger`, as a refused field.
 */
function Select<T extends string | null>({
  label,
  value,
  options,
  onValueChange,
  placeholder,
  size = "default",
  invalid = false,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onValueChange: (value: T) => void;
  placeholder?: string;
  size?: keyof typeof triggers;
  invalid?: boolean;
  className?: string;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root
      items={options.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
      value={value}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next);
        if (picked !== undefined) onValueChange(picked.value);
      }}
    >
      <SelectPrimitive.Trigger
        data-slot="select"
        data-size={size}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn(
          "inline-flex min-w-0 shrink-0 cursor-pointer items-center justify-between gap-2 border bg-surface whitespace-nowrap text-text transition-state outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text aria-invalid:border-danger",
          triggers[size],
          className,
        )}
      >
        <SelectPrimitive.Value className="flex min-w-0">
          {() =>
            chosen === undefined ? (
              <span className="truncate text-text-3">{placeholder}</span>
            ) : (
              labelOf(chosen)
            )
          }
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="flex shrink-0 text-text-3">
          <ChevronDown className="size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          sideOffset={4}
          alignItemWithTrigger={false}
          align="end"
          className="isolate z-50 outline-none"
        >
          <SelectPrimitive.Popup className="min-w-(--anchor-width) origin-(--transform-origin) rounded-panel border border-border-strong bg-surface p-1 text-base text-text outline-none transition-state data-ending-style:opacity-0 data-starting-style:opacity-0">
            <SelectPrimitive.List className="max-h-(--available-height) overflow-y-auto">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value ?? ""}
                  value={option.value}
                  label={option.label}
                  className="grid h-7 cursor-pointer grid-cols-[1rem_1fr] items-center gap-1.5 rounded-control pr-3 pl-1.5 whitespace-nowrap outline-none select-none data-highlighted:bg-surface-2"
                >
                  <SelectPrimitive.ItemIndicator className="col-start-1 flex">
                    <Check className="size-3.5" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText className="col-start-2 min-w-0">
                    {labelOf(option)}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select, type SelectOption };
