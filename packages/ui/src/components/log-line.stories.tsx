import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { LogLine, LogLineMark, LogLinePrefix } from "./log-line.tsx";

const meta = {
  title: "Components/LogLine",
  component: LogLine,
} satisfies Meta<typeof LogLine>;

export default meta;
type Story = StoryObj<typeof meta>;

const line = (
  <>
    <LogLinePrefix>[09:14:02.318] INFO (#1):</LogLinePrefix> this hub is not set
    up: open its dashboard, give it the setup code{" "}
    <LogLineMark>XXXX-XXXX-XXXX</LogLineMark> and choose the owner password
  </>
);

export const AsPrinted: Story = {
  args: { children: line },
  render: (args) => (
    <LogLine
      {...args}
      className="max-w-lg"
      caption="The terminal that runs the hub shows its log, or its container's log does."
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("XXXX-XXXX-XXXX")).toBeVisible();
  },
};

export const Refused: Story = {
  args: { children: line, refused: true },
  render: (args) => <LogLine {...args} className="max-w-lg" />,
};
