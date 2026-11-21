import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Input } from "./input.tsx";
import { ListPanel, ListPanelBody } from "./list-panel.tsx";
import { PoolMark } from "./pool-mark.tsx";
import { RouteFields, RouteFieldsHead } from "./route-fields.tsx";
import { Select } from "./select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "./table.tsx";

const meta = {
  title: "Components/RouteFields",
  component: RouteFields,
} satisfies Meta<typeof RouteFields>;

export default meta;
type Story = StoryObj<typeof meta>;

const routes = [
  { pattern: "acme/*", pool: "Work plan", hue: 1 },
  { pattern: "notes", pool: "Personal", hue: 2 },
] as const;

function Routes({ edited }: { edited: boolean }) {
  return (
    <ListPanel aria-label="Routes">
      <ListPanelBody>
        <Table aria-label="Routes">
          <TableHeader from="md">
            <TableRow>
              <TableHead scope="col">
                <RouteFieldsHead match="Project pattern" target="Pool" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route, index) => (
              <TableRow key={route.pattern}>
                <TableCell className="w-full max-w-0">
                  <RouteFields
                    match={
                      edited ? (
                        <Input
                          aria-label={`Pattern of route ${index + 1}`}
                          defaultValue={route.pattern}
                        />
                      ) : (
                        <TableLabel>
                          <code>{route.pattern}</code>
                        </TableLabel>
                      )
                    }
                    target={
                      edited ? (
                        <Select
                          label={`Pool of route ${index + 1}`}
                          size="field"
                          className="w-full"
                          value={route.pool}
                          options={routes.map((each) => ({
                            value: each.pool,
                            label: each.pool,
                            mark: <PoolMark hue={each.hue} name={each.pool} />,
                          }))}
                          onValueChange={() => {}}
                        />
                      ) : (
                        <span className="flex min-w-0 items-center gap-1.75">
                          <PoolMark hue={route.hue} name={route.pool} />
                          <TableLabel>{route.pool}</TableLabel>
                        </span>
                      )
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListPanelBody>
    </ListPanel>
  );
}

/** Routes as words: a pattern, an arrow and a pool. */
export const AsWords: Story = {
  args: { match: null, target: null },
  render: () => <Routes edited={false} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("acme/*")).toBeVisible();
    await expect(canvas.getByText("Work plan")).toBeVisible();
  },
};

/** Routes edited in place: a field, an arrow and a select. */
export const AsFields: Story = {
  args: { match: null, target: null },
  render: () => <Routes edited />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("textbox", { name: "Pattern of route 1" }),
    ).toHaveValue("acme/*");
    await expect(
      canvas.getByRole("combobox", { name: "Pool of route 2" }),
    ).toHaveTextContent("Personal");
  },
};

export const Narrow: Story = {
  args: { match: null, target: null },
  render: () => <Routes edited />,
  globals: { viewport: { value: "mobile2" } },
};
