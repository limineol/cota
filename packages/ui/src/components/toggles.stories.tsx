import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { Toggles } from "./toggles.tsx";

type Shown = "reasoning" | "tools" | "context";

const options = [
  { value: "reasoning", label: "Reasoning", count: "3" },
  { value: "tools", label: "Tool calls", count: "54" },
  { value: "context", label: "Context", count: "4" },
] as const;

function Shows({ initial }: { initial: ReadonlyArray<Shown> }) {
  const [pressed, setPressed] = useState<ReadonlyArray<Shown>>(initial);
  return (
    <div className="flex flex-col items-start gap-3">
      <Toggles
        label="What the transcript shows"
        pressed={pressed}
        options={options}
        onPressedChange={(value, on) =>
          setPressed(
            on ? [...pressed, value] : pressed.filter((each) => each !== value),
          )
        }
      />
      <p className="text-sm text-text-3">
        {pressed.length === 0
          ? "Nothing shown"
          : `Shown: ${pressed.join(", ")}`}
      </p>
    </div>
  );
}

const meta = {
  title: "Components/Toggles",
  component: Shows,
} satisfies Meta<typeof Shows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllPressed: Story = {
  args: { initial: ["reasoning", "tools", "context"] },
  play: async ({ canvas, userEvent }) => {
    const group = canvas.getByRole("group", {
      name: "What the transcript shows",
    });
    const tools = within(group).getByRole("button", { name: /^Tool calls/ });
    await expect(tools).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(tools);
    await expect(tools).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByText("Shown: reasoning, context")).toBeVisible();
  },
};

export const SomePressed: Story = { args: { initial: ["tools"] } };
