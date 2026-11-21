import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";
import type { Hue } from "#lib/hue.ts";
import {
  ErrorCauseDetail,
  ErrorCauseFact,
  ErrorCauseFacts,
  ErrorCauseLatest,
  ErrorCauseTitle,
  ErrorCauseValue,
} from "./error-cause.tsx";
import { PoolMark } from "./pool-mark.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSecondary,
} from "./table.tsx";

interface Shape {
  readonly id: string;
  readonly headline: string;
  readonly message?: string;
  readonly provider: string;
  readonly model: string;
  readonly status: string;
  readonly type?: string;
  readonly pools: ReadonlyArray<{ readonly name: string; readonly hue: Hue }>;
  readonly clients: ReadonlyArray<string>;
  readonly requests: string;
  readonly first: string;
  readonly last: string;
}

const causes: ReadonlyArray<Shape> = [
  {
    id: "a",
    headline: "Overloaded",
    provider: "anthropic",
    model: "Claude Opus 4.5",
    status: "529",
    type: "overloaded_error",
    pools: [
      { name: "personal", hue: 1 },
      { name: "work", hue: 2 },
    ],
    clients: ["Claude Code"],
    requests: "212",
    first: "6d ago",
    last: "4m ago",
  },
  {
    id: "b",
    headline:
      "messages.12.content.0: unexpected `tool_use_id` found in `tool_result` blocks: toolu_01Q. Each `tool_result` block must have a corresponding `tool_use` block in the previous message.",
    message:
      '{"type":"error","error":{"type":"invalid_request_error","message":"messages.12.content.0: unexpected `tool_use_id` found in `tool_result` blocks: toolu_01Q. Each `tool_result` block must have a corresponding `tool_use` block in the previous message."}}',
    provider: "anthropic",
    model: "Claude Sonnet 4.5",
    status: "400",
    type: "invalid_request_error",
    pools: [{ name: "work", hue: 2 }],
    clients: ["Claude Code", "opencode"],
    requests: "3",
    first: "2d ago",
    last: "1h ago",
  },
  {
    id: "c",
    headline: "The provider did not answer within 600 seconds.",
    provider: "openai",
    model: "gpt-5-codex",
    status: "no status",
    pools: [{ name: "codex", hue: 3 }],
    clients: ["Codex"],
    requests: "1",
    first: "3h ago",
    last: "3h ago",
  },
];

function Cause({ cause }: { cause: Shape }) {
  const [open, setOpen] = useState(false);
  return (
    <TableRow>
      <TableCell className="w-full max-w-0 align-top">
        <ErrorCauseTitle
          {...(cause.message === undefined
            ? {}
            : { open, onClick: () => setOpen(!open) })}
        >
          {cause.headline}
        </ErrorCauseTitle>
        <ErrorCauseFacts>
          <ErrorCauseValue>{cause.provider}</ErrorCauseValue>
          <ErrorCauseValue>{cause.model}</ErrorCauseValue>
          <ErrorCauseFact>{cause.status}</ErrorCauseFact>
          {cause.type === undefined ? null : (
            <ErrorCauseFact>{cause.type}</ErrorCauseFact>
          )}
        </ErrorCauseFacts>
        {open && cause.message !== undefined ? (
          <ErrorCauseDetail>
            <pre className="m-0 font-mono text-sm break-words whitespace-pre-wrap text-text-2">
              {cause.message}
            </pre>
          </ErrorCauseDetail>
        ) : null}
      </TableCell>
      <TableCell className="align-top">
        <span className="flex flex-wrap gap-x-3 text-text">
          {cause.pools.map((pool) => (
            <ErrorCauseValue
              key={pool.name}
              mark={<PoolMark hue={pool.hue} name={pool.name} />}
            >
              {pool.name}
            </ErrorCauseValue>
          ))}
        </span>
        <TableSecondary>
          <span className="flex flex-wrap gap-x-3">
            {cause.clients.map((client) => (
              <ErrorCauseValue key={client}>{client}</ErrorCauseValue>
            ))}
          </span>
        </TableSecondary>
      </TableCell>
      <TableCell numeric className="align-top">
        {cause.requests}
      </TableCell>
      <TableCell numeric className="align-top">
        {cause.last}
      </TableCell>
      <TableCell className="align-top">
        <ErrorCauseLatest render={<a href={`#${cause.id}`} />} />
      </TableCell>
    </TableRow>
  );
}

function List() {
  return (
    <div className="max-w-4xl rounded-card border bg-surface p-5">
      <Table aria-label="Causes">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Cause</TableHead>
            <TableHead scope="col">Where</TableHead>
            <TableHead scope="col" numeric>
              Requests
            </TableHead>
            <TableHead scope="col" numeric>
              Last seen
            </TableHead>
            <TableHead scope="col">
              <span className="sr-only">Latest request</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {causes.map((cause) => (
            <Cause key={cause.id} cause={cause} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const meta = {
  title: "Components/ErrorCause",
  component: List,
} satisfies Meta<typeof List>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Causes: Story = {
  play: async ({ canvas, userEvent }) => {
    const title = canvas.getByRole("button", { name: /^messages\.12/ });
    await expect(title).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(title);
    await expect(title).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/"invalid_request_error"/)).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Overloaded" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getAllByRole("link", { name: "Latest request" })[0],
    ).toHaveAttribute("href", "#a");
  },
};
