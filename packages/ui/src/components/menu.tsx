import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/**
 * Actions in a menu that opens under an outlined button: `icon` and `label`
 * name the button; each item does one thing and closes the menu.
 */
function Menu({
  label,
  icon,
  className,
  children,
}: {
  label: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        data-slot="menu"
        className={cn(
          "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-control border border-border-strong bg-surface pr-1.5 pl-2.5 text-sm font-medium whitespace-nowrap text-text transition-state outline-none select-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text data-popup-open:bg-surface-2 [&_svg]:size-3.5 [&_svg]:shrink-0",
          className,
        )}
      >
        {icon}
        {label}
        <ChevronDown aria-hidden="true" className="text-text-3" />
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          sideOffset={4}
          align="start"
          className="isolate z-50 outline-none"
        >
          <MenuPrimitive.Popup className="max-h-(--available-height) w-max max-w-[min(28rem,calc(100vw-2rem))] min-w-64 origin-(--transform-origin) overflow-y-auto rounded-panel border border-border-strong bg-surface p-1 text-base text-text outline-none transition-state data-ending-style:opacity-0 data-starting-style:opacity-0">
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

/**
 * One action: its `title`, in mono when it is code, and under it a quiet
 * `detail` of what it is.
 */
function MenuItem({
  title,
  detail,
  code = false,
  onClick,
  className,
}: {
  title: ReactNode;
  detail?: ReactNode;
  code?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-control px-2 py-1.5 outline-none select-none data-highlighted:bg-surface-2",
        className,
      )}
    >
      <span className={cn("truncate text-text", code && "font-mono text-sm")}>
        {title}
      </span>
      {detail === undefined ? null : (
        <span className="truncate text-sm text-text-3 tabular-nums">
          {detail}
        </span>
      )}
    </MenuPrimitive.Item>
  );
}

/** Items under a quiet label that says what they are. */
function MenuGroup({
  label,
  className,
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <MenuPrimitive.Group data-slot="menu-group" className={className}>
      <MenuPrimitive.GroupLabel className="px-2 pt-1 pb-1.5 text-sm text-pretty text-text-3">
        {label}
      </MenuPrimitive.GroupLabel>
      {children}
    </MenuPrimitive.Group>
  );
}

/** A line in place of the items, when there are none. */
function MenuNote({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-note"
      disabled
      className={cn("px-2 py-1.5 text-sm text-text-3", className)}
    >
      {children}
    </MenuPrimitive.Item>
  );
}

export { Menu, MenuGroup, MenuItem, MenuNote };
