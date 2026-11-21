import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor, within } from "storybook/test";
import { locationShown, page } from "#stories/page.tsx";
import {
  forgetTheSearches,
  paletteAnswers,
  paletteFailed,
  searchesAsked,
  searchFailed,
  searchReading,
} from "#stories/palette.ts";
import { sessionsList } from "#stories/sessions.ts";
import { typingPause } from "./palette.tsx";

const meta = { title: "App/Palette" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const forgetTheSidebar = () => {
  localStorage.removeItem("cota-sidebar");
};

const opened = async () => {
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  const field = within(dialog).getByRole("combobox", { name: "Search" });
  // The dialog gives its field the focus a moment after it is drawn; a key sent before that goes nowhere.
  await waitFor(() => expect(field).toHaveFocus());
  return {
    dialog,
    field,
    list:
      dialog.querySelector<HTMLElement>("[data-slot=palette-list]") ?? dialog,
  };
};

const groupNames = (list: HTMLElement) =>
  within(list)
    .queryAllByRole("group")
    .map((group) => group.getAttribute("aria-labelledby"))
    .map((id) => (id === null ? "" : document.getElementById(id)?.textContent));

const selected = (list: HTMLElement) =>
  within(list).getByRole("option", { selected: true });

const paused = () =>
  new Promise((resolve) => setTimeout(resolve, typingPause + 200));

export const Closed: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas }) => {
    const search = await canvas.findByRole("button", { name: "Search" });
    await expect(search).toHaveAttribute("aria-keyshortcuts");
    await expect(screen.queryByRole("dialog")).toBeNull();
  },
};

export const OpenAndEmpty: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await expect(field).toHaveFocus();
    await waitFor(() =>
      expect(within(list).getAllByRole("option")).toHaveLength(17),
    );
    await expect(groupNames(list)).toEqual(["Go to", "Pools"]);
    await expect(selected(list)).toHaveTextContent("Overview");
    await expect(
      within(list).getByRole("option", { name: /Spare quota/ }),
    ).toHaveAttribute("href", "/?pool=spare");
  },
};

export const EveryGroup: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await userEvent.type(field, "quota");
    await waitFor(() =>
      expect(
        within(list).getByRole("option", { name: /reader time out/ }),
      ).toBeVisible(),
    );
    await expect(groupNames(list)).toEqual([
      "Go to",
      "Pools",
      "Filter sessions by",
      "Sessions",
    ]);
    await expect(selected(list)).toHaveTextContent("Quota logins");
    await expect(
      within(list).getByRole("option", { name: /quota-readers/ }),
    ).toHaveAttribute("href", "/sessions?project=quota-readers");
    await expect(
      within(list).getByRole("option", { name: "Search sessions for “quota”" }),
    ).toHaveAttribute("href", "/sessions?q=quota");
    await expect(list.querySelectorAll("mark").length).toBeGreaterThan(3);
  },
};

export const NothingMatches: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await userEvent.type(field, "zzzz");
    await expect(
      await within(list).findByText(
        "No session mentions “zzzz” in the last 7 days.",
      ),
    ).toBeVisible();
    await expect(groupNames(list)).toEqual(["Sessions"]);
    await expect(within(list).getAllByRole("option")).toHaveLength(1);
  },
};

export const SearchReading: Story = {
  ...page("/", searchReading),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await userEvent.type(field, "relay");
    await paused();
    await expect(
      within(list).getByText("Searching the sessions…"),
    ).toBeVisible();
    await expect(
      within(list).getByRole("option", { name: "Search sessions for “relay”" }),
    ).toBeVisible();
  },
};

export const SearchFailed: Story = {
  ...page("/", searchFailed),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await userEvent.type(field, "relay");
    await expect(
      await within(list).findByText("The hub could not search the sessions."),
    ).toBeVisible();
    await expect(
      within(list).getByRole("option", { name: "Search sessions for “relay”" }),
    ).toBeVisible();
  },
};

export const SearchRefused: Story = {
  ...page("/", paletteAnswers),
  beforeEach: () => {
    forgetTheSidebar();
    forgetTheSearches();
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await userEvent.type(field, "--");
    await expect(
      await within(list).findByText(
        "“--” holds no word to search for: a word is letters or digits between spaces or punctuation.",
      ),
    ).toBeVisible();
    await expect(searchesAsked).toEqual([]);
  },
};

export const ReadsFailed: Story = {
  ...page("/", paletteFailed),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    const note = await within(list).findByText(
      "The hub could not read the pools.",
    );
    await waitFor(() => expect(note).toBeVisible());
    await userEvent.type(field, "s");
    await expect(
      await within(list).findByText(
        "The hub could not read the values to filter by.",
      ),
    ).toBeVisible();
    await expect(
      within(list).getByRole("option", { name: "Sessions" }),
    ).toBeVisible();
  },
};

export const ManyResults: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await userEvent.type(field, "s");
    await waitFor(() =>
      expect(
        within(list).getByRole("option", { name: /Search sessions for/ }),
      ).toHaveTextContent("412 sessions"),
    );
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    await userEvent.keyboard("{End}");
    const last = selected(list);
    await expect(last).toHaveTextContent("Search sessions for “s”");
    await waitFor(() => {
      const shown = list.getBoundingClientRect();
      const option = last.getBoundingClientRect();
      expect(option.bottom).toBeLessThanOrEqual(shown.bottom + 1);
      expect(option.top).toBeGreaterThanOrEqual(shown.top - 1);
    });
  },
};

export const Narrow: Story = {
  ...page("/", paletteAnswers),
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Search" }),
    );
    const { field, list } = await opened();
    await userEvent.type(field, "quota");
    await waitFor(() =>
      expect(
        within(list).getByRole("option", { name: /reader time out/ }),
      ).toBeVisible(),
    );
  },
};

export const ShortcutOpensAndEscapeCloses: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    const nav = await canvas.findByRole("navigation", { name: "Primary" });
    const sessions = within(nav).getByRole("link", { name: "Sessions" });
    sessions.focus();
    await userEvent.keyboard("{Control>}k{/Control}");
    const { field } = await opened();
    await expect(field).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(sessions).toHaveFocus());
  },
};

export const SlashOpensOutsideAField: Story = {
  ...page("/sessions", [...paletteAnswers, ...sessionsList]),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    const search = await canvas.findByRole("searchbox", {
      name: "Search the sessions",
    });
    await userEvent.click(search);
    await userEvent.keyboard("/");
    await expect(search).toHaveValue("/");
    await expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.clear(search);
    search.blur();
    await userEvent.keyboard("/");
    const { field } = await opened();
    await expect(field).toHaveFocus();
    await expect(field).toHaveValue("");
  },
};

export const ArrowsMoveAndWrap: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("navigation", { name: "Primary" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const { field, list } = await opened();
    await waitFor(() =>
      expect(within(list).getAllByRole("option")).toHaveLength(17),
    );
    const options = within(list).getAllByRole("option");
    await expect(field).toHaveAttribute(
      "aria-activedescendant",
      options[0]?.id,
    );
    await userEvent.keyboard("{ArrowUp}");
    await expect(selected(list)).toBe(options[16]);
    await expect(field).toHaveAttribute(
      "aria-activedescendant",
      options[16]?.id,
    );
    await userEvent.keyboard("{ArrowDown}");
    await expect(selected(list)).toBe(options[0]);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect(selected(list)).toHaveTextContent("Errors");
    await userEvent.keyboard("{End}");
    await expect(selected(list)).toBe(options[16]);
    await userEvent.keyboard("{Home}");
    await expect(selected(list)).toBe(options[0]);
  },
};

export const EnterOpens: Story = {
  ...page("/", paletteAnswers),
  beforeEach: forgetTheSidebar,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("navigation", { name: "Primary" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const { field, list } = await opened();
    await userEvent.type(field, "work");
    await waitFor(() =>
      expect(selected(list)).toHaveAttribute("href", "/?pool=work"),
    );
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(locationShown().search).toEqual({ pool: "work" });
  },
};

export const TypingAsksOnce: Story = {
  ...page("/", paletteAnswers),
  beforeEach: () => {
    forgetTheSidebar();
    forgetTheSearches();
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("navigation", { name: "Primary" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const { field, list } = await opened();
    await userEvent.type(field, "quota");
    await expect(
      await within(list).findByRole("option", { name: /reader time out/ }),
    ).toBeVisible();
    await paused();
    await expect(searchesAsked).toEqual(["quota"]);
  },
};
