import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";
import { Checkbox } from "./checkbox.tsx";

function Labelled({
  initial = false,
  disabled = false,
}: {
  initial?: boolean;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={setChecked}
        disabled={disabled}
      />
      Only sessions with errors
    </label>
  );
}

const meta = {
  title: "Components/Checkbox",
  component: Labelled,
} satisfies Meta<typeof Labelled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unticked: Story = {
  play: async ({ canvas, userEvent }) => {
    const box = canvas.getByRole("checkbox", {
      name: "Only sessions with errors",
    });
    await expect(box).not.toBeChecked();
    await userEvent.click(canvas.getByText("Only sessions with errors"));
    await expect(box).toBeChecked();
    await userEvent.keyboard(" ");
    await expect(box).not.toBeChecked();
  },
};

export const Ticked: Story = { args: { initial: true } };

export const Disabled: Story = { args: { initial: true, disabled: true } };
