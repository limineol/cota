import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Input } from "./input.tsx";
import { Label } from "./label.tsx";

const meta = {
  title: "Components/Label",
  component: Label,
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ForAField: Story = {
  render: () => (
    <div className="flex max-w-xs flex-col gap-1.5">
      <Label htmlFor="pool">Pool</Label>
      <Input id="pool" defaultValue="personal" />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Pool")).toHaveValue("personal");
  },
};
