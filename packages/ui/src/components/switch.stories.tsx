import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";
import { SwitchField } from "./switch.tsx";

function Labelled({
  initial = true,
  disabled = false,
  count,
}: {
  initial?: boolean;
  disabled?: boolean;
  count?: string;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <SwitchField
      checked={checked}
      onCheckedChange={setChecked}
      disabled={disabled}
      {...(count === undefined ? {} : { count })}
    >
      Reasoning
    </SwitchField>
  );
}

const meta = {
  title: "Components/Switch",
  component: Labelled,
} satisfies Meta<typeof Labelled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole("switch", { name: "Reasoning" });
    await expect(toggle).toBeChecked();
    await userEvent.click(canvas.getByText("Reasoning"));
    await expect(toggle).not.toBeChecked();
  },
};

export const Off: Story = { args: { initial: false } };

export const WithACount: Story = { args: { count: "140" } };

export const Disabled: Story = { args: { disabled: true } };
