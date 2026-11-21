import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Note } from "./note.tsx";

const meta = {
  title: "Components/Note",
  component: Note,
} satisfies Meta<typeof Note>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithALink: Story = {
  render: () => (
    <Note>
      Diverted from <a href="#personal">personal</a> after the provider refused
      it; it was sent again after <a href="#refused">the refused request</a>.
    </Note>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "the refused request" }),
    ).toBeVisible();
  },
};
