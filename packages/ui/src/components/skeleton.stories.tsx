import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Skeleton } from "./skeleton.tsx";

const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ALine: Story = {
  args: { className: "w-80" },
  play: async ({ canvasElement }) => {
    const held = canvasElement.querySelector("[data-slot=skeleton]");
    await expect(held).toHaveAttribute("aria-hidden", "true");
  },
};

export const AFigure: Story = {
  render: () => (
    <div className="flex w-44 flex-col gap-2">
      <Skeleton className="w-20" />
      <Skeleton className="h-6 w-28" />
      <Skeleton className="w-full" />
    </div>
  ),
};
