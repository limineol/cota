import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { FieldNote } from "./field-note.tsx";
import { Input } from "./input.tsx";

const meta = {
  title: "Components/FieldNote",
  component: FieldNote,
} satisfies Meta<typeof FieldNote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WhatHappened: Story = {
  render: () => (
    <div className="max-w-80">
      <Input aria-label="Display name" defaultValue="tower" />
      <FieldNote>That is its id, so your name is removed.</FieldNote>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "That is its id, so your name is removed.",
    );
  },
};

export const Refused: Story = {
  render: () => (
    <div className="max-w-80">
      <Input
        aria-label="Display name"
        aria-invalid
        defaultValue="A name that runs on well past the eighty characters the hub keeps for one"
      />
      <FieldNote tone="danger">
        A display name is at most 80 characters; this one is 81.
      </FieldNote>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(/at most 80/);
  },
};
