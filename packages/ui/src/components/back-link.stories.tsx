import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BackLink } from "./back-link.tsx";

function ToSessions() {
  return <BackLink render={<a href="/sessions?q=relay" />}>Sessions</BackLink>;
}

const meta = {
  title: "Components/BackLink",
  component: ToSessions,
} satisfies Meta<typeof ToSessions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToTheList: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Sessions" }),
    ).toHaveAttribute("href", "/sessions?q=relay");
  },
};
