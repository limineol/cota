import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Badge } from "./badge.tsx";
import {
  ReportedThrough,
  ReportedThroughLine,
  ReportedThroughName,
  ReportedThroughTitle,
  ReportedThroughWhen,
} from "./reported-through.tsx";

const meta = {
  title: "Components/ReportedThrough",
  component: ReportedThrough,
} satisfies Meta<typeof ReportedThrough>;

export default meta;
type Story = StoryObj<typeof meta>;

const lines = (
  <>
    <ReportedThroughTitle>Reported through</ReportedThroughTitle>
    <ReportedThroughLine>
      <ReportedThroughName>Studio · Antigravity</ReportedThroughName>
      <ReportedThroughWhen>1m ago</ReportedThroughWhen>
    </ReportedThroughLine>
    <ReportedThroughLine>
      <ReportedThroughName>Laptop · Antigravity</ReportedThroughName>
      <Badge>Late</Badge>
      <ReportedThroughWhen>3h ago</ReportedThroughWhen>
    </ReportedThroughLine>
  </>
);

export const OnACard: Story = {
  render: () => (
    <div className="w-80">
      <ReportedThrough>{lines}</ReportedThrough>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Late")).toBeVisible();
  },
};

export const InFull: Story = {
  render: () => (
    <div className="w-lg">
      <ReportedThrough size="detail">{lines}</ReportedThrough>
    </div>
  ),
};
