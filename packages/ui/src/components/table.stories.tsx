import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { MagnitudeBar } from "./magnitude-bar.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableFlag,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "./table.tsx";

const rows = [
  { key: "acme/shop", requests: "2,140", tokens: "88.2M", errors: 3, f: 1 },
  { key: "cota", requests: "1,302", tokens: "41.9M", errors: 0, f: 0.48 },
  { key: "notes", requests: "418", tokens: "6.1M", errors: 0, f: 0.07 },
  { key: "dotfiles", requests: "12", tokens: "88K", errors: 1, f: 0.001 },
];

const meta = {
  title: "Components/Table",
  component: Table,
  decorators: [
    (Story) => (
      <div className="max-w-xl rounded-card border bg-surface p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Breakdown: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Project</TableHead>
          <TableHead scope="col" numeric>
            Requests
          </TableHead>
          <TableHead scope="col" numeric wide>
            Sessions
          </TableHead>
          <TableHead scope="col" numeric>
            Tokens
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="w-full max-w-0">
              <span className="flex items-center gap-1.75">
                <TableLabel>{row.key}</TableLabel>
                {row.errors > 0 ? (
                  <TableFlag>{row.errors} errors</TableFlag>
                ) : null}
              </span>
              <MagnitudeBar fraction={row.f} className="mt-1.25 max-w-55" />
            </TableCell>
            <TableCell numeric>{row.requests}</TableCell>
            <TableCell numeric wide>
              12
            </TableCell>
            <TableCell numeric>{row.tokens}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("row")).toHaveLength(5);
    await expect(
      canvas.getByRole("columnheader", { name: "Tokens" }),
    ).toBeVisible();
  },
};
