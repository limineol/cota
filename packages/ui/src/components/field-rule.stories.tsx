import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";
import { FieldRule } from "./field-rule.tsx";
import { Input } from "./input.tsx";
import { Label } from "./label.tsx";

const meta = {
  title: "Components/FieldRule",
  component: FieldRule,
} satisfies Meta<typeof FieldRule>;

export default meta;
type Story = StoryObj<typeof meta>;

function Password({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex max-w-80 flex-col gap-1.5">
      <Label htmlFor="new-password">New password</Label>
      <Input
        id="new-password"
        type="password"
        value={value}
        aria-describedby="new-password-rule"
        onChange={(event) => setValue(event.target.value)}
      />
      <FieldRule id="new-password-rule" met={[...value].length >= 12}>
        12 characters or more
      </FieldRule>
    </div>
  );
}

export const NotMetYet: Story = {
  args: { met: false },
  render: () => <Password initial="" />,
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText("New password");
    await expect(field).toHaveAccessibleDescription(
      /^12 characters or more\s?: not met yet$/,
    );
    await userEvent.type(field, "correct horse battery");
    await expect(field).toHaveAccessibleDescription(
      /^12 characters or more\s?: met$/,
    );
  },
};

export const Met: Story = {
  args: { met: true },
  render: () => <Password initial="correct horse battery" />,
};

export const Refused: Story = {
  args: { met: false },
  render: () => (
    <div className="flex max-w-80 flex-col gap-1.5">
      <Label htmlFor="short">New password</Label>
      <Input id="short" type="password" aria-invalid defaultValue="horse" />
      <FieldRule met={false} refused>
        12 characters or more: this one is 5, so it was not sent.
      </FieldRule>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      /this one is 5, so it was not sent/,
    );
  },
};
