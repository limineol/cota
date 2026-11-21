import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Input } from "./input.tsx";
import { Label } from "./label.tsx";

const meta = {
  title: "Components/Input",
  component: Input,
  decorators: [
    (Story) => (
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor="password">Owner password</Label>
        <Story />
      </div>
    ),
  ],
  args: {
    id: "password",
    type: "password",
    autoComplete: "current-password",
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText("Owner password");
    await userEvent.type(field, "correct horse");
    await expect(field).toHaveValue("correct horse");
  },
};

export const Filled: Story = { args: { defaultValue: "correct horse" } };

export const Placeholder: Story = {
  args: { type: "text", placeholder: "personal" },
};

export const Invalid: Story = {
  args: { defaultValue: "wrong horse", "aria-invalid": true },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "correct horse" },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Owner password")).toBeDisabled();
  },
};

export const ACode: Story = {
  args: {
    type: "text",
    code: true,
    autoComplete: "off",
    placeholder: "XXXX-XXXX-XXXX",
    defaultValue: "K7QM-2F9X-HD3P",
  },
};
