import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import {
  type ContextColumn,
  ContextColumns,
  ContextKey,
  type ContextLayout,
} from "./context-columns.tsx";
import { Legend } from "./legend.tsx";

interface Shape {
  readonly segments: ReadonlyArray<number>;
  readonly opens?: string;
  readonly fit?: boolean;
}

/** Columns that climb through each segment and drop at the next, with errors and other requests here and there. */
const layoutOf = ({
  segments,
  opens = "new segment",
}: Shape): ContextLayout => ({
  columns: segments.flatMap((length, segment) =>
    Array.from({ length }, (_, at): ContextColumn => {
      const blocks = Math.min(
        14,
        1 + Math.floor((at * 13) / Math.max(1, length - 1)),
      );
      return {
        key: `${segment}-${at}`,
        blocks: at % 17 === 9 ? 0 : blocks,
        others: (at * 7 + segment) % 5 === 0 ? (at % 4) + 1 : 0,
        danger: at % 17 === 9 || at % 23 === 4,
        opens: segment > 0 && at === 0 ? opens : null,
        readout: (
          <>
            <strong>14:{String(10 + at).padStart(2, "0")}</strong>
            <span>{at % 3 === 0 ? 2 : 1} main requests</span>
            <span>largest prompt {blocks * 20}K</span>
          </>
        ),
      };
    }),
  ),
});

const fixed =
  (layout: ContextLayout): ((capacity: number) => ContextLayout) =>
  () =>
    layout;

const meta = {
  title: "Components/ContextColumns",
  component: ContextColumns,
  args: {
    fit: fixed(layoutOf({ segments: [48, 40, 22] })),
    hue: 2,
    label:
      "212 requests over 3h 9m in 3 segments; the prompt peaked at 182K tokens",
    start: "11:02",
    end: "14:11",
    onActivate: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-4xl rounded-card border bg-surface p-4">
        <Story />
        <Legend>
          <ContextKey mark="column" hue={2}>
            Main requests
          </ContextKey>
          <ContextKey mark="other">Other requests</ContextKey>
          <ContextKey mark="error">An error</ContextKey>
          <ContextKey mark="segment">A new segment</ContextKey>
        </Legend>
      </div>
    ),
  ],
} satisfies Meta<typeof ContextColumns>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeSegments: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const chart = canvas.getByRole("group", {
      name: /^212 requests over 3h 9m in 3 segments/,
    });
    chart.focus();
    await userEvent.keyboard("{Home}");
    await expect(await canvas.findByText("14:10")).toBeVisible();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    await expect(args.onActivate).toHaveBeenLastCalledWith("0-1");
  },
};

export const Compacted: Story = {
  args: { fit: fixed(layoutOf({ segments: [30, 30], opens: "compacted" })) },
};

export const TwoRequests: Story = {
  args: {
    fit: fixed(layoutOf({ segments: [2] })),
    label: "2 requests over 1m in 1 segment; the prompt peaked at 40K tokens",
    start: "09:14",
    end: "09:15",
  },
};

export const SeveralPools: Story = { args: { hue: "neutral" } };

export const WiderThanItsPlace: Story = {
  args: {
    fit: fixed(layoutOf({ segments: Array.from({ length: 90 }, () => 1) })),
  },
};
