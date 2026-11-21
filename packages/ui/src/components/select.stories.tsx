import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, screen, waitFor } from "storybook/test";
import { Input } from "./input.tsx";
import { PoolMark } from "./pool-mark.tsx";
import { Select } from "./select.tsx";

const sorts = [
  { value: "recent", label: "Most recent" },
  { value: "tokens", label: "Most tokens" },
  { value: "cost", label: "Highest cost" },
  { value: "requests", label: "Most requests" },
] as const;

type Sort = (typeof sorts)[number]["value"];

function Sorting() {
  const [sort, setSort] = useState<Sort>("recent");
  return (
    <div className="flex items-center gap-3">
      <Select
        label="Sort the sessions"
        value={sort}
        options={sorts}
        onValueChange={setSort}
      />
      <span className="text-sm text-text-3">Sorted by {sort}</span>
    </div>
  );
}

const meta = {
  title: "Components/Select",
  component: Sorting,
} satisfies Meta<typeof Sorting>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", { name: "Sort the sessions" });
    await expect(trigger).toHaveTextContent("Most recent");
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByRole("option", { name: "Most tokens" }),
    );
    await waitFor(() => expect(trigger).toHaveTextContent("Most tokens"));
    await expect(canvas.getByText("Sorted by tokens")).toBeVisible();
    // Base UI keeps the popup's focus guards (aria-hidden, yet tabbable) until its closing transition ends; axe runs once the story does, so the story waits.
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  },
};

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Sort the sessions" }),
    );
    const option = await screen.findByRole("option", { name: "Highest cost" });
    await waitFor(() => expect(option).toBeVisible());
  },
};

const pools = [
  { value: "work", label: "Work plan", hue: 1 },
  { value: "personal", label: "Personal", hue: 2 },
] as const;

function PoolField({
  initial,
  invalid = false,
}: {
  initial: string | null;
  invalid?: boolean;
}) {
  const [pool, setPool] = useState<string | null>(initial);
  return (
    <div className="flex w-72 items-center gap-2">
      <Input aria-label="Project pattern" defaultValue="acme/*" />
      <Select
        label="Pool of route 1"
        size="field"
        value={pool}
        placeholder="Choose a pool"
        invalid={invalid}
        className="w-44"
        options={[
          { value: null, label: "None" },
          ...pools.map((each) => ({
            value: each.value,
            label: each.label,
            mark: <PoolMark hue={each.hue} name={each.label} />,
          })),
        ]}
        onValueChange={setPool}
      />
    </div>
  );
}

/** As tall and edged as the field beside it, each option with its pool's mark. */
export const AField: Story = {
  render: () => <PoolField initial="work" />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", { name: "Pool of route 1" });
    await expect(trigger).toHaveTextContent("Work plan");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "None" }));
    await waitFor(() => expect(trigger).toHaveTextContent("None"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  },
};

export const AFieldWithNothingChosen: Story = {
  render: () => <PoolField initial="nowhere" />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("combobox", { name: "Pool of route 1" }),
    ).toHaveTextContent("Choose a pool");
  },
};

export const AFieldRefused: Story = {
  render: () => <PoolField initial="work" invalid />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("combobox", { name: "Pool of route 1" }),
    ).toHaveAttribute("aria-invalid", "true");
  },
};
