import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "./button.tsx";
import { Confirm } from "./confirm.tsx";
import { ListPanel, ListPanelBody } from "./list-panel.tsx";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "./table.tsx";
import { TableItem, TableMore } from "./table-more.tsx";

const meta = {
  title: "Components/TableMore",
  component: TableMore,
  args: { columns: 3, children: null },
} satisfies Meta<typeof TableMore>;

export default meta;
type Story = StoryObj<typeof meta>;

const pools = [
  { id: "solo", state: "Kept" },
  { id: "studio", state: "None" },
  { id: "spare", state: "Expired" },
];

export const AQuestionUnderItsRow: Story = {
  render: () => (
    <ListPanel aria-label="Quota logins">
      <ListPanelBody>
        <Table aria-label="Quota logins">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Pool</TableHead>
              <TableHead scope="col">Quota login</TableHead>
              <TableHead scope="col" numeric>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {pools.map((pool) => (
            <TableItem key={pool.id}>
              <TableRow>
                <TableCell>
                  <TableLabel>{pool.id}</TableLabel>
                </TableCell>
                <TableCell>{pool.state}</TableCell>
                <TableCell numeric>
                  {pool.id === "solo" ? null : (
                    <Button variant="outline" size="sm">
                      Forget
                    </Button>
                  )}
                </TableCell>
              </TableRow>
              {pool.id === "solo" ? (
                <TableMore columns={3}>
                  <Confirm
                    question="Forget the quota login of solo?"
                    confirm="Forget it"
                    cancel="Keep it"
                    onConfirm={() => {}}
                    onCancel={() => {}}
                  />
                </TableMore>
              ) : null}
            </TableItem>
          ))}
        </Table>
      </ListPanelBody>
    </ListPanel>
  ),
  play: async ({ canvas }) => {
    const question = canvas.getByRole("group", {
      name: "Forget the quota login of solo?",
    });
    const more = question.closest("tr");
    const row = more?.previousElementSibling;
    await expect(row).toHaveTextContent("solo");
    const cell = row?.querySelector("td");
    await expect(
      cell === null || cell === undefined
        ? null
        : getComputedStyle(cell).borderBottomWidth,
    ).toBe("0px");
  },
};
