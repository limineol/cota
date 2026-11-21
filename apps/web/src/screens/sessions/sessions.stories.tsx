import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor, within } from "storybook/test";
import { page } from "#stories/page.tsx";
import {
  failedFacets,
  failedList,
  loadingList,
  sessionsList,
} from "#stories/sessions.ts";

const meta = { title: "Screens/Sessions" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Content dimmed while a newer answer is on its way is inactive, which WCAG 1.4.3 exempts from contrast. */
const staleContrast = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", selector: ":not([data-stale] *)" }],
    },
  },
};

const wide = {
  viewport: {
    options: {
      wide: {
        name: "1600 wide",
        styles: { width: "1600px", height: "1000px" },
        type: "desktop",
      },
    },
  },
};

export const AFullPage: Story = {
  ...page("/sessions", sessionsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("1,284 sessions in the last 7 days"),
    ).toBeVisible();
    const table = await canvas.findByRole("table", { name: "Sessions" });
    const links = within(table).getAllByRole("link", {
      name: (name) => !/^(Ended|Requests|Tokens|Cost)$/.test(name),
    });
    await expect(links).toHaveLength(50);
    await expect(
      within(table).getAllByText("A request without a session").length,
    ).toBeGreaterThan(0);
    const [first] = links;
    await expect(first).toHaveAccessibleName(
      expect.stringMatching(/^Fix the relay hang when a stream ends early/),
    );
    await expect(first).toHaveAttribute(
      "href",
      "/sessions/0193a4c2-0000-7000-8000-5e5510000000",
    );
    await expect(
      within(table).getByRole("columnheader", { name: "Ended" }),
    ).toHaveAttribute("aria-sort", "descending");
    await expect(canvas.getByText("1–50 of 1,284")).toBeVisible();
    await expect(canvas.getByText("Page 1 of 26")).toBeVisible();
  },
};

export const ASearch: Story = {
  ...page("/sessions?q=relay+hang", sessionsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "4 sessions in the last 7 days mentioning “relay hang”",
      ),
    ).toBeVisible();
    const search = canvas.getByRole("search");
    await expect(
      within(search).getByRole("radiogroup", {
        name: "How the search matches words",
      }),
    ).toBeVisible();
    await expect(
      canvas.getAllByText("relay", { selector: "mark" }).length,
    ).toBeGreaterThan(0);
  },
};

export const FiltersChosen: Story = {
  ...page(
    "/sessions?pool=work&project=infra&machine=retired-box&outcome=error",
    sessionsList,
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("button", { name: "Pool work" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Project infra" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Outcome Errors" }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Machine retired-box" }),
    );
    await expect(
      await screen.findByRole("menuitemcheckbox", { name: /retired-box/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      screen.getByRole("group", { name: "Counted in requests" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  },
};

export const SortedByTokens: Story = {
  ...page("/sessions?sort=tokens", sessionsList),
  play: async ({ canvas }) => {
    const table = await canvas.findByRole("table", { name: "Sessions" });
    await expect(
      within(table).getByRole("columnheader", { name: "Tokens" }),
    ).toHaveAttribute("aria-sort", "descending");
    await expect(
      within(table).getByRole("link", { name: "Ended" }),
    ).toHaveAttribute("href", "/sessions");
  },
};

export const SortingByAHead: Story = {
  ...page("/sessions?page=2", sessionsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    const table = await canvas.findByRole("table", { name: "Sessions" });
    const cost = within(table).getByRole("link", { name: "Cost" });
    await expect(cost).toHaveAttribute("href", "/sessions?sort=cost");
    await userEvent.click(cost);
    await waitFor(() =>
      expect(
        within(table).getByRole("columnheader", { name: "Cost" }),
      ).toHaveAttribute("aria-sort", "descending"),
    );
    await expect(
      within(table).getByRole("columnheader", { name: "Ended" }),
    ).not.toHaveAttribute("aria-sort");
    await expect(
      within(table).getByRole("link", { name: "Tokens" }),
    ).toHaveAttribute("href", "/sessions?sort=tokens");
  },
};

export const SecondPage: Story = {
  ...page("/sessions?page=2", sessionsList),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("51–100 of 1,284")).toBeVisible();
    await expect(canvas.getByRole("link", { name: /Newer/ })).toHaveAttribute(
      "href",
      "/sessions",
    );
  },
};

export const TheLastPageTheHubReaches: Story = {
  ...page("/sessions?page=201", sessionsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("10,001–10,050 of 18,342"),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: /Older/ })).toBeDisabled();
    await expect(
      canvas.getByText(/^The hub lists the first 10,050 sessions\./),
    ).toBeVisible();
  },
};

export const OneSession: Story = {
  ...page("/sessions?project=notes", sessionsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("1 session in the last 7 days"),
    ).toBeVisible();
    await expect(canvas.getByText("1 session")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: /Older/ })).toBeNull();
  },
};

export const NothingMatches: Story = {
  ...page("/sessions?pool=spare", sessionsList),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No sessions match.")).toBeVisible();
    await expect(
      canvas.getByText("Try a longer range or fewer filters."),
    ).toBeVisible();
  },
};

export const NothingMentionsTheSearch: Story = {
  ...page("/sessions?q=kubernetes", sessionsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Nothing mentions “kubernetes”."),
    ).toBeVisible();
  },
};

export const ASearchWithNoWord: Story = {
  ...page("/sessions?q=%21%21%21", sessionsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub cannot run this search."),
    ).toBeVisible();
    await expect(canvas.getByText(/^“!!!” holds no word/)).toBeVisible();
  },
};

export const Loading: Story = page("/sessions", loadingList);

export const FailedList: Story = {
  ...page("/sessions", failedList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read the sessions."),
    ).toBeVisible();
    await expect(
      await canvas.findByText("The hub could not read the filters."),
    ).toBeVisible();
  },
};

export const FailedFacets: Story = {
  ...page("/sessions", failedFacets),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read the filters."),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("table", { name: "Sessions" }),
    ).toBeVisible();
  },
};

export const Narrow: Story = {
  ...page("/sessions?pool=work", sessionsList),
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Pool work" }),
    ).toBeVisible();
    const reset = canvas.getByRole("button", { name: /^Reset/ });
    await expect(reset.getBoundingClientRect().right).toBeLessThanOrEqual(
      window.innerWidth,
    );
    const table = await canvas.findByRole("table", { name: "Sessions" });
    const head = within(table).getByRole("columnheader", { name: "Session" });
    await expect(head.getBoundingClientRect().height).toBeLessThanOrEqual(1);
    await expect(
      within(table).queryByRole("columnheader", { name: "Tokens" }),
    ).toBeNull();
  },
};

export const NarrowSearch: Story = {
  ...page("/sessions?q=relay+hang", sessionsList),
  globals: { viewport: { value: "mobile2" } },
};

export const Wide: Story = {
  ...page("/sessions", sessionsList),
  parameters: wide,
  globals: { viewport: { value: "wide" } },
};

export const TickingAFilter: Story = {
  ...page("/sessions", sessionsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText("1,284 sessions in the last 7 days"),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Pool" }));
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: /work/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemcheckbox", { name: /work/ }),
      ).toHaveAttribute("aria-checked", "true"),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await expect(
      await canvas.findByRole("button", { name: "Pool work" }),
    ).toBeVisible();
    await expect(
      await canvas.findByText(
        /^\d+ sessions? in the last 7 days$/,
        {},
        { timeout: 3000 },
      ),
    ).not.toHaveTextContent("1,284");
  },
};

export const ResettingTheFilters: Story = {
  ...page("/sessions?pool=work&outcome=error", sessionsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Reset/ }));
    await expect(
      await canvas.findByText("1,284 sessions in the last 7 days"),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Pool" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /Reset/ })).toBeNull();
  },
};

export const Searching: Story = {
  ...page("/sessions", sessionsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", { name: "Search the sessions" }),
      "relay hang{Enter}",
    );
    await expect(
      await canvas.findByText(
        "4 sessions in the last 7 days mentioning “relay hang”",
      ),
    ).toBeVisible();
  },
};

export const Paging: Story = {
  ...page("/sessions", sessionsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText("1–50 of 1,284")).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: /Older/ }));
    await expect(await canvas.findByText("51–100 of 1,284")).toBeVisible();
    await expect(canvas.getByText("Page 2 of 26")).toBeVisible();
  },
};
