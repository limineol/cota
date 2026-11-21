import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { CopyButton } from "./copy-button.tsx";

const meta = {
  title: "Components/CopyButton",
  component: CopyButton,
  args: {
    value: () => "pool\trequests\nwork\t412\n",
    label: "Copy the answer as TSV",
    copied: "The answer is copied as TSV.",
  },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithWords: Story = {
  args: { children: "Copy as TSV" },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Copy as TSV" }),
    ).toBeVisible();
  },
};

export const AnIcon: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Copy the answer as TSV" }),
    ).toBeVisible();
  },
};
