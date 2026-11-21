import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor, within } from "storybook/test";

type Canvas = ReturnType<typeof within>;
type UserEvent = Parameters<NonNullable<Story["play"]>>[0]["userEvent"];

import { page } from "#stories/page.tsx";
import {
  cutSession,
  cutSessionAnswers,
  earlierSegmentFailed,
  earlierSegmentLoading,
  failedSession,
  loadingSession,
  longSession,
  longSessionAnswers,
  missingSession,
  requestSession,
  requestSessionAnswers,
  shortSession,
  shortSessionAnswers,
  silentSession,
  silentSessionAnswers,
  twoPoolsAnswers,
  twoPoolsSession,
} from "#stories/session.ts";

const meta = { title: "Screens/Session" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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

const pathOf = (session: string) => `/sessions/${encodeURIComponent(session)}`;

export const ALongSession: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 1,
        name: "Fix the checkout total after a coupon is removed",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("group", {
        name: /^212 main requests over 3h \d+m in 3 segments; the prompt peaked at 18\d(\.\d)?K tokens/,
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: /^Pool\s*work$/ }),
    ).toHaveAttribute("href", "/sessions?pool=work");
  },
};

const requestsTab = (session: string) => `${pathOf(session)}?tab=requests`;

const requestsTable = (canvas: Canvas) =>
  canvas.findByRole("table", { name: "Requests, newest first" });

export const TheRequestsTab: Story = {
  ...page(requestsTab(longSession), longSessionAnswers),
  play: async ({ canvas }) => {
    const table = await requestsTable(canvas);
    await expect(within(table).getAllByRole("link")).toHaveLength(200);
    await expect(
      canvas.getByRole("link", { name: /^Requests/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByText("Show 112 older")).toBeVisible();
  },
};

export const ATabChangesTheURL: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const requests = await canvas.findByRole("link", { name: /^Requests/ });
    const conversation = canvas.getByRole("link", { name: "Conversation" });
    await expect(conversation).toHaveAttribute("aria-current", "page");
    await expect(requests).toHaveAttribute(
      "href",
      `${pathOf(longSession)}?tab=requests`,
    );
    await userEvent.click(requests);
    await expect(await requestsTable(canvas)).toBeVisible();
    await expect(requests).toHaveAttribute("aria-current", "page");
    await expect(conversation).toHaveAttribute("href", pathOf(longSession));
    await userEvent.click(conversation);
    await expect(
      await canvas.findByRole("group", { name: "What the transcript shows" }),
    ).toBeVisible();
  },
};

export const TheRoleFilter: Story = {
  ...page(requestsTab(longSession), longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const table = await requestsTable(canvas);
    await userEvent.click(canvas.getByRole("button", { name: "Role" }));
    await expect(
      await screen.findByRole("menuitemcheckbox", { name: /^Main/ }),
    ).toHaveTextContent("212");
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: /^Title/ }),
    );
    await waitFor(() =>
      expect(within(table).getAllByRole("link")).toHaveLength(2),
    );
    await expect(within(table).getAllByText("Title")).toHaveLength(2);
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: /^Utility/ }),
    );
    await waitFor(() =>
      expect(within(table).getAllByRole("link")).toHaveLength(37),
    );
    await expect(within(table).getByText("refused")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await expect(
      canvas.getByRole("button", { name: "Role Title Utility" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Conversation" }),
    ).toHaveAttribute("href", `${pathOf(longSession)}?role=title&role=utility`);
  },
};

export const FiltersChosen: Story = {
  ...page(
    `${requestsTab(longSession)}&role=main&outcome=error`,
    longSessionAnswers,
  ),
  play: async ({ canvas }) => {
    const table = await requestsTable(canvas);
    await expect(within(table).getAllByRole("link")).toHaveLength(3);
    await expect(within(table).getAllByText(/^error/)).toHaveLength(3);
    await expect(
      canvas.getByRole("button", { name: "Outcome Errors" }),
    ).toBeVisible();
  },
};

export const ResettingTheFilters: Story = {
  ...page(
    `${requestsTab(longSession)}&role=main&outcome=error`,
    longSessionAnswers,
  ),
  play: async ({ canvas, userEvent }) => {
    const table = await requestsTable(canvas);
    await userEvent.click(canvas.getByRole("button", { name: /^Reset/ }));
    await waitFor(() =>
      expect(within(table).getAllByRole("link")).toHaveLength(200),
    );
    await expect(canvas.getByRole("button", { name: "Role" })).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /^Reset/ }),
    ).not.toBeInTheDocument();
  },
};

export const AColumnLeadsToItsRequests: Story = {
  ...page(`${pathOf(longSession)}?role=title`, longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const chart = await canvas.findByRole("group", {
      name: /^212 main requests/,
    });
    chart.focus();
    await userEvent.keyboard("{Home}{Enter}");
    const table = await requestsTable(canvas);
    await waitFor(() =>
      expect(within(table).getAllByRole("link")).toHaveLength(312),
    );
    const first = within(table).getAllByRole("link").at(-1);
    await waitFor(() => expect(first).toHaveFocus());
    await expect(
      canvas.getByRole("link", { name: "Conversation" }),
    ).toHaveAttribute("href", pathOf(longSession));
  },
};

export const TheErrorsFigure: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const errors = await canvas.findByRole("link", { name: /^Errors\s*\d/ });
    await userEvent.click(errors);
    const table = await requestsTable(canvas);
    for (const row of within(table).getAllByRole("link")) {
      await expect(row.closest("tr")).toHaveTextContent(/error/);
    }
    await expect(
      canvas.getByRole("button", { name: "Outcome Errors" }),
    ).toBeVisible();
  },
};

export const AShortSession: Story = {
  ...page(pathOf(shortSession), shortSessionAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 1,
        name: "What does `bun run check` run?",
      }),
    ).toBeVisible();
  },
};

export const ARequestWithoutASession: Story = {
  ...page(pathOf(requestSession), requestSessionAnswers),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 1,
        name: "A request without a session",
      }),
    ).toBeVisible();
  },
};

export const TwoPools: Story = {
  ...page(pathOf(twoPoolsSession), twoPoolsAnswers),
};

export const NoStoredConversation: Story = {
  ...page(pathOf(silentSession), silentSessionAnswers),
};

export const OlderRequestsLeftOut: Story = {
  ...page(requestsTab(cutSession), cutSessionAnswers),
  play: async ({ canvas }) => {
    await requestsTable(canvas);
    await expect(canvas.getByText(/older requests are left out/)).toBeVisible();
  },
};

const showFirstSegment = async (canvas: Canvas, userEvent: UserEvent) => {
  const first = await canvas.findByRole("region", { name: "Segment 1 of 3" });
  await userEvent.click(
    within(first).getByRole("button", {
      name: /^Show this segment's transcript/,
    }),
  );
  return first;
};

export const EarlierSegmentShown: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const first = await showFirstSegment(canvas, userEvent);
    await expect(
      await within(first).findByText(
        /The coupon tests share one cart, so one test's coupon leaks/,
      ),
    ).toBeVisible();
    await userEvent.click(within(first).getByRole("button", { name: "Hide" }));
    await expect(
      within(first).getByRole("button", {
        name: /^Show this segment's transcript/,
      }),
    ).toBeVisible();
  },
};

export const EarlierSegmentLoading: Story = {
  ...page(pathOf(longSession), earlierSegmentLoading),
  play: async ({ canvas, userEvent }) => {
    const first = await showFirstSegment(canvas, userEvent);
    await expect(
      within(first).getByRole("status", {
        name: "The segment's transcript is loading",
      }),
    ).toBeInTheDocument();
  },
};

export const EarlierSegmentFailed: Story = {
  ...page(pathOf(longSession), earlierSegmentFailed),
  play: async ({ canvas, userEvent }) => {
    const first = await showFirstSegment(canvas, userEvent);
    await expect(
      await within(first).findByText(
        "The hub could not read this segment's transcript.",
      ),
    ).toBeVisible();
    await expect(
      within(first).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  },
};

export const AToggleHidesItsEntries: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const group = await canvas.findByRole("group", {
      name: "What the transcript shows",
    });
    const tools = within(group).getByRole("button", { name: /^Tool calls/ });
    await expect(tools).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.getAllByRole("button", { name: /^Bash/ }).length,
    ).toBeGreaterThan(0);
    await userEvent.click(tools);
    await expect(tools).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(canvas.queryAllByRole("button", { name: /^Bash/ })).toHaveLength(
        0,
      ),
    );
    await expect(
      canvas.getByText(/^54 entries hidden by the toggles: 54 tool calls$/),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: /^Requests/ }),
    ).toHaveAttribute("href", `${pathOf(longSession)}?hide=tools&tab=requests`);
  },
};

export const AToggleOff: Story = {
  ...page(`${pathOf(longSession)}?hide=tools`, longSessionAnswers),
  play: async ({ canvas }) => {
    const group = await canvas.findByRole("group", {
      name: "What the transcript shows",
    });
    await expect(
      within(group).getByRole("button", { name: /^Tool calls/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      within(group).getByRole("button", { name: /^Reasoning/ }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const ExpandingEveryRow: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const call = await canvas.findByRole("button", {
      name: /^Bash\s*rg -n "total" src\/cart/,
    });
    await expect(call).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Expand all" }));
    await expect(call).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Collapse all" }));
    await expect(call).toHaveAttribute("aria-expanded", "false");
  },
};

export const AToolCallOpens: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  play: async ({ canvas, userEvent }) => {
    const call = await canvas.findByRole("button", {
      name: /^Bash\s*rg -n "total" src\/cart/,
    });
    await expect(call).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(call);
    await expect(call).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("Input")).toBeVisible();
    await expect(
      canvas.getByText(/src\/cart\/cart\.ts:7: return/),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  ...page(pathOf(longSession), loadingSession),
};

export const Failed: Story = {
  ...page(pathOf(longSession), failedSession),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read this session."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  },
};

export const NotFound: Story = {
  ...page(pathOf(longSession), missingSession),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("There is no such session."),
    ).toBeVisible();
    await expect(canvas.getByText(longSession)).toBeVisible();
  },
};

export const Narrow: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  globals: { viewport: { value: "mobile2" } },
};

export const NarrowRequests: Story = {
  ...page(requestsTab(longSession), longSessionAnswers),
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvas, userEvent }) => {
    const table = await requestsTable(canvas);
    await expect(within(table).getAllByRole("link")).toHaveLength(200);
    await expect(
      within(table).queryByRole("columnheader", { name: "Model" }),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Show 112 older" }),
    );
    await expect(within(table).getAllByRole("link")).toHaveLength(312);
  },
};

export const Wide: Story = {
  ...page(pathOf(longSession), longSessionAnswers),
  parameters: wide,
  globals: { viewport: { value: "wide" } },
};
