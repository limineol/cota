import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";
import { Chip, Chips, ChipsClear } from "./chip.tsx";
import { PoolMark } from "./pool-mark.tsx";

const chosen = [
  { dimension: "Pool", value: "work", hue: 2 },
  { dimension: "Pool", value: "personal", hue: 1 },
  { dimension: "Project", value: "acme/shop" },
  { dimension: "Model", value: "Claude Opus 4.5" },
] as const;

function Chosen() {
  const [left, setLeft] =
    useState<ReadonlyArray<(typeof chosen)[number]>>(chosen);
  if (left.length === 0) return <p className="text-text-3">No filters.</p>;
  return (
    <Chips aria-label="Filters chosen">
      {left.map((each) => (
        <Chip
          key={`${each.dimension}:${each.value}`}
          dimension={each.dimension}
          onClick={() => setLeft(left.filter((other) => other !== each))}
        >
          {"hue" in each ? <PoolMark hue={each.hue} name={each.value} /> : null}
          <span className="truncate">{each.value}</span>
        </Chip>
      ))}
      <ChipsClear onClick={() => setLeft([])}>Clear</ChipsClear>
    </Chips>
  );
}

const meta = {
  title: "Components/Chip",
  component: Chosen,
} satisfies Meta<typeof Chosen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filters: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove the filter Pool · work" }),
    );
    await expect(
      canvas.queryByRole("button", { name: "Remove the filter Pool · work" }),
    ).toBeNull();
    await expect(canvas.getAllByRole("button")).toHaveLength(4);
    await userEvent.click(canvas.getByRole("button", { name: "Clear" }));
    await expect(canvas.getByText("No filters.")).toBeVisible();
  },
};

export const ALongValue: Story = {
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <Chips>
      <Chip dimension="Project">
        <span className="truncate">
          acme/a-repository-whose-name-runs-past-the-chip
        </span>
      </Chip>
    </Chips>
  ),
};
