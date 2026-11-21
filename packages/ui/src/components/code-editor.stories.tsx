import type { Meta, StoryObj } from "@storybook/react-vite";
import { Play } from "lucide-react";
import { useState } from "react";
import { expect, fn } from "storybook/test";
import { Button } from "./button.tsx";
import {
  CodeEditor,
  CodeEditorBar,
  CodeEditorPanel,
  CodeEditorStatus,
  type CodePiece,
  Kbd,
} from "./code-editor.tsx";

const keywords = new Set(["select", "from", "where", "group", "by", "order"]);

/** A rough cut for the story alone; the dashboard cuts SQL with its own rule (V31). */
const piecesOf = (text: string): ReadonlyArray<CodePiece> =>
  text
    .split(/(\s+|'[^']*'?|--[^\n]*|\d+|[(),=*])/)
    .filter((piece) => piece !== "")
    .map((piece) => {
      if (/^\s+$/.test(piece)) return { kind: "space", text: piece };
      if (piece.startsWith("--")) return { kind: "comment", text: piece };
      if (piece.startsWith("'")) return { kind: "string", text: piece };
      if (/^\d+$/.test(piece)) return { kind: "number", text: piece };
      if (/^[(),=*]$/.test(piece)) return { kind: "punctuation", text: piece };
      return {
        kind: keywords.has(piece.toLowerCase()) ? "keyword" : "name",
        text: piece,
      };
    });

const sql = `-- Requests by pool, today
SELECT pool, count() AS requests
FROM requests
WHERE started_at > today() AND outcome = 'error'
GROUP BY pool
ORDER BY requests DESC`;

function Editor({
  initial,
  onRun,
}: {
  initial: string;
  onRun: (sql: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CodeEditorPanel className="max-w-3xl">
      <CodeEditor
        aria-label="SQL"
        value={value}
        pieces={piecesOf(value)}
        onValueChange={setValue}
        onRun={() => onRun(value)}
      />
      <CodeEditorBar>
        <Button size="sm" onClick={() => onRun(value)}>
          <Play aria-hidden="true" />
          Run <Kbd>⌘↵</Kbd>
        </Button>
        <CodeEditorStatus>{value.split("\n").length} lines</CodeEditorStatus>
      </CodeEditorBar>
    </CodeEditorPanel>
  );
}

const meta = {
  title: "Components/CodeEditor",
  component: Editor,
  args: { initial: sql, onRun: fn() },
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Query: Story = {};

export const TabIndentsAndTheShortcutRuns: Story = {
  args: { initial: "SELECT 1" },
  play: async ({ args, canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "SQL" });
    await userEvent.click(editor);
    await userEvent.keyboard("{End}{Enter}{Tab}FROM numbers(3)");
    await expect(editor).toHaveValue("SELECT 1\n  FROM numbers(3)");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(args.onRun).toHaveBeenCalledWith(
      "SELECT 1\n  FROM numbers(3)",
    );
  },
};

export const EscapeLetsTabLeave: Story = {
  args: { initial: "SELECT 1" },
  play: async ({ canvas, userEvent }) => {
    const editor = canvas.getByRole("textbox", { name: "SQL" });
    await userEvent.click(editor);
    await userEvent.keyboard("{Escape}{Tab}");
    await expect(editor).not.toHaveFocus();
    await expect(editor).toHaveValue("SELECT 1");
    await expect(canvas.getByRole("button", { name: /Run/ })).toHaveFocus();
  },
};

export const ManyLines: Story = {
  args: {
    initial: Array.from(
      { length: 40 },
      (_, line) =>
        `SELECT ${line} AS line, 'a string that runs on past the edge of the editor, to be scrolled sideways' AS text`,
    ).join("\nUNION ALL\n"),
  },
};
