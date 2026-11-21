import type { Meta, StoryObj } from "@storybook/react-vite";
import { TriangleAlert } from "lucide-react";
import { expect } from "storybook/test";
import { Badge } from "./badge.tsx";
import { BlockMeter } from "./block-meter.tsx";
import {
  PoolFocus,
  PoolFocusBody,
  PoolFocusHead,
  PoolFocusLists,
  PoolFocusMeta,
  PoolFocusName,
  PoolFocusProblem,
  PoolFocusState,
  PoolFocusSubheading,
  PoolFocusTitle,
  PoolFocusUsage,
  PoolFocusWindows,
} from "./pool-focus.tsx";
import { PoolMark } from "./pool-mark.tsx";
import {
  Pace,
  QuotaWindow,
  QuotaWindowFoot,
  QuotaWindowHead,
  QuotaWindowLabel,
  QuotaWindowReset,
  QuotaWindowUsed,
} from "./quota-window.tsx";
import { RankItem, RankList } from "./rank-list.tsx";
import { Stat, StatLabel, StatMeta, StatUnit, StatValue } from "./stat.tsx";

const fillsOf = (used: number) =>
  Array.from({ length: 20 }, (_, index) =>
    Math.min(1, Math.max(0, used / 5 - index)),
  );

const meta = {
  title: "Components/PoolFocus",
  component: PoolFocus,
} satisfies Meta<typeof PoolFocus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnePool: Story = {
  render: () => (
    <PoolFocus aria-labelledby="focus-name">
      <PoolFocusHead>
        <PoolFocusTitle>
          <PoolMark hue={2} name="work" size="lg" />
          <PoolFocusName id="focus-name">work</PoolFocusName>
          <Badge>Pro</Badge>
          <PoolFocusMeta>Subscription · anthropic</PoolFocusMeta>
        </PoolFocusTitle>
        <PoolFocusState>
          <Badge variant="live">1 active session</Badge>
          <span>Updated 2m ago</span>
        </PoolFocusState>
      </PoolFocusHead>
      <PoolFocusProblem>
        <TriangleAlert aria-hidden="true" />
        The last quota reading failed: the provider did not answer.
      </PoolFocusProblem>
      <PoolFocusBody>
        <PoolFocusWindows aria-label="Quota windows">
          <QuotaWindow size="detail">
            <QuotaWindowHead>
              <QuotaWindowLabel>5-hour</QuotaWindowLabel>
              <QuotaWindowUsed>86% used</QuotaWindowUsed>
              <QuotaWindowReset>Resets in 1h 30m</QuotaWindowReset>
            </QuotaWindowHead>
            <BlockMeter
              blocks={fillsOf(86)}
              pace={0.7}
              severity="near"
              hue={2}
              size="detail"
              label="work, 5-hour window"
              valueText="86% used"
            />
            <QuotaWindowFoot>
              <Pace tone="danger">16% ahead of pace · empties in 51m</Pace>
              <span>Resets at 18:00</span>
            </QuotaWindowFoot>
          </QuotaWindow>
        </PoolFocusWindows>
        <PoolFocusUsage aria-label="Traffic">
          <Stat>
            <StatLabel>Today</StatLabel>
            <StatValue size="xl">
              9.4M<StatUnit>tokens</StatUnit>
            </StatValue>
            <StatMeta>
              <strong>$21.60</strong> · 312 requests
            </StatMeta>
          </Stat>
          <Stat>
            <StatLabel>Last 30 days</StatLabel>
            <StatValue size="xl">
              310M<StatUnit>tokens</StatUnit>
            </StatValue>
            <StatMeta>
              <strong>$690</strong> · 9,870 requests
            </StatMeta>
          </Stat>
        </PoolFocusUsage>
      </PoolFocusBody>
      <PoolFocusLists>
        <section aria-labelledby="top-projects">
          <PoolFocusSubheading id="top-projects">
            Top projects · last 30 days
          </PoolFocusSubheading>
          <RankList>
            <RankItem label="acme/shop" value="210M" fraction={1} hue={2} />
            <RankItem label="cota" value="80M" fraction={0.38} hue={2} />
          </RankList>
        </section>
        <section aria-labelledby="top-models">
          <PoolFocusSubheading id="top-models">
            Top models · last 30 days
          </PoolFocusSubheading>
          <RankList>
            <RankItem
              label="claude-opus-4-5"
              value="290M"
              fraction={1}
              hue={2}
            />
          </RankList>
        </section>
      </PoolFocusLists>
    </PoolFocus>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { level: 2, name: "work" }),
    ).toBeVisible();
  },
};
