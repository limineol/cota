import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Mark } from "./mark.tsx";

const meta = {
  title: "Components/Mark",
  component: Mark,
} satisfies Meta<typeof Mark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sidebar: Story = {
  play: async ({ canvasElement }) => {
    const mark = canvasElement.querySelector("[data-slot=mark]");
    await expect(mark).toHaveAttribute("aria-hidden", "true");
    await expect(mark?.querySelectorAll("rect.fill-text")).toHaveLength(7);
  },
};

export const SignIn: Story = { args: { size: "lg" } };
