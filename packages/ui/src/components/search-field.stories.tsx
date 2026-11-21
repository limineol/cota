import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";
import { SearchField } from "./search-field.tsx";
import { Segmented } from "./segmented.tsx";

const matches = [
  { value: "exact", label: "Exact" },
  { value: "loose", label: "Loose" },
] as const;

function Searching({
  initial = "",
  withEnd = false,
}: {
  initial?: string;
  withEnd?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [match, setMatch] = useState<"exact" | "loose">("exact");
  const [searched, setSearched] = useState<string | null>(null);
  return (
    <div className="flex max-w-md flex-col gap-3">
      <SearchField
        aria-label="Search the sessions"
        placeholder="Search prompts, replies and tool output"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onSubmit={() => setSearched(value)}
        end={
          withEnd ? (
            <Segmented
              label="How the search matches words"
              size="xs"
              value={match}
              options={matches}
              onValueChange={setMatch}
            />
          ) : undefined
        }
      />
      <p className="text-sm text-text-3">
        {searched === null ? "Not searched yet" : `Searched for “${searched}”`}
      </p>
    </div>
  );
}

const meta = {
  title: "Components/SearchField",
  component: Searching,
} satisfies Meta<typeof Searching>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("search")).toBeVisible();
    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Search the sessions" }),
      "relay hang{Enter}",
    );
    await expect(canvas.getByText("Searched for “relay hang”")).toBeVisible();
  },
};

export const Filled: Story = { args: { initial: "relay hang" } };

export const WithHowItMatches: Story = {
  args: { initial: "relay hang", withEnd: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("radio", { name: "Loose" }));
    await expect(canvas.getByRole("radio", { name: "Loose" })).toBeChecked();
  },
};
