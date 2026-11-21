import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import {
  type ComponentProps,
  createContext,
  type ReactElement,
  type ReactNode,
  use,
} from "react";
import { cn } from "#lib/utils.ts";
import { Mark } from "./mark.tsx";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

const SidebarContext = createContext({ collapsed: false });

/** Whether the sidebar around the caller is collapsed to its rail of icons. */
const useSidebar = () => use(SidebarContext);

/** The page: the sidebar beside the main content from the `wide` breakpoint, a top bar above it below. */
function SidebarLayout({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-layout"
      className={cn("min-h-dvh wide:flex", className)}
      {...props}
    />
  );
}

function SkipLink({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      data-slot="skip-link"
      className={cn(
        "fixed top-2 left-3 z-50 -translate-y-16 rounded-control bg-text px-2.5 py-1.5 font-medium text-on-text transition-move outline-none focus-visible:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
        className,
      )}
      {...props}
    />
  );
}

/** The sidebar from the `wide` breakpoint: 232px, or a 60px rail of icons when collapsed. */
function Sidebar({
  collapsed,
  className,
  children,
  ...props
}: ComponentProps<"aside"> & { collapsed: boolean }) {
  return (
    <SidebarContext value={{ collapsed }}>
      <aside
        data-slot="sidebar"
        data-collapsed={collapsed ? "" : undefined}
        className={cn(
          "sticky top-0 z-30 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-border bg-rail px-2.5 pt-3.5 pb-3 text-text-2 transition-[width] duration-(--motion-base) ease-out wide:flex",
          collapsed ? "w-[60px]" : "w-[232px]",
          className,
        )}
        {...props}
      >
        {children}
      </aside>
    </SidebarContext>
  );
}

/** The bar across the top below the `wide` breakpoint, which opens the sidebar as a drawer. */
function SidebarTopBar({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="sidebar-top-bar"
      className={cn(
        "sticky top-0 z-20 flex h-13 items-center gap-1.5 border-b border-border bg-bg/85 px-2 backdrop-blur-md wide:hidden",
        className,
      )}
      {...props}
    />
  );
}

/** The sidebar as a drawer from the left, opened by `trigger`; never collapsed. */
function SidebarDrawer({
  open,
  onOpenChange,
  trigger,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  title: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger render={trigger} />
      <SheetContent className="px-2.5 pt-3.5 pb-3">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SidebarContext value={{ collapsed: false }}>{children}</SidebarContext>
      </SheetContent>
    </Sheet>
  );
}

/** The mark and the product's name; the name is read but not shown on the rail. */
function SidebarBrand({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  const { collapsed } = useSidebar();
  return (
    <div
      data-slot="sidebar-brand"
      className={cn(
        "flex h-9 shrink-0 items-center gap-2.5 px-2.5 text-lg font-semibold tracking-tight whitespace-nowrap text-text",
        className,
      )}
      {...props}
    >
      <Mark />
      <span className={collapsed ? "sr-only" : undefined}>{children}</span>
    </div>
  );
}

function SidebarNav({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      data-slot="sidebar-nav"
      className={cn("mt-3 flex flex-col gap-0.5", className)}
      {...props}
    />
  );
}

/**
 * A link or button of the sidebar: its icon and its label, and quietly at its
 * end the `shortcut` that does the same, or on the rail its icon alone, with
 * the label in a tooltip. A link marked `aria-current="page"` is drawn as the
 * current page.
 */
function SidebarItem({
  icon,
  label,
  shortcut,
  render,
  className,
  ...props
}: useRender.ComponentProps<"button"> & {
  icon: ReactNode;
  label: string;
  shortcut?: string;
}) {
  const { collapsed } = useSidebar();
  const item = useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(
      {
        className: cn(
          "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-control px-3 font-medium whitespace-nowrap text-text-2 transition-state outline-none hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text disabled:cursor-default disabled:opacity-50 aria-[current=page]:bg-surface-3 aria-[current=page]:text-text [&_svg]:size-4 [&_svg]:shrink-0",
          className,
        ),
        ...(render === undefined ? { type: "button" } : {}),
      },
      props,
      {
        children: (
          <>
            {icon}
            <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
            {shortcut === undefined || collapsed ? null : (
              <span
                aria-hidden="true"
                className="ml-auto text-xs font-normal text-text-3"
              >
                {shortcut}
              </span>
            )}
          </>
        ),
      },
    ),
  });
  if (!collapsed) return item;
  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        "mt-auto flex flex-col gap-0.5 border-t border-border pt-2.5",
        className,
      )}
      {...props}
    />
  );
}

/** The page's main content, focusable so that the skip link can move to it. */
function SidebarMain({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-main"
      tabIndex={-1}
      className={cn("min-w-0 flex-1 outline-none", className)}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarBrand,
  SidebarDrawer,
  SidebarFooter,
  SidebarItem,
  SidebarLayout,
  SidebarMain,
  SidebarNav,
  SidebarTopBar,
  SkipLink,
  useSidebar,
};
