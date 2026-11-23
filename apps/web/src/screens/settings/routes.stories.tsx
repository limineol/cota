import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor, within } from "storybook/test";
import { locationShown, page, withApi } from "#stories/page.tsx";
import {
  answers,
  changedFromElsewhere,
  noRoutes,
  refusedTwice,
  routes,
  routesLoading,
  routesStoreUnavailable,
  routesUnreachable,
  savingForever,
  savingTheEdit,
  savingWithoutAStore,
  unfitRoutes,
} from "#stories/routes.ts";
import { Routes } from "./routes.tsx";

const meta = { title: "Screens/Settings/Routes" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story["play"]>>[0]["canvas"];
type UserEvent = Parameters<NonNullable<Story["play"]>>[0]["userEvent"];

const desk = {
  parameters: {
    viewport: {
      options: {
        desk: {
          name: "1440 wide",
          styles: { width: "1440px", height: "900px" },
          type: "desktop",
        },
      },
    },
  },
  globals: { viewport: { value: "desk" } },
};

const narrow = { globals: { viewport: { value: "mobile2" } } };

const list = (canvas: Canvas) =>
  canvas.findByRole("table", { name: "Routes of Claude Code" });

const patterns = (canvas: Canvas) =>
  canvas
    .getAllByRole("textbox", { name: /^Pattern of route/ })
    .map((field) => (field instanceof HTMLInputElement ? field.value : null));

const choose = async (
  canvas: Canvas,
  userEvent: UserEvent,
  select: string,
  option: string,
) => {
  await userEvent.click(canvas.getByRole("combobox", { name: select }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
  // Base UI keeps the popup's focus guards until its closing transition ends; axe runs once the story does.
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
};

/** Moves `notes` above `acme/*` and back, removes `blog`, and adds `cota` to studio at the end. */
const editTheList = async (canvas: Canvas, userEvent: UserEvent) => {
  await list(canvas);
  await expect(patterns(canvas)).toEqual(["acme/*", "notes", "blog"]);
  await userEvent.click(
    canvas.getByRole("button", { name: "Move route 2 up" }),
  );
  await expect(patterns(canvas)).toEqual(["notes", "acme/*", "blog"]);
  await expect(
    canvas.getByRole("button", { name: "Move route 1 down" }),
  ).toHaveFocus();
  await userEvent.click(
    canvas.getByRole("button", { name: "Move route 1 down" }),
  );
  await expect(patterns(canvas)).toEqual(["acme/*", "notes", "blog"]);
  await userEvent.click(
    canvas.getByRole("button", { name: "Move route 2 up" }),
  );
  await userEvent.click(canvas.getByRole("button", { name: "Remove route 3" }));
  await expect(patterns(canvas)).toEqual(["notes", "acme/*"]);
  await userEvent.click(canvas.getByRole("button", { name: "Add a route" }));
  const added = canvas.getByRole("textbox", { name: "Pattern of route 3" });
  await expect(added).toHaveFocus();
  await userEvent.type(added, "cota");
  await choose(canvas, userEvent, "Pool of route 3", "studio");
  await expect(patterns(canvas)).toEqual(["notes", "acme/*", "cota"]);
  await expect(canvas.getByText("Edited, not saved.")).toBeVisible();
};

export const ClaudeCodesRoutes: Story = {
  ...page("/settings/routes", routes()),
  ...desk,
  play: async ({ canvas }) => {
    const table = await list(canvas);
    await expect(patterns(canvas)).toEqual(["acme/*", "notes", "blog"]);
    await expect(
      within(table).getByRole("combobox", { name: "Pool of route 2" }),
    ).toHaveTextContent("Solo plan");
    await expect(
      within(table).getByRole("combobox", {
        name: "Default pool of Claude Code",
      }),
    ).toHaveTextContent("Solo plan");
    await expect(
      canvas.getByRole("button", { name: "Move route 1 up" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Move route 3 down" }),
    ).toBeDisabled();
    await expect(canvas.getByText(/^3 routes · Saved /)).toBeVisible();
    await expect(
      canvas.getByText(/tried in order, and the first whose pattern matches/),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Routes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

export const ClaudeCodesRoutesNarrow: Story = {
  ...page("/settings/routes", routes()),
  ...narrow,
  play: async ({ canvas }) => {
    await list(canvas);
    const field = canvas.getByRole("textbox", { name: "Pattern of route 1" });
    const select = canvas.getByRole("combobox", { name: "Pool of route 1" });
    await expect(select.getBoundingClientRect().top).toBeGreaterThan(
      field.getBoundingClientRect().bottom - 1,
    );
    await expect(
      canvas
        .getByRole("button", { name: "Remove route 1" })
        .getBoundingClientRect().right,
    ).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const CodexsRoutes: Story = {
  ...page("/settings/routes?client=codex", routes()),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("table", { name: "Routes of Codex" });
    await expect(
      canvas.getByRole("combobox", { name: "Default pool of Codex" }),
    ).toHaveTextContent("None");
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Pool of route 1" }),
    );
    const offered = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    await expect(offered).toEqual(["codex", "night"]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await userEvent.click(canvas.getByRole("radio", { name: "Claude Code" }));
    await list(canvas);
    await expect(locationShown().search).toEqual({});
  },
};

export const NoRoutesYet: Story = {
  ...page("/settings/routes", noRoutes),
  ...desk,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Claude Code has no routes."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("combobox", { name: "Default pool of Claude Code" }),
    ).toHaveTextContent("None");
    await expect(canvas.getByText(/^0 routes · Never saved/)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Add a route" }),
    ).toBeEnabled();
  },
};

export const APoolThatNoLongerFits: Story = {
  ...page("/settings/routes", unfitRoutes),
  ...desk,
  play: async ({ canvas }) => {
    const table = await list(canvas);
    await expect(
      within(table).getByRole("combobox", { name: "Pool of route 2" }),
    ).toHaveTextContent("retired");
    await expect(
      within(table).getByText(
        /^The configuration no longer has the pool retired: launches of the projects this route matches stop/,
      ),
    ).toBeVisible();
    await expect(
      within(table).getByText(
        /^zai does not speak Claude Code's protocol any more: launches no route matches stop/,
      ),
    ).toBeVisible();
    await expect(
      within(table).getByText(
        /^gemini is an observed pool, which speaks no protocol: launches of the projects this route matches stop/,
      ),
    ).toBeVisible();
  },
};

export const RoutesLoading: Story = {
  ...page("/settings/routes", routesLoading),
  ...desk,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("table", {
        name: "Routes of Claude Code loading",
      }),
    ).toBeVisible();
  },
};

export const RoutesUnread: Story = {
  ...page("/settings/routes", routesUnreachable),
  ...desk,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub could not read the routes."),
    ).toBeVisible();
    await expect(canvas.getByText(/^The hub did not answer\./)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  },
};

export const RoutesWithoutAStore: Story = {
  ...page("/settings/routes", routesStoreUnavailable),
  ...desk,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The hub store could not be read."),
    ).toBeVisible();
  },
};

export const Editing: Story = {
  ...page("/settings/routes", routes()),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await editTheList(canvas, userEvent);
    await userEvent.click(
      canvas.getByRole("button", { name: "Drop the edit" }),
    );
    await expect(patterns(canvas)).toEqual(["acme/*", "notes", "blog"]);
    await expect(canvas.getByText(/^3 routes · Saved /)).toBeVisible();
  },
};

export const EditingNarrow: Story = {
  ...page("/settings/routes", routes()),
  ...narrow,
  play: async ({ canvas, userEvent }) => {
    await editTheList(canvas, userEvent);
  },
};

export const Saving: Story = {
  ...page("/settings/routes", savingForever),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await editTheList(canvas, userEvent);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(
      await canvas.findByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
  },
};

export const Saved: Story = {
  ...page("/settings/routes", savingTheEdit),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await editTheList(canvas, userEvent);
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(await canvas.findByText("Saved.")).toBeVisible();
    await expect(patterns(canvas)).toEqual(["notes", "acme/*", "cota"]);
    await expect(
      canvas.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  },
};

/** Adds `acme/api` under `acme/*`, and `a*b`, which is not a pattern, then saves. */
const addTwoTheHubRefuses = async (canvas: Canvas, userEvent: UserEvent) => {
  await list(canvas);
  await userEvent.click(canvas.getByRole("button", { name: "Add a route" }));
  await userEvent.type(
    canvas.getByRole("textbox", { name: "Pattern of route 4" }),
    "acme/api",
  );
  await choose(canvas, userEvent, "Pool of route 4", "studio");
  await userEvent.click(canvas.getByRole("button", { name: "Add a route" }));
  await userEvent.type(
    canvas.getByRole("textbox", { name: "Pattern of route 5" }),
    "a*b",
  );
  await choose(canvas, userEvent, "Pool of route 5", "Solo plan");
  await userEvent.click(canvas.getByRole("button", { name: "Save" }));
};

const rowOf = (field: HTMLElement) => {
  const row = field.closest("tr");
  if (row === null) throw new Error("The field is in no row.");
  return within(row);
};

export const RefusedOnTwoRows: Story = {
  ...page("/settings/routes", refusedTwice),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await addTwoTheHubRefuses(canvas, userEvent);
    const shadowed = canvas.getByRole("textbox", {
      name: "Pattern of route 4",
    });
    await expect(await rowOf(shadowed).findByRole("alert")).toHaveTextContent(
      "Route 1, acme/*, matches every project this one does, so this one would never be reached.",
    );
    await expect(shadowed).toHaveAttribute("aria-invalid", "true");
    const notAPattern = canvas.getByRole("textbox", {
      name: "Pattern of route 5",
    });
    await expect(rowOf(notAPattern).getByRole("alert")).toHaveTextContent(
      /^Not a project pattern/,
    );
    await expect(notAPattern).toHaveValue("a*b");
    await expect(
      canvas.getByText("Not saved: the hub refused 2 rows, as said on each."),
    ).toBeVisible();
  },
};

export const ARefusalLeavesWhenItsRowChanges: Story = {
  ...page("/settings/routes", refusedTwice),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await addTwoTheHubRefuses(canvas, userEvent);
    const notAPattern = canvas.getByRole("textbox", {
      name: "Pattern of route 5",
    });
    await rowOf(notAPattern).findByRole("alert");
    await userEvent.type(notAPattern, "{Backspace}{Backspace}");
    await expect(rowOf(notAPattern).queryByRole("alert")).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Move route 4 up" }),
    );
    const shadowed = canvas.getByRole("textbox", {
      name: "Pattern of route 3",
    });
    await expect(shadowed).toHaveValue("acme/api");
    await expect(rowOf(shadowed).getByRole("alert")).toHaveTextContent(
      /^Route 1, acme\/\*, matches every project/,
    );
    await expect(
      canvas.getByText("Not saved: the hub refused 1 row, as said on it."),
    ).toBeVisible();
  },
};

export const RefusedNarrow: Story = {
  ...page("/settings/routes", refusedTwice),
  ...narrow,
  play: async ({ canvas, userEvent }) => {
    await addTwoTheHubRefuses(canvas, userEvent);
    await expect(
      await canvas.findByText(/^Route 1, acme\/\*, matches every project/),
    ).toBeVisible();
  },
};

export const AnUnchosenPoolIsNotSent: Story = {
  ...page("/settings/routes", routes()),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await list(canvas);
    await userEvent.click(canvas.getByRole("button", { name: "Add a route" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Pattern of route 4" }),
      "cota",
    );
    await expect(
      canvas.getByRole("combobox", { name: "Pool of route 4" }),
    ).toHaveTextContent("Choose a pool");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(
      canvas.getByText("Not saved: route 4 has no pool."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("combobox", { name: "Pool of route 4" }),
    ).toHaveAttribute("aria-invalid", "true");
  },
};

export const ChangedFromElsewhere: Story = {
  ...page("/settings/routes", changedFromElsewhere),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await list(canvas);
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove route 3" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(
      await canvas.findByText(
        /^Not saved: the routes of Claude Code were changed from another browser/,
      ),
    ).toBeVisible();
    await expect(patterns(canvas)).toEqual(["acme/*", "notes"]);
    await expect(
      canvas.getByRole("button", { name: "Read them again" }),
    ).toBeVisible();
  },
};

export const ReadingAgainDropsTheEdit: Story = {
  ...page("/settings/routes", changedFromElsewhere),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await list(canvas);
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove route 3" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await userEvent.click(
      await canvas.findByRole("button", { name: "Read them again" }),
    );
    await waitFor(() =>
      expect(
        canvas.getByRole("combobox", { name: "Pool of route 2" }),
      ).toHaveTextContent("spare"),
    );
    await expect(canvas.getByText(/^2 routes · Saved /)).toBeVisible();
  },
};

export const SavedWithoutAStore: Story = {
  ...page("/settings/routes", savingWithoutAStore),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await list(canvas);
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove route 3" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(
      await canvas.findByText(
        "Not saved: The hub store could not be written: the disk is full.",
      ),
    ).toBeVisible();
    await expect(patterns(canvas)).toEqual(["acme/*", "notes"]);
  },
};

export const ForAReaderKey: Story = {
  decorators: [withApi(routes())],
  ...desk,
  render: () => (
    <Routes
      owner={false}
      client="claude-code"
      project=""
      onClientChange={() => {}}
      onAsk={() => {}}
    />
  ),
  play: async ({ canvas }) => {
    const table = await list(canvas);
    await expect(within(table).getByText("acme/*")).toBeVisible();
    await expect(within(table).getAllByText("Solo plan")).toHaveLength(2);
    await expect(
      canvas.queryByRole("textbox", { name: /^Pattern/ }),
    ).toBeNull();
    await expect(canvas.queryByRole("combobox")).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: /^(Move|Remove|Add)/ }),
    ).toBeNull();
    await expect(
      canvas.getByText(/A reader key reads the routes but cannot change them/),
    ).toBeVisible();
  },
};

const whichPool = (canvas: Canvas) =>
  canvas.findByRole("region", { name: "Which pool would a project bill?" });

export const WhichPoolByARoute: Story = {
  ...page("/settings/routes?project=acme%2Fapi", answers),
  ...desk,
  play: async ({ canvas }) => {
    const panel = within(await whichPool(canvas));
    await expect(panel.getByRole("textbox", { name: "Project" })).toHaveValue(
      "acme/api",
    );
    await expect(
      await panel.findByText(
        "Route 1, acme/*, is the first to match “acme/api”.",
      ),
    ).toBeVisible();
    await expect(panel.getByText("studio")).toBeVisible();
  },
};

export const WhichPoolByTheDefault: Story = {
  ...page("/settings/routes?project=scratch", answers),
  ...desk,
  play: async ({ canvas }) => {
    const panel = within(await whichPool(canvas));
    await expect(
      await panel.findByText(
        "No route matches “scratch”, so the default pool answers.",
      ),
    ).toBeVisible();
    await expect(panel.getByText("Solo plan")).toBeVisible();
  },
};

export const WhichPoolWithNoRoute: Story = {
  ...page("/settings/routes?client=codex&project=scratch", answers),
  ...desk,
  play: async ({ canvas }) => {
    const panel = within(await whichPool(canvas));
    await expect(
      await panel.findByText(
        "No route of Codex matches “scratch”, and Codex has no default pool: a launch there stops.",
      ),
    ).toBeVisible();
  },
};

export const WhichPoolWhenItsPoolIsGone: Story = {
  ...page("/settings/routes?project=legacy%2Fbilling", answers),
  ...desk,
  play: async ({ canvas }) => {
    const panel = within(await whichPool(canvas));
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      /names a pool Claude Code cannot bill now/,
    );
    await expect(
      panel.getByText(
        /names the pool retired, which is not in the configuration/,
      ),
    ).toBeVisible();
  },
};

export const AskingWhichPool: Story = {
  ...page("/settings/routes", answers),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    const panel = within(await whichPool(canvas));
    await expect(
      panel.getByText(/^Name a project as a launch reads it/),
    ).toBeVisible();
    await userEvent.type(
      panel.getByRole("textbox", { name: "Project" }),
      " acme/api {Enter}",
    );
    await expect(
      await panel.findByText(
        "Route 1, acme/*, is the first to match “acme/api”.",
      ),
    ).toBeVisible();
    await expect(locationShown().search).toEqual({ project: "acme/api" });
  },
};

export const AskingWhileEdited: Story = {
  ...page("/settings/routes?project=acme%2Fapi", answers),
  ...desk,
  play: async ({ canvas, userEvent }) => {
    await list(canvas);
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove route 1" }),
    );
    const panel = within(await whichPool(canvas));
    await expect(
      panel.getByText(/from the routes as saved, not the edit above\.$/),
    ).toBeVisible();
  },
};
