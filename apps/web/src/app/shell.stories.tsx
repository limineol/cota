import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { never, noContent, problem, unreachable } from "#stories/fake-api.ts";
import { displayNames, owner, passwordOnly } from "#stories/fixtures.ts";
import { page } from "#stories/page.tsx";

const meta = { title: "App/Shell" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const signedIn = [owner, displayNames];

const forgetTheSidebar = () => {
  localStorage.removeItem("cota-sidebar");
};

export const Expanded: Story = {
  ...page("/", signedIn),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas }) => {
    const nav = await canvas.findByRole("navigation", { name: "Primary" });
    const overview = within(nav).getByRole("link", { name: "Overview" });
    await expect(overview).toHaveAttribute("aria-current", "page");
    await expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Overview", "Sessions", "Errors", "SQL", "Settings"]);
    await expect(
      within(nav).getByRole("link", { name: "Sessions" }),
    ).not.toHaveAttribute("aria-current");
    await expect(
      canvas.getByRole("radiogroup", { name: "Theme" }),
    ).toBeVisible();
    await expect(canvas.getByRole("main")).toHaveAttribute("tabindex", "-1");
  },
};

export const Collapsed: Story = {
  ...page("/", signedIn),
  beforeEach: () => {
    localStorage.setItem("cota-sidebar", "collapsed");
    return forgetTheSidebar;
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Expand the sidebar" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Overview", { selector: "a span" }),
    ).toHaveClass("sr-only");
  },
};

export const CollapsingIsRemembered: Story = {
  ...page("/", signedIn),
  beforeEach: () => forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Collapse the sidebar" }),
    );
    await expect(localStorage.getItem("cota-sidebar")).toBe("collapsed");
  },
};

export const Drawer: Story = {
  ...page("/", signedIn),
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Open the navigation" }),
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

export const ReadingWhoIsSignedIn: Story = {
  ...page("/", [never("sign-in", "me")]),
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(canvasElement).toBeEmptyDOMElement();
  },
};

export const HubDidNotAnswer: Story = {
  ...page("/", [unreachable("sign-in", "me")]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "The hub did not answer.",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeEnabled();
  },
};

export const SignInEnds: Story = {
  ...page("/", [
    owner,
    passwordOnly,
    problem("display-names", "list", {
      type: "urn:cota:sign-in-required",
      status: 401,
    }),
  ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText("Owner password")).toBeVisible();
    await expect(canvas.queryByRole("navigation")).toBeNull();
  },
};

export const SigningOut: Story = {
  ...page("/", [...signedIn, passwordOnly, noContent("sign-in", "signOut")]),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sign out" }),
    );
    await expect(await canvas.findByLabelText("Owner password")).toBeVisible();
  },
};
