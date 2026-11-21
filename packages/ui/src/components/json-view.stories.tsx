import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { JsonView } from "./json-view.tsx";

const meta = {
  title: "Components/JSON view",
  component: JsonView,
} satisfies Meta<typeof JsonView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Params: Story = {
  args: {
    value: {
      max_tokens: 32000,
      stream: true,
      temperature: null,
      thinking: { type: "enabled", budget_tokens: 16000 },
      metadata: { user_id: "user_0193a4c2" },
      stop_sequences: [],
      betas: ["interleaved-thinking-2025-05-14", "context-1m-2025-08-07"],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('"max_tokens"')).toBeVisible();
    await expect(canvas.getByText("32000")).toBeVisible();
  },
};

const long =
  "The prompt is too long: 214,032 tokens > 200,000 maximum. ".repeat(12);

export const ALongString: Story = {
  args: { value: { type: "error", error: { message: long } } },
  play: async ({ canvas, userEvent }) => {
    const more = canvas.getByRole("button", { name: /more characters$/ });
    await userEvent.click(more);
    await expect(
      canvas.getByRole("button", { name: "show less" }),
    ).toBeVisible();
  },
};

export const Empty: Story = { args: { value: {} } };
