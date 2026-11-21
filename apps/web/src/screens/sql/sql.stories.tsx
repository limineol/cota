import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor, within } from "storybook/test";
import { locationShown, page } from "#stories/page.tsx";
import {
  answersOnly,
  beforeRun,
  emptyRun,
  failedRun,
  formatRefused,
  misspelledSql,
  mixedRun,
  mixedSql,
  running,
  schemaFailed,
  truncatedRun,
  unavailable,
} from "#stories/sql.ts";
import { draftKey, historyKey } from "./kept.ts";

const forget = () => {
  localStorage.removeItem(draftKey);
  localStorage.removeItem(historyKey);
};

const meta = {
  title: "Screens/SQL",
  beforeEach: () => {
    forget();
    return forget;
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const linked = (sql: string) => `/sql?q=${encodeURIComponent(sql)}`;

const draft = (sql: string) => () => {
  localStorage.setItem(draftKey, sql);
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

export const BeforeARun: Story = {
  ...page("/sql", beforeRun),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: "Columns of requests" }),
    ).toBeVisible();
    const editor = canvas.getByRole("textbox", { name: "SQL" });
    await expect(
      editor instanceof HTMLTextAreaElement ? editor.value : "",
    ).toMatch(/^SELECT started_at/);
    await expect(
      canvas.getByText("Run the query to see its rows here."),
    ).toBeVisible();
  },
};

export const MixedValues: Story = {
  ...page(linked(mixedSql), mixedRun),
  play: async ({ canvas }) => {
    const grid = await canvas.findByRole("grid", { name: "The answer" });
    await expect(grid).toHaveAttribute("aria-rowcount", "5");
    await expect(within(grid).getAllByText("null")).toHaveLength(1);
    await expect(
      within(grid).getByText("NULL", { selector: "td" }),
    ).toBeVisible();
    await expect(within(grid).getAllByText("empty string")).toHaveLength(2);
    await expect(within(grid).getByText("1290")).toBeVisible();
  },
};

export const FiveThousandRowsCut: Story = {
  ...page(
    linked("SELECT * FROM requests ORDER BY started_at DESC"),
    truncatedRun,
  ),
  play: async ({ canvas }) => {
    const grid = await canvas.findByRole("grid", { name: "The answer" });
    await expect(grid).toHaveAttribute("aria-rowcount", "5001");
    await expect(within(grid).getAllByRole("row").length).toBeLessThan(60);
    await expect(
      canvas.getByText(/The hub cut the answer at its limit/),
    ).toBeVisible();
    await expect(canvas.getByText("1.84 s")).toBeVisible();
  },
};

export const NoRows: Story = {
  ...page(
    linked("SELECT session, title, reported_at FROM session_titles WHERE 0"),
    emptyRun,
  ),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The query answered no rows."),
    ).toBeVisible();
    await expect(canvas.getByText("12 ms")).toBeVisible();
  },
};

export const QueryFailed: Story = {
  ...page(linked(misspelledSql), failedRun),
  play: async ({ canvas, userEvent }) => {
    const alert = await canvas.findByRole("alert");
    await expect(within(alert).getByText("SYNTAX_ERROR")).toBeVisible();
    await expect(alert).toHaveTextContent(/at line 2, column 1\./);
    await expect(alert).not.toHaveTextContent(/Code: 62/);
    await userEvent.click(
      within(alert).getByRole("button", { name: "Show in the editor" }),
    );
    const editor = canvas.getByRole("textbox", { name: "SQL" });
    await expect(editor).toHaveFocus();
    await expect(
      editor instanceof HTMLTextAreaElement ? editor.selectionStart : -1,
    ).toBe(misspelledSql.indexOf("FORM"));
  },
};

export const FormatRefused: Story = {
  ...page(linked("SELECT pool FROM requests FORMAT CSV"), formatRefused),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("The query names its own format"),
    ).toBeVisible();
  },
};

export const SqlUnavailable: Story = {
  ...page(linked("SELECT 1"), unavailable),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("SQL is unavailable on this hub"),
    ).toBeVisible();
    await expect(
      await canvas.findByText(/its tables cannot be read/),
    ).toBeVisible();
    await expect(canvas.getByText(/ACCESS_DENIED/)).toBeVisible();
  },
};

export const ARunInProgress: Story = {
  ...page(linked("SELECT count() FROM items"), running),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: /Running/ }),
    ).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeVisible();
  },
};

export const ARunCancelled: Story = {
  ...page(linked("SELECT count() FROM items"), running),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Cancel" }),
    );
    await expect(
      await canvas.findByText(/The run was cancelled after/),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Run/ })).toBeEnabled();
  },
};

export const SchemaFailedEditorWorks: Story = {
  ...page("/sql", schemaFailed),
  beforeEach: draft(mixedSql),
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText(/The hub could not read the tables/),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /^Run/ }));
    await expect(
      await canvas.findByRole("grid", { name: "The answer" }),
    ).toBeVisible();
  },
};

export const SchemaFiltered: Story = {
  ...page("/sql", beforeRun),
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", {
        name: "Filter tables and columns",
      }),
      "token",
    );
    const tables = canvas.getByRole("list", { name: "Tables" });
    await expect(
      within(tables).getByRole("button", { name: /^output_tokens/ }),
    ).toBeVisible();
    await expect(
      within(tables).queryByRole("button", { name: /^duration_ms/ }),
    ).toBeNull();
    await expect(
      within(tables).queryByRole("button", { name: "Columns of items" }),
    ).toBeNull();
  },
};

export const ACellInspected: Story = {
  ...page(linked(mixedSql), mixedRun),
  play: async ({ canvas, userEvent }) => {
    const grid = await canvas.findByRole("grid", { name: "The answer" });
    const [usage] = within(grid).getAllByText(/^\{"input_tokens":1204/);
    if (usage === undefined) throw new Error("No usage cell was drawn.");
    await userEvent.click(usage);
    const inspector = canvas.getByRole("region", {
      name: "The value inspected",
    });
    await expect(
      within(inspector).getByText('"cache_read_input_tokens"'),
    ).toBeVisible();
  },
};

export const TypingAndTheShortcutAsk: Story = {
  ...page("/sql", answersOnly("SELECT pool FROM requests")),
  play: async ({ canvas, userEvent }) => {
    const editor = await canvas.findByRole("textbox", { name: "SQL" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "SELECT pool FROM requests");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(
      await canvas.findByRole("grid", { name: "The answer" }),
    ).toBeVisible();
  },
};

const twoQueries = `SELECT count() FROM requests

SELECT pool, count() FROM requests GROUP BY pool`;

export const ASelectionRunsAlone: Story = {
  ...page(
    "/sql",
    answersOnly("SELECT pool, count() FROM requests GROUP BY pool"),
  ),
  beforeEach: draft(twoQueries),
  play: async ({ canvas, userEvent }) => {
    const editor = await canvas.findByRole("textbox", { name: "SQL" });
    if (!(editor instanceof HTMLTextAreaElement)) throw new Error("No editor");
    editor.focus();
    editor.setSelectionRange(
      twoQueries.lastIndexOf("SELECT"),
      twoQueries.length,
    );
    document.dispatchEvent(new Event("selectionchange"));
    await expect(
      await canvas.findByRole("button", { name: /^Run selection/ }),
    ).toBeVisible();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(
      await canvas.findByRole("grid", { name: "The answer" }),
    ).toBeVisible();
  },
};

export const AClickInTheSchemaInserts: Story = {
  ...page("/sql", beforeRun),
  beforeEach: draft("SELECT  FROM requests"),
  play: async ({ canvas, userEvent }) => {
    const editor = await canvas.findByRole("textbox", { name: "SQL" });
    if (!(editor instanceof HTMLTextAreaElement)) throw new Error("No editor");
    editor.focus();
    editor.setSelectionRange(7, 7);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Columns of requests" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: /^pool/ }));
    await expect(editor).toHaveValue("SELECT pool FROM requests");
    await expect(editor).toHaveFocus();
  },
};

export const TheUrlHoldsTheQuery: Story = {
  ...page("/sql", answersOnly("SELECT pool FROM requests")),
  beforeEach: draft("SELECT pool FROM requests"),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^Run/ }));
    await canvas.findByRole("grid", { name: "The answer" });
    await waitFor(() =>
      expect(locationShown().search).toEqual({
        q: "SELECT pool FROM requests",
      }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "History" }));
    await expect(
      await screen.findByRole("menuitem", {
        name: /SELECT pool FROM requests/,
      }),
    ).toHaveTextContent(/4 rows · 84 ms/);
  },
};

export const Phone: Story = {
  ...page(linked(mixedSql), mixedRun),
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("button", { name: "Schema" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    await expect(
      await canvas.findByRole("button", { name: "Columns of requests" }),
    ).toBeVisible();
  },
};

export const Wide: Story = {
  ...page(linked(mixedSql), mixedRun),
  parameters: wide,
  globals: { viewport: { value: "wide" } },
};
