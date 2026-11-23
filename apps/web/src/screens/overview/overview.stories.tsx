import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import {
  atTheLimit,
  eightPools,
  emptyLog,
  failed,
  loading,
  overviewOfPools,
  threePools,
  withAnObservedPool,
} from "#stories/overview.ts";
import { page } from "#stories/page.tsx";

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
    await expect(canvas.getByText("No quota windows")).toBeVisible();
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
