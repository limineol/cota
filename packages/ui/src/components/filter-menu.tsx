import { Menu } from "@base-ui/react/menu";
import { Check, CirclePlus } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "#lib/utils.ts";
import { MagnitudeBar } from "./magnitude-bar.tsx";

const namedAtMost = 2;

/**
 * One dimension's values to filter by, in a menu under a small button named
 * by `label`. With nothing `chosen` the button is dashed, with a plus; once
 * values are chosen it is solid and carries them after a rule, up to two
 * names and then their number. The menu stays open while values are ticked,
 * so several can be chosen at once; `note` heads the values.
 */
function FilterMenu({
  label,
  chosen = [],
  note,
  className,
  children,
}: {
  label: string;
  chosen?: ReadonlyArray<string>;
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  const some = chosen.length > 0;
  const named = chosen.length <= namedAtMost;
  const stated = named ? chosen.join(", ") : `${chosen.length} chosen`;
  return (
    <Menu.Root>
      <Menu.Trigger
        data-slot="filter-menu"
        data-chosen={some ? "" : undefined}
        className={cn(
          "inline-flex h-7 max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-control border border-dashed border-border-strong bg-surface px-2.5 text-sm font-medium whitespace-nowrap text-text-2 transition-state outline-none select-none hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text data-chosen:border-solid data-chosen:pr-1 data-chosen:text-text data-popup-open:bg-surface-2",
          className,
        )}
      >
        <CirclePlus
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-3"
        />
        {label}
        {some ? (
          <>
            <span aria-hidden="true" className="h-3.5 w-px bg-border-strong" />
            {named ? (
              chosen.map((name) => (
                <Fragment key={name}>
                  {" "}
                  <FilterMenuChosen>{name}</FilterMenuChosen>
                </Fragment>
              ))
            ) : (
              <>
                {" "}
                <FilterMenuChosen>{stated}</FilterMenuChosen>
              </>
            )}
          </>
        ) : null}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={4}
          align="start"
          className="isolate z-50 outline-none"
        >
          <Menu.Popup className="max-h-(--available-height) w-max max-w-80 min-w-60 origin-(--transform-origin) overflow-y-auto rounded-panel border border-border-strong bg-surface p-1 text-base text-text outline-none transition-state data-ending-style:opacity-0 data-starting-style:opacity-0">
            {note === undefined ? (
              children
            ) : (
              <Menu.Group>
                <Menu.GroupLabel className="px-2 pt-1 pb-1.5 text-xs text-text-3">
                  {note}
                </Menu.GroupLabel>
                {children}
              </Menu.Group>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function FilterMenuChosen({ children }: { children: ReactNode }) {
  return (
    <span className="max-w-32 truncate rounded-block bg-surface-3 px-1.5 leading-5 font-normal text-text">
      {children}
    </span>
  );
}

/**
 * A value, ticked while it is chosen; `mark` goes before it and `count`
 * after, and under them a hairline as long as `fraction` of the largest
 * value's count.
 */
function FilterMenuItem({
  checked,
  onCheckedChange,
  mark,
  count,
  fraction,
  className,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  mark?: ReactNode;
  count?: ReactNode;
  fraction?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Menu.CheckboxItem
      data-slot="filter-menu-item"
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      className={cn(
        "group/item grid cursor-pointer grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-control py-1.25 pr-2 pl-2 whitespace-nowrap outline-none select-none data-highlighted:bg-surface-2",
        className,
      )}
    >
      <span className="col-start-1 flex size-3.5 items-center justify-center rounded-block border border-text-3 text-on-text transition-state group-data-checked/item:border-text group-data-checked/item:bg-text">
        <Menu.CheckboxItemIndicator className="flex">
          <Check className="size-3" strokeWidth={3} />
        </Menu.CheckboxItemIndicator>
      </span>
      <span className="col-start-2 flex min-w-0 items-center gap-1.5">
        {mark}
        <span className="truncate">{children}</span>
      </span>
      {count === undefined ? null : (
        <span className="text-xs text-text-3 tabular-nums">{count}</span>
      )}
      {fraction === undefined ? null : (
        <MagnitudeBar
          fraction={fraction}
          className="col-start-2 col-end-4 h-px"
        />
      )}
    </Menu.CheckboxItem>
  );
}

/** A line in place of the values, while they load or when there are none. */
function FilterMenuNote({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Menu.Item
      data-slot="filter-menu-note"
      disabled
      className={cn("px-2 py-1 text-sm text-text-3", className)}
    >
      {children}
    </Menu.Item>
  );
}

export { FilterMenu, FilterMenuItem, FilterMenuNote };
