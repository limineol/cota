import { Button } from "@cota/ui/components/button";
import { Segmented } from "@cota/ui/components/segmented";
import {
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
} from "@cota/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import {
  CircleAlert,
  LayoutGrid,
  LogOut,
  Menu,
  MessagesSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  SquareTerminal,
  Sun,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useApiMutation } from "#shared/api.ts";
import { useDisplayNames } from "#shared/names.tsx";
import { signedOut } from "#shared/sign-in.ts";
import { type Theme, useTheme } from "#shared/theme.tsx";
import { CommandPalette } from "./palette.tsx";

const collapsedKey = "cota-sidebar";

const storedCollapsed = () => {
  try {
    return localStorage.getItem(collapsedKey) === "collapsed";
  } catch {
    return false;
  }
};

const keepCollapsed = (collapsed: boolean) => {
  try {
    localStorage.setItem(collapsedKey, collapsed ? "collapsed" : "expanded");
  } catch {
    // A browser that refuses storage keeps the choice for this page only.
  }
};

const themes: ReadonlyArray<{
  readonly value: Theme;
  readonly label: string;
  readonly icon: ReactNode;
}> = [
  { value: "system", label: "System theme", icon: <Monitor /> },
  { value: "light", label: "Light theme", icon: <Sun /> },
  { value: "dark", label: "Dark theme", icon: <Moon /> },
];

const onApple = () => {
  try {
    return /Mac|iPhone|iPad/.test(navigator.platform);
  } catch {
    return false;
  }
};

/** The palette's shortcut as this computer's keyboard writes it. */
const shortcut = onApple() ? "⌘K" : "Ctrl K";

/** Whether a key pressed in this element is typed into it. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

/** Opens the palette on ⌘K or Ctrl+K anywhere, and on / where nothing is typed into, and closes it on ⌘K or Ctrl+K again. */
const usePaletteKeys = (toggle: (open?: boolean) => void) =>
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && !event.altKey && !event.shiftKey && event.key === "k") {
        event.preventDefault();
        toggle();
        return;
      }
      if (
        event.key === "/" &&
        !command &&
        !event.altKey &&
        !isTyping(event.target)
      ) {
        event.preventDefault();
        toggle(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

function Navigation({
  collapsed,
  onToggle,
  onNavigate,
  onSearch,
}: {
  readonly collapsed: boolean;
  readonly onToggle?: () => void;
  readonly onNavigate?: () => void;
  readonly onSearch: () => void;
}) {
  const { theme, choose } = useTheme();
  const signOut = useApiMutation(
    (_: undefined) => (client) => client["sign-in"].signOut(),
    async (_, queries) => signedOut(queries),
  );
  return (
    <>
      <SidebarBrand>Cota</SidebarBrand>
      <SidebarItem
        icon={<Search />}
        label="Search"
        shortcut={shortcut}
        aria-keyshortcuts="Meta+K Control+K /"
        onClick={onSearch}
        className="mt-3"
      />
      <SidebarNav aria-label="Primary" className="mt-1.5">
        <SidebarItem
          render={
            <Link
              to="/"
              activeOptions={{ exact: true }}
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            />
          }
          icon={<LayoutGrid />}
          label="Overview"
        />
        <SidebarItem
          render={
            <Link
              to="/sessions"
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            />
          }
          icon={<MessagesSquare />}
          label="Sessions"
        />
        <SidebarItem
          render={
            <Link
              to="/errors"
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            />
          }
          icon={<CircleAlert />}
          label="Errors"
        />
        <SidebarItem
          render={
            <Link
              to="/sql"
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            />
          }
          icon={<SquareTerminal />}
          label="SQL"
        />
        <SidebarItem
          render={
            <Link
              to="/settings"
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            />
          }
          icon={<Settings />}
          label="Settings"
        />
      </SidebarNav>
      <SidebarFooter>
        <Segmented
          label="Theme"
          value={theme}
          options={themes}
          onValueChange={choose}
          iconOnly
          orientation={collapsed ? "vertical" : "horizontal"}
          className={
            collapsed ? "mb-1.5 self-center" : "mb-1.5 ml-1 self-start"
          }
        />
        {onToggle === undefined ? null : (
          <SidebarItem
            icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            onClick={onToggle}
          />
        )}
        <SidebarItem
          icon={<LogOut />}
          label="Sign out"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate(undefined)}
        />
      </SidebarFooter>
    </>
  );
}

/** The sidebar, or below 761px a top bar and a drawer, around the signed-in owner's screens. */
export function Shell({ children }: { readonly children: ReactNode }) {
  useDisplayNames();
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [togglePalette] = useState(
    () => (open?: boolean) => setPalette((now) => open ?? !now),
  );
  usePaletteKeys(togglePalette);
  const toggle = () => {
    keepCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };
  return (
    <SidebarLayout>
      <SkipLink href="#main">Skip to content</SkipLink>
      <SidebarTopBar>
        <SidebarDrawer
          open={drawer}
          onOpenChange={setDrawer}
          title="Navigation"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open the navigation"
            >
              <Menu />
            </Button>
          }
        >
          <Navigation
            collapsed={false}
            onNavigate={() => setDrawer(false)}
            onSearch={() => {
              setDrawer(false);
              setPalette(true);
            }}
          />
        </SidebarDrawer>
        <SidebarBrand>Cota</SidebarBrand>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Search"
          aria-keyshortcuts="Meta+K Control+K /"
          className="ml-auto"
          onClick={() => setPalette(true)}
        >
          <Search />
        </Button>
      </SidebarTopBar>
      <Sidebar collapsed={collapsed}>
        <Navigation
          collapsed={collapsed}
          onToggle={toggle}
          onSearch={() => setPalette(true)}
        />
      </Sidebar>
      <SidebarMain id="main">{children}</SidebarMain>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </SidebarLayout>
  );
}
