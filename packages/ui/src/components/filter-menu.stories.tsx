import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, screen, waitFor } from "storybook/test";
import { FilterMenu, FilterMenuItem, FilterMenuNote } from "./filter-menu.tsx";
import { PoolMark } from "./pool-mark.tsx";

const pools = [
  { value: "personal", requests: 212, hue: 1 },
  { value: "work", requests: 87, hue: 2 },
  { value: "codex", requests: 9, hue: 3 },
  { value: "zai", requests: 4, hue: 5 },
] as const;

function Pools({ initial = [] }: { initial?: ReadonlyArray<string> }) {
  const [chosen, setChosen] = useState<ReadonlyArray<string>>(initial);
  return (
    <div className="flex items-center gap-2">
      <FilterMenu label="Pool" chosen={chosen} note="Counted in requests">
        {pools.map((pool) => (
          <FilterMenuItem
            key={pool.value}
            checked={chosen.includes(pool.value)}
            onCheckedChange={(on) =>
              setChosen(
                on
                  ? [...chosen, pool.value]
                  : chosen.filter((each) => each !== pool.value),
              )
            }
            mark={<PoolMark hue={pool.hue} name={pool.value} />}
            count={pool.requests}
            fraction={pool.requests / 212}
          >
            {pool.value}
          </FilterMenuItem>
        ))}
      </FilterMenu>
      <FilterMenu label="Client">
        <FilterMenuNote>None in range</FilterMenuNote>
      </FilterMenu>
    </div>
  );
}

const meta = {
  title: "Components/FilterMenu",
  component: Pools,
} satisfies Meta<typeof Pools>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingChosen: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Pool" })).toBeVisible();
  },
};

export const TwoChosen: Story = {
  args: { initial: ["work", "codex"] },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Pool work codex" }),
    ).toBeVisible();
  },
};

export const ThreeChosen: Story = {
  args: { initial: ["work", "codex", "zai"] },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Pool 3 chosen" }),
    ).toBeVisible();
  },
};

export const TickingValues: Story = {
  args: { initial: ["work"] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Pool work" }));
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: /personal/ }),
    );
    await expect(
      screen.getByRole("menuitemcheckbox", { name: /personal/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      screen.getByRole("group", { name: "Counted in requests" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await expect(
      canvas.getByRole("button", { name: "Pool work personal" }),
    ).toBeVisible();
  },
};

export const Open: Story = {
  args: { initial: ["work"] },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Pool/ }));
    const item = await screen.findByRole("menuitemcheckbox", { name: /codex/ });
    await waitFor(() => expect(item).toBeVisible());
  },
};

export const NoValues: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Client" }));
    const note = await screen.findByRole("menuitem", { name: "None in range" });
    await waitFor(() => expect(note).toBeVisible());
    await expect(note).toHaveAttribute("aria-disabled", "true");
  },
};
