import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor, within } from "storybook/test";
import {
  errorsList,
  failedErrors,
  loadingErrors,
  manyCausesList,
  noErrors,
} from "#stories/errors.ts";
import { page } from "#stories/page.tsx";

const meta = { title: "Screens/Errors" } satisfies Meta;

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

export const NineCauses: Story = {
  ...page("/errors", errorsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "312 failed requests in the last 7 days, of 9 causes",
      ),
    ).toBeVisible();
    const causes = canvas.getByRole("table", { name: "Causes" });
    await expect(within(causes).getAllByRole("row")).toHaveLength(10);
    await expect(
      within(causes).getAllByRole("link", { name: /Latest request/ })[0],
    ).toHaveAttribute("href", "/requests/0193a4c2-000e-7000-8000-000000000001");
    await expect(
      within(causes).getByText("No message was recorded"),
    ).toBeVisible();
  },
};

export const ACauseOpens: Story = {
  ...page("/errors", errorsList),
  play: async ({ canvas, userEvent }) => {
    const title = await canvas.findByRole("button", {
      name: /^messages\.41\.content\.0: unexpected `tool_use_id`/,
    });
    await expect(title).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(title);
    await expect(title).toHaveAttribute("aria-expanded", "true");
    await expect(
      canvas.getByText(
        /^\{"type":"error","error":\{"type":"invalid_request_error"/,
      ),
    ).toBeVisible();
    const unavailable = canvas.getByRole("button", {
      name: "Service Unavailable",
    });
    await userEvent.click(unavailable);
    await expect(
      canvas.getByText(/upstream connect error or disconnect\/reset/),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Overloaded" }),
    ).not.toBeInTheDocument();
  },
};

export const AFilterFromAMenu: Story = {
  ...page("/errors", errorsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText(/^312 failed requests/);
    await userEvent.click(canvas.getByRole("button", { name: "Provider" }));
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: /anthropic/ }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await expect(
      await canvas.findByText(
        "262 failed requests in the last 7 days, of 6 causes",
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Provider anthropic" }),
    ).toBeVisible();
  },
};

export const AFilterFromARow: Story = {
  ...page("/errors", errorsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    const causes = await canvas.findByRole("table", { name: "Causes" });
    const [, overloaded] = within(causes).getAllByRole("row");
    if (overloaded === undefined) throw new Error("No cause is listed.");
    await userEvent.click(
      within(overloaded).getByRole("button", {
        name: /^Filter by pool .*personal/i,
      }),
    );
    await expect(
      await canvas.findByText(
        "217 failed requests in the last 7 days, of 3 causes",
      ),
    ).toBeVisible();
  },
};

export const FiltersChosen: Story = {
  ...page("/errors?provider=anthropic&pool=personal", errorsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText(
        /failed requests in the last 7 days, of 3 causes/,
      ),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: /^Pool Personal plan$/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: /Personal plan/ }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await expect(await canvas.findByText(/, of 6 causes$/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Pool" })).toBeVisible();
  },
};

export const ResettingTheFilters: Story = {
  ...page("/errors?provider=anthropic&pool=personal", errorsList),
  parameters: staleContrast,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Reset/ }));
    await expect(
      await canvas.findByText(
        "312 failed requests in the last 7 days, of 9 causes",
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Provider" }),
    ).toBeVisible();
  },
};

export const HangUps: Story = {
  ...page("/errors?outcome=cancelled", errorsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "64 cancelled requests in the last 7 days, of 1 cause",
      ),
    ).toBeVisible();
    await expect(
      canvas.getByText("The client hung up before the answer ended"),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: /Sessions with errors/ }),
    ).not.toBeInTheDocument();
  },
};

export const NoneRefused: Story = {
  ...page("/errors?outcome=refused", errorsList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No request was refused in the last 7 days."),
    ).toBeVisible();
  },
};

export const MoreThanTheHubLists: Story = {
  ...page("/errors", manyCausesList),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/^The 200 latest causes are shown, of 1,408\./),
    ).toBeVisible();
    const causes = canvas.getByRole("table", { name: "Causes" });
    await expect(within(causes).getAllByRole("row")).toHaveLength(201);
  },
};

export const NoErrors: Story = {
  ...page("/errors", noErrors),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No request failed in the last 7 days."),
    ).toBeVisible();
    await expect(canvas.getByText("Last 7 days")).toBeVisible();
  },
};

export const Loading: Story = {
  ...page("/errors", loadingErrors),
};

export const Failed: Story = {
  ...page("/errors", failedErrors),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read the errors."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  },
};

export const Narrow: Story = {
  ...page("/errors", errorsList),
  globals: { viewport: { value: "mobile2" } },
};

export const NarrowFiltersChosen: Story = {
  ...page("/errors?provider=anthropic&pool=personal", errorsList),
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Provider anthropic" }),
    ).toBeVisible();
  },
};
