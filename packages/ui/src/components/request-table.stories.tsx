import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ListPanel, ListPanelBody } from "./list-panel.tsx";
import { RequestEnded, RequestRole } from "./request-table.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "./table.tsx";

const requests = [
  {
    id: "a",
    time: "14:02:31",
    role: "Main",
    main: true,
    prompt: "182.4K",
    ended: <RequestEnded tone="unseen">answered</RequestEnded>,
  },
  {
    id: "b",
    time: "14:02:12",
    role: "Utility",
    main: false,
    prompt: "1.2K",
    ended: <RequestEnded>refused</RequestEnded>,
  },
  {
    id: "c",
    time: "14:01:58",
    role: "Main",
    main: true,
    prompt: "181.9K",
    ended: <RequestEnded tone="danger">error 529</RequestEnded>,
  },
  {
    id: "d",
    time: "14:01:40",
    role: "Subagent",
    main: false,
    prompt: "24.8K",
    ended: <RequestEnded>cancelled</RequestEnded>,
  },
];

function Requests() {
  return (
    <ListPanel className="max-w-2xl">
      <ListPanelBody>
        <Table aria-label="Requests, newest first">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Time</TableHead>
              <TableHead scope="col">Role</TableHead>
              <TableHead scope="col" numeric>
                Prompt
              </TableHead>
              <TableHead scope="col" numeric>
                Ended
              </TableHead>
            </TableRow>
          </TableHeader>
          {requests.map((request) => (
            <TableBody key={request.id} linked marked={request.id === "c"}>
              <TableRow>
                <TableCell>
                  <TableLabel render={<a href={`#${request.id}`} />}>
                    {request.time}
                  </TableLabel>
                </TableCell>
                <TableCell>
                  <RequestRole main={request.main}>{request.role}</RequestRole>
                </TableCell>
                <TableCell numeric>{request.prompt}</TableCell>
                <TableCell numeric>{request.ended}</TableCell>
              </TableRow>
            </TableBody>
          ))}
        </Table>
      </ListPanelBody>
    </ListPanel>
  );
}

const meta = {
  title: "Components/RequestTable",
  component: Requests,
} satisfies Meta<typeof Requests>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RolesAndEnds: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("link")).toHaveLength(4);
    await expect(canvas.getByText("error 529")).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "14:01:58" }).closest("tbody"),
    ).toHaveAttribute("data-marked");
  },
};
