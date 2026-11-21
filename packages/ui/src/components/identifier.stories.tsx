import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Identifier } from "./identifier.tsx";

const meta = {
  title: "Components/Identifier",
  component: Identifier,
  args: {
    value: "0193a4c2-0001-7000-8000-5e5510000000",
    label: "session id",
  },
} satisfies Meta<typeof Identifier>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SessionId: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Copy the session id" }),
    ).toBeVisible();
  },
};

export const ALongIdInANarrowPlace: Story = {
  args: {
    value:
      "request:0193a4c2-7d1e-7b3a-9c4e-000000000004-and-a-client-that-names-its-sessions-at-length",
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};
