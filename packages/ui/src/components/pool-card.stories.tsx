import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { Hue } from "#lib/hue.ts";
import { Badge } from "./badge.tsx";
import { BlockMeter } from "./block-meter.tsx";
import {
  PoolCard,
  PoolCardFigure,
  PoolCardFoot,
  PoolCardHead,
  PoolCardName,
  PoolCardNote,
  PoolCardState,
  PoolCards,
  PoolCardWindows,
} from "./pool-card.tsx";
import { PoolMark } from "./pool-mark.tsx";
import {
  QuotaWindow,
  QuotaWindowHead,
  QuotaWindowLabel,
  QuotaWindowReset,
  QuotaWindowUsed,
} from "./quota-window.tsx";

const fillsOf = (used: number) =>
  Array.from({ length: 20 }, (_, index) =>
    Math.min(1, Math.max(0, used / 5 - index)),
  );

interface Sample {
  readonly id: string;
  readonly hue: Hue;
  readonly badge: string;
  readonly live: string | null;
  readonly state: string;
  readonly windows: ReadonlyArray<{
    readonly label: string;
    readonly used: number;
    readonly pace: number;
    readonly reset: string;
  }>;
  readonly none?: string;
  readonly today: readonly [string, string];
  readonly month: readonly [string, string];
  readonly allTime: readonly [string, string];
}

const samples: ReadonlyArray<Sample> = [
  {
    id: "personal",
    hue: 1,
    badge: "Max 20x",
    live: "2 active sessions",
    state: "",
    windows: [
      { label: "5-hour", used: 41, pace: 0.55, reset: "2h 14m" },
      { label: "Weekly", used: 12, pace: 0.49, reset: "3d 14h" },
      { label: "Weekly · Opus", used: 3, pace: 0.49, reset: "3d 14h" },
    ],
    today: ["38.2M", "$84.10"],
    month: ["1.1B", "$2,410"],
    allTime: ["4.8B", "$10,920"],
  },
  {
    id: "work",
    hue: 2,
    badge: "Pro",
    live: null,
    state: "Last request 14m ago",
    windows: [
      { label: "5-hour", used: 86, pace: 0.7, reset: "1h 30m" },
      { label: "Weekly", used: 100, pace: 0.8, reset: "1d 4h" },
    ],
    today: ["9.4M", "$21.60"],
    month: ["310M", "$690"],
    allTime: ["1.2B", "≥$2,705"],
  },
  {
    id: "local",
    hue: 3,
    badge: "Keyed",
    live: null,
    state: "No requests since Nov 2",
    windows: [],
    none: "No quota windows",
    today: ["0", "$0"],
    month: ["0", "$0"],
    allTime: ["2.1M", "no price"],
  },
];

const severityOf = (used: number) =>
  used >= 100 ? "full" : used >= 80 ? "near" : "normal";

const cards = (layout: "grid" | "list", allTime = false) => (
  <PoolCards layout={layout} aria-label="Pools">
    {samples.map((sample) => (
      <PoolCard
        key={sample.id}
        href={`#${sample.id}`}
        idle={sample.windows.length === 0}
      >
        <PoolCardHead>
          <PoolMark hue={sample.hue} name={sample.id} size="md" />
          <PoolCardName>{sample.id}</PoolCardName>
          <Badge>{sample.badge}</Badge>
          <PoolCardState>
            {sample.live === null ? (
              sample.state
            ) : (
              <Badge variant="live">{sample.live}</Badge>
            )}
          </PoolCardState>
        </PoolCardHead>
        <PoolCardWindows>
          {sample.windows.map((window) => (
            <QuotaWindow key={window.label}>
              <QuotaWindowHead>
                <QuotaWindowLabel>{window.label}</QuotaWindowLabel>
                <QuotaWindowUsed>{window.used}% used</QuotaWindowUsed>
                <QuotaWindowReset>Resets in {window.reset}</QuotaWindowReset>
              </QuotaWindowHead>
              <BlockMeter
                blocks={fillsOf(window.used)}
                pace={window.pace}
                severity={severityOf(window.used)}
                hue={sample.hue}
                label={`${sample.id}, ${window.label} window`}
                valueText={`${window.used}% used`}
              />
            </QuotaWindow>
          ))}
          {sample.none === undefined ? null : (
            <PoolCardNote>{sample.none}</PoolCardNote>
          )}
        </PoolCardWindows>
        <PoolCardFoot>
          <PoolCardFigure label="Today">
            <strong>{sample.today[0]}</strong> {sample.today[1]}
          </PoolCardFigure>
          <PoolCardFigure label="Last 30 days">
            <strong>{sample.month[0]}</strong> {sample.month[1]}
          </PoolCardFigure>
          {allTime ? (
            <PoolCardFigure label="All time">
              <strong>{sample.allTime[0]}</strong> {sample.allTime[1]}
            </PoolCardFigure>
          ) : null}
        </PoolCardFoot>
      </PoolCard>
    ))}
  </PoolCards>
);

const meta = {
  title: "Components/PoolCard",
  component: PoolCards,
  args: { layout: "grid" },
} satisfies Meta<typeof PoolCards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grid: Story = {
  render: () => cards("grid"),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    await expect(canvas.getByRole("link", { name: /^work/ })).toHaveAttribute(
      "href",
      "#work",
    );
  },
};

export const List: Story = {
  render: () => cards("list"),
};

export const NarrowList: Story = {
  render: () => <div className="max-w-xl">{cards("list")}</div>,
};

export const ThreeFigures: Story = {
  render: () => cards("grid", true),
};

export const ThreeFiguresList: Story = {
  render: () => cards("list", true),
};
