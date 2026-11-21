import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  LayoutGrid,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { Button } from "./button.tsx";
import { Page, PageTitle } from "./page.tsx";
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
} from "./sidebar.tsx";

function Navigation({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: () => void;
}) {
  return (
    <>
      <SidebarBrand>Cota</SidebarBrand>
      <SidebarItem
        icon={<Search />}
        label="Search"
        shortcut="⌘K"
        aria-keyshortcuts="Meta+K"
        className="mt-3"
      />
      <SidebarNav aria-label="Primary">
        <SidebarItem
          render={<a href="#overview" aria-current="page" />}
          icon={<LayoutGrid />}
          label="Overview"
        />
      </SidebarNav>
      <SidebarFooter>
        {onToggle === undefined ? null : (
          <SidebarItem
            icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            onClick={onToggle}
          />
        )}
        <SidebarItem icon={<LogOut />} label="Sign out" />
      </SidebarFooter>
    </>
  );
}

function Shell({ initiallyCollapsed }: { initiallyCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [drawer, setDrawer] = useState(false);
  return (
    <SidebarLayout>
      <SkipLink href="#main">Skip to content</SkipLink>
      <SidebarTopBar>
        <SidebarDrawer
          open={drawer}
          onOpenChange={setDrawer}
          title="Navigation"
          trigger={
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu />
            </Button>
          }
        >
          <Navigation collapsed={false} />
        </SidebarDrawer>
        <SidebarBrand>Cota</SidebarBrand>
      </SidebarTopBar>
      <Sidebar collapsed={collapsed}>
        <Navigation
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
        />
      </Sidebar>
      <SidebarMain id="main">
        <Page>
          <PageTitle>Overview</PageTitle>
        </Page>
      </SidebarMain>
    </SidebarLayout>
  );
}

const meta = {
  title: "Components/Sidebar",
  component: Shell,
  tags: ["page"],
  args: { initiallyCollapsed: false },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Primary" });
    await expect(
      within(nav).getByRole("link", { name: "Overview" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      canvas.getByText("Overview", { selector: "a span" }),
    ).toBeVisible();
  },
};

export const Collapsed: Story = {
  args: { initiallyCollapsed: true },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.hover(canvas.getByRole("link", { name: "Overview" }));
    const tip = await within(canvasElement.ownerDocument.body).findByText(
      "Overview",
      { selector: "[data-slot=tooltip-content]" },
    );
    await waitFor(() => expect(tip).toBeVisible());
  },
};

export const Expanding: Story = {
  args: { initiallyCollapsed: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Expand the sidebar" }),
    );
    await expect(
      canvas.getByRole("button", { name: "Collapse the sidebar" }),
    ).toBeVisible();
  },
};

export const SkipToContent: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const skip = canvas.getByRole("link", { name: "Skip to content" });
    await expect(skip).toHaveFocus();
    await expect(skip).toBeVisible();
  },
};

export const Drawer: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(canvas.queryByRole("complementary")).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Open navigation" }),
    );
    const drawer = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog",
      { name: "Navigation" },
    );
    await waitFor(() =>
      expect(
        within(drawer).getByRole("link", { name: "Overview" }),
      ).toBeVisible(),
    );
  },
};
