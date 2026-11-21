import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { never } from "#stories/fake-api.ts";
import { displayNames } from "#stories/fixtures.ts";
import { withApi } from "#stories/page.tsx";
import { Name } from "./names.tsx";

const meta = {
  title: "Shared/Name",
  component: Name,
  decorators: [withApi([displayNames])],
} satisfies Meta<typeof Name>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OwnersName: Story = {
  args: { kind: "pool", value: "personal" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Personal plan")).toHaveAttribute(
      "title",
      "personal",
    );
  },
};

export const BuiltInName: Story = {
  args: { kind: "model", value: "claude-opus-4-5" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Claude Opus 4.5")).toHaveAttribute(
      "title",
      "claude-opus-4-5",
    );
  },
};

export const NoName: Story = {
  args: { kind: "project", value: "limineol/cota" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("limineol/cota")).toHaveAttribute(
      "title",
      "limineol/cota",
    );
  },
};

export const SameKeyOfAnotherKind: Story = {
  args: { kind: "pool", value: "tower" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("tower")).toBeVisible();
  },
};

export const WhileTheNamesAreRead: Story = {
  args: { kind: "pool", value: "personal" },
  decorators: [withApi([never("display-names", "list")])],
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("personal")).toBeVisible();
  },
};
