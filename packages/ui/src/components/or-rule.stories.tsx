import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeyRound } from "lucide-react";
import { expect } from "storybook/test";
import { Button } from "./button.tsx";
import { OrRule } from "./or-rule.tsx";

const meta = {
  title: "Components/OrRule",
  component: OrRule,
} satisfies Meta<typeof OrRule>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BetweenTwoWays: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <Button>Sign in</Button>
      <OrRule />
      <Button variant="outline">
        <KeyRound data-icon="inline-start" />
        Sign in with a passkey
      </Button>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("or")).toBeVisible();
  },
};
