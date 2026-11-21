import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { SessionSnippet, SessionTitle, SnippetMark } from "./session-table.tsx";
import { Table, TableBody, TableCell, TableLabel, TableRow } from "./table.tsx";

function Titles() {
  return (
    <div className="max-w-2xl rounded-card border bg-surface p-5">
      <Table aria-label="Sessions">
        <TableBody linked>
          <TableRow>
            <TableCell>
              <TableLabel render={<a href="#title" />}>
                <SessionTitle>
                  Fix the relay hang when a stream ends early
                </SessionTitle>
              </TableLabel>
            </TableCell>
          </TableRow>
          <SessionSnippet columns={1}>
            …the <SnippetMark>relay</SnippetMark> waits for an event that never
            comes, so the request <SnippetMark>hangs</SnippetMark> until the
            client gives up.
          </SessionSnippet>
        </TableBody>
        <TableBody linked>
          <TableRow>
            <TableCell>
              <TableLabel render={<a href="#prompt" />}>
                <SessionTitle kind="prompt">
                  bump effect to 4.1.4 everywhere and run the gates
                </SessionTitle>
              </TableLabel>
            </TableCell>
          </TableRow>
        </TableBody>
        <TableBody linked>
          <TableRow>
            <TableCell>
              <TableLabel render={<a href="#none" />}>
                <SessionTitle kind="none">
                  A request without a session
                </SessionTitle>
              </TableLabel>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

const meta = {
  title: "Components/SessionTable",
  component: Titles,
} satisfies Meta<typeof Titles>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitlesAndASnippet: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("link")).toHaveLength(3);
    await expect(
      canvas.getAllByText("relay", { selector: "mark" }),
    ).toHaveLength(1);
  },
};
