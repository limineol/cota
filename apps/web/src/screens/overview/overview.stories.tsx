import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import {
  atTheLimit,
  eightPools,
  emptyLog,
  failed,
  historyFailed,
  historyLoading,
  loading,
  overviewOfPools,
  poolsToOrder,
  reportedThrough,
  threePools,
  withAnObservedPool,
  withHistory,
} from "#stories/overview.ts";
import { locationShown, page } from "#stories/page.tsx";

const meta = { title: "Screens/Overview" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const layoutKey = "cota-pool-layout";

/** Content dimmed while a newer answer is on its way is inactive, which WCAG 1.4.3 exempts from contrast. */
const staleContrast = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", selector: ":not([data-stale] *)" }],
    },
  },
};

export const AllPoolsGrid: Story = {
  ...page("/", overviewOfPools(eightPools)),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Pools" }),
    ).toBeVisible();
    const cards = await canvas.findByRole("list", { name: "Pools" });
    await expect(await within(cards).findAllByRole("listitem")).toHaveLength(8);
    const projects = await canvas.findByRole("region", { name: "Projects" });
    await expect(projects).toBeVisible();
    await expect(
      await canvas.findByRole("link", { name: /^Errors .+/ }),
    ).toHaveAttribute("href", "/errors?range=24h");
    await expect(
      canvas.getByRole("link", { name: /^Sessions .+/ }),
    ).toHaveAttribute("href", "/sessions?range=24h");
    const [project] = await within(projects).findAllByRole("link");
    await expect(project).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/sessions\?range=24h&project=/),
    );
  },
};

export const AllPoolsList: Story = {
  ...page("/", overviewOfPools(eightPools)),
  beforeEach: () => {
    localStorage.setItem(layoutKey, "list");
    return () => localStorage.removeItem(layoutKey);
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("radio", { name: "List" }),
    ).toBeChecked();
  },
};

const cardNames = (canvas: HTMLElement) =>
  Array.from(
    within(canvas)
      .getByRole("list", { name: "Pools" })
      .querySelectorAll('[data-slot="pool-card-name"]'),
    (name) => name.textContent,
  );

/** Each pool's hue, read from its mark in the cards and in the switcher, which keeps the configuration's order. */
const huesOf = (canvas: HTMLElement) => {
  const colourOf = (link: Element) => {
    const mark = link.querySelector('[data-slot="pool-mark"]');
    return mark === null ? null : getComputedStyle(mark).color;
  };
  const cards = within(canvas)
    .getByRole("list", { name: "Pools" })
    .querySelectorAll('[data-slot="pool-card"]');
  const switcher = within(canvas).getByRole("navigation", { name: "Pool" });
  return {
    cards: Object.fromEntries(
      Array.from(cards, (card) => [
        card.querySelector('[data-slot="pool-card-name"]')?.textContent,
        colourOf(card),
      ]),
    ),
    switcher: Object.fromEntries(
      within(switcher)
        .getAllByRole("link")
        .slice(1)
        .map((link) => [
          link.querySelector("span[title]")?.textContent,
          colourOf(link),
        ]),
    ),
  };
};

export const OrderedByUsage: Story = {
  ...page("/", poolsToOrder),
  play: async ({ canvasElement, canvas }) => {
    await expect(
      await canvas.findByRole("radio", { name: "Usage" }),
    ).toBeChecked();
    await waitFor(() =>
      expect(cardNames(canvasElement)).toEqual([
        "Personal plan",
        "GLM plan",
        "work",
        "codex",
        "acme/shop",
        "local",
      ]),
    );
    const hues = huesOf(canvasElement);
    await expect(hues.cards).toEqual(hues.switcher);
  },
};

export const OrderedByName: Story = {
  ...page("/", poolsToOrder),
  play: async ({ canvasElement, canvas, userEvent }) => {
    await waitFor(() =>
      expect(cardNames(canvasElement)[0]).toBe("Personal plan"),
    );
    await userEvent.click(canvas.getByRole("radio", { name: "Name" }));
    await expect(canvas.getByRole("radio", { name: "Name" })).toBeChecked();
    await expect(cardNames(canvasElement)).toEqual([
      "acme/shop",
      "codex",
      "GLM plan",
      "local",
      "Personal plan",
      "work",
    ]);
    await expect(locationShown().search).toEqual({ sort: "name" });
    const hues = huesOf(canvasElement);
    await expect(hues.cards).toEqual(hues.switcher);
    const switcher = canvas.getByRole("navigation", { name: "Pool" });
    await expect(
      within(switcher).getByRole("link", { name: /work/ }),
    ).toHaveAttribute("href", "/?sort=name&pool=work");
  },
};

export const ThreePools: Story = page("/", overviewOfPools(threePools));

export const OnePool: Story = {
  ...page("/?pool=work", overviewOfPools(eightPools)),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "work" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("heading", { name: "Projects and models" }),
    ).toBeNull();
    await expect(
      await canvas.findByRole("link", { name: /^Errors .+/ }),
    ).toHaveAttribute("href", "/errors?range=24h&pool=work");
  },
};

export const NearAndAtLimit: Story = {
  ...page("/", overviewOfPools(atTheLimit)),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("meter", { name: "codex, 5-hour window" }),
    ).toHaveAttribute("aria-valuetext", "100% used, Full until the reset");
    await expect(
      await canvas.findByRole("meter", { name: "work, 5-hour window" }),
    ).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/^86% used, 16% ahead of pace · empties in /),
    );
  },
};

export const NoWindows: Story = page(
  "/?pool=opencode",
  overviewOfPools(eightPools),
);

export const AnObservedPool: Story = {
  ...page("/", overviewOfPools(withAnObservedPool)),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Observed")).toBeVisible();
    await expect(await canvas.findByText("Reported through")).toBeVisible();
    await expect(canvas.getByText(/^laptop · Antigravity$/)).toBeVisible();
    await expect(canvas.queryByText("Late")).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("No quota windows"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText(/^No requests since/),
    ).not.toBeInTheDocument();
  },
};

export const ReportedThroughLate: Story = {
  ...page("/", overviewOfPools(withAnObservedPool, reportedThrough.late)),
  play: async ({ canvas }) => {
    const late = await canvas.findByText("Late");
    await expect(late).toBeVisible();
    // The fixture's time is the minute the stories were loaded in, and the
    // page reads the clock, so the minutes may have moved on.
    await expect(
      late.closest('[data-slot="reported-through-line"]'),
    ).toHaveTextContent(/3h \d+m ago$/);
  },
};

export const NothingReportedYet: Story = {
  ...page(
    "/",
    overviewOfPools(withAnObservedPool, reportedThrough.never, false),
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Nothing has reported to it yet"),
    ).toBeVisible();
  },
};

export const ReportedThroughLoading: Story = page(
  "/",
  overviewOfPools(withAnObservedPool, reportedThrough.loading),
);

export const ReportedThroughFailed: Story = {
  ...page("/", overviewOfPools(withAnObservedPool, reportedThrough.failed)),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Reported through could not be read"),
    ).toBeVisible();
  },
};

export const AnObservedPoolInFull: Story = {
  ...page("/?pool=gemini", overviewOfPools(withAnObservedPool)),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "gemini" }),
    ).toBeVisible();
    await expect(
      await canvas.findByText(/^An observed pool has no quota windows/),
    ).toBeVisible();
    await expect(canvas.getByText("Observed · google")).toBeVisible();
    await expect(await canvas.findByText("Reported through")).toBeVisible();
    await expect(await canvas.findByText("gemini-3-pro-preview")).toBeVisible();
    await expect(canvas.getByText("notes")).toBeVisible();
    await expect(canvas.queryByText("acme/shop")).not.toBeInTheDocument();
  },
};

export const AnObservedPoolInFullLate: Story = {
  ...page(
    "/?pool=gemini",
    overviewOfPools(withAnObservedPool, reportedThrough.late),
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Late")).toBeVisible();
  },
};

export const AnObservedPoolInFullNeverReported: Story = {
  ...page(
    "/?pool=gemini",
    overviewOfPools(withAnObservedPool, reportedThrough.never, false),
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/^No machine has reported to this pool yet/),
    ).toBeVisible();
    await expect(await canvas.findByText(/^No requests since/)).toBeVisible();
  },
};

export const AllTimeOfAnEmptyLog: Story = {
  ...page("/?range=all", emptyLog),
  play: async ({ canvas }) => {
    const traffic = await canvas.findByRole("region", { name: "Traffic" });
    await expect(
      await within(traffic).findByText("The request log is empty."),
    ).toBeVisible();
    await expect(
      within(traffic).getByText(/All pools · the request log is empty/),
    ).toBeVisible();
  },
};

export const EmptyRequestLog: Story = {
  ...page("/", emptyLog),
  play: async ({ canvas }) => {
    await expect(
      (await canvas.findAllByText(/The request log is empty/)).length,
    ).toBeGreaterThan(0);
  },
};

export const Loading: Story = page("/", loading);

export const Failed: Story = {
  ...page("/", failed),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read the pools."),
    ).toBeVisible();
    await expect(
      (await canvas.findAllByRole("button", { name: "Try again" })).length,
    ).toBeGreaterThan(0);
  },
};

export const Narrow: Story = {
  ...page("/", overviewOfPools(eightPools)),
  globals: { viewport: { value: "mobile2" } },
};

export const Wide: Story = {
  ...page("/", overviewOfPools(eightPools)),
  parameters: {
    viewport: {
      options: {
        wide: {
          name: "1600 wide",
          styles: { width: "1600px", height: "1000px" },
          type: "desktop",
        },
      },
    },
  },
  globals: { viewport: { value: "wide" } },
};

export const ChoosingAPool: Story = {
  ...page("/", overviewOfPools(eightPools)),
  play: async ({ canvas, userEvent }) => {
    const switcher = await canvas.findByRole("navigation", { name: "Pool" });
    const work = await within(switcher).findByRole("link", { name: /work/ });
    await userEvent.click(work);
    await waitFor(() => expect(work).toHaveAttribute("aria-current", "page"));
    await expect(work).toHaveAttribute("data-status", "active");
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "work" }),
    ).toBeVisible();
    await expect(
      within(switcher).getByRole("link", { name: "All pools" }),
    ).not.toHaveAttribute("aria-current");
  },
};

export const ChangingTheRange: Story = {
  ...page("/", overviewOfPools(eightPools)),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    const traffic = await canvas.findByRole("region", { name: "Traffic" });
    await expect(await within(traffic).findByText("4,812")).toBeVisible();
    await expect(
      within(traffic).getAllByTitle(/of the window before$/),
    ).toHaveLength(6);
    await userEvent.click(canvas.getByRole("radio", { name: "7d" }));
    await expect(canvas.getByRole("radio", { name: "7d" })).toBeChecked();
    await expect(await within(traffic).findByText("30,118")).toBeVisible();
    const switcher = canvas.getByRole("navigation", { name: "Pool" });
    await expect(
      within(switcher).getByRole("link", { name: /work/ }),
    ).toHaveAttribute("href", expect.stringContaining("range=7d"));
  },
};

export const AllTime: Story = {
  ...page("/", overviewOfPools(eightPools)),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    const traffic = await canvas.findByRole("region", { name: "Traffic" });
    await expect(await within(traffic).findByText("4,812")).toBeVisible();
    await userEvent.click(canvas.getByRole("radio", { name: "All" }));
    await expect(canvas.getByRole("radio", { name: "All" })).toBeChecked();
    await expect(await within(traffic).findByText("52,480")).toBeVisible();
    await expect(
      within(traffic).getByText(
        /^All pools · the whole request log, since .+ \(13d 0h\)$/,
      ),
    ).toBeVisible();
    await expect(
      within(traffic).queryAllByTitle(/of the window before$/),
    ).toHaveLength(0);
    await expect(
      await canvas.findByText("All time", { selector: "p" }),
    ).toBeVisible();
    const switcher = canvas.getByRole("navigation", { name: "Pool" });
    await expect(
      within(switcher).getByRole("link", { name: /work/ }),
    ).toHaveAttribute("href", expect.stringContaining("range=all"));
  },
};

export const BeforeTheLogBegins: Story = {
  ...page("/?range=30d", overviewOfPools(eightPools)),
  play: async ({ canvas }) => {
    const traffic = await canvas.findByRole("region", { name: "Traffic" });
    await expect(await within(traffic).findByText("52,480")).toBeVisible();
    await expect(
      within(traffic).getByText(/ → now · the request log begins /),
    ).toBeVisible();
    await expect(
      within(traffic).queryAllByTitle(/of the window before$/),
    ).toHaveLength(0);
  },
};

const summaryOf = (canvas: HTMLElement) =>
  within(canvas).getByText("Today", { selector: '[data-slot="stat-label"]' })
    .parentElement?.parentElement ?? canvas;

const allTimeCard = async (canvas: HTMLElement) =>
  (
    await within(canvas).findByText("All time", {
      selector: '[data-slot="stat-label"]',
    })
  ).closest('[data-slot="stat"]');

export const AllTimeWithHistory: Story = {
  ...page("/", withHistory(eightPools)),
  play: async ({ canvasElement, canvas }) => {
    const card = await allTimeCard(canvasElement);
    await waitFor(() => expect(card).toHaveTextContent(/9\.5B\s*tokens/));
    await expect(card).toHaveTextContent(/≥\$20,[0-9]{3} · 274,140 requests/);
    await expect(card).toHaveTextContent(
      /The whole request log, since [A-Z][a-z]{2} \d{1,2}$/,
    );
    await expect(
      await canvas.findByText("Last 30 days", {
        selector: '[data-slot="stat-label"]',
      }),
    ).toBeVisible();
    const cards = canvas.getByRole("list", { name: "Pools" });
    const spare = within(cards).getByRole("link", { name: /^spare/ });
    await waitFor(() =>
      expect(spare).toHaveTextContent(/All time\s*1\.2B\s*\$2,640/),
    );
  },
};

export const AllTimeWithHistoryList: Story = {
  ...page("/", withHistory(eightPools)),
  beforeEach: () => {
    localStorage.setItem(layoutKey, "list");
    return () => localStorage.removeItem(layoutKey);
  },
};

export const AllTimeOfOnePool: Story = {
  ...page("/?pool=work", withHistory(eightPools)),
  play: async ({ canvas }) => {
    const usage = await canvas.findByRole("region", { name: "work traffic" });
    await waitFor(() =>
      expect(usage).toHaveTextContent(/All time\s*4\.4B\s*tokens/),
    );
  },
};

export const OrderedByAllTime: Story = {
  ...page("/", withHistory(eightPools)),
  play: async ({ canvasElement, canvas, userEvent }) => {
    await waitFor(() =>
      expect(cardNames(canvasElement)[0]).toBe("Personal plan"),
    );
    await userEvent.click(canvas.getByRole("radio", { name: "All time" }));
    await expect(canvas.getByRole("radio", { name: "All time" })).toBeChecked();
    await waitFor(() =>
      expect(cardNames(canvasElement)).toEqual([
        "work",
        "Personal plan",
        "spare",
        "codex",
        "acme/shop",
        "zai",
        "local",
        "opencode",
      ]),
    );
    await expect(locationShown().search).toEqual({ sort: "all-time" });
    const hues = huesOf(canvasElement);
    await expect(hues.cards).toEqual(hues.switcher);
  },
};

export const AllTimeOfAYoungHub: Story = {
  ...page("/", overviewOfPools(eightPools)),
  play: async ({ canvasElement, canvas }) => {
    const month = await canvas.findByText(/^Since [A-Z][a-z]{2} \d{1,2}$/, {
      selector: '[data-slot="stat-label"]',
    });
    await expect(month.closest('[data-slot="stat"]')).toHaveTextContent(
      /The whole request log$/,
    );
    await expect(
      within(summaryOf(canvasElement)).queryByText("All time"),
    ).toBeNull();
    await expect(
      within(canvas.getByRole("list", { name: "Pools" })).queryAllByText(
        "All time",
      ),
    ).toHaveLength(0);
    await expect(canvas.getByRole("radio", { name: "All time" })).toBeVisible();
  },
};

export const AllTimeLoading: Story = {
  ...page("/", historyLoading),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Last 30 days", {
        selector: '[data-slot="stat-label"]',
      }),
    ).toBeVisible();
    await expect(
      canvas.queryByText("All time", { selector: '[data-slot="stat-label"]' }),
    ).toBeNull();
    await expect(
      within(canvas.getByRole("list", { name: "Pools" })).getAllByText(
        "All time",
      ),
    ).toHaveLength(8);
  },
};

export const AllTimeFailed: Story = {
  ...page("/", historyFailed),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read the request log."),
    ).toBeVisible();
    await expect(
      await canvas.findByText("Last 30 days", {
        selector: '[data-slot="stat-label"]',
      }),
    ).toBeVisible();
  },
};
