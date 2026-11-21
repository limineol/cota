import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { Button } from "./button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "./empty.tsx";
import { FilterMenu, FilterMenuItem } from "./filter-menu.tsx";
import { Input } from "./input.tsx";
import { Label } from "./label.tsx";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFoot,
  ListPanelHead,
  ListPanelInset,
} from "./list-panel.tsx";
import { Note } from "./note.tsx";
import { Subheading } from "./page.tsx";
import {
  Pager,
  PagerControls,
  PagerCount,
  PagerPage,
  PagerStep,
} from "./pager.tsx";
import { PoolMark } from "./pool-mark.tsx";
import { SearchField } from "./search-field.tsx";
import { SessionSnippet, SessionTitle, SnippetMark } from "./session-table.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableFlag,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
  TableSecondary,
  TableSort,
} from "./table.tsx";

type Sort = "ended" | "tokens";

const sessions = [
  {
    id: "a",
    title: "Fix the relay hang when a stream ends early",
    prompt: "The relay hangs when the provider closes the stream early.",
    errors: 1,
    pool: "Personal plan",
    hue: 1,
    project: "acme/shop",
    ended: "3m ago",
    endedAt: 3,
    tokens: "72K",
    tokenCount: 72_000,
    snippet: true,
  },
  {
    id: "b",
    title: null,
    prompt: "bump effect to 4.1.4 everywhere and run the gates",
    errors: 0,
    pool: "work",
    hue: 2,
    project: "cota",
    ended: "1h 54m ago",
    endedAt: 114,
    tokens: "4.4M",
    tokenCount: 4_400_000,
    snippet: false,
  },
] as const;

function Sessions({ empty = false }: { empty?: boolean }) {
  const [sort, setSort] = useState<Sort>("ended");
  const [pools, setPools] = useState<ReadonlyArray<string>>([]);
  const rows = sessions.toSorted((a, b) =>
    sort === "ended" ? a.endedAt - b.endedAt : b.tokenCount - a.tokenCount,
  );
  const head = (by: Sort, label: string) => {
    const sorted = by === sort ? "descending" : undefined;
    return (
      <TableHead scope="col" numeric sorted={sorted}>
        <TableSort numeric sorted={sorted} onClick={() => setSort(by)}>
          {label}
        </TableSort>
      </TableHead>
    );
  };
  return (
    <ListPanel aria-label="Sessions" className="max-w-4xl">
      <ListPanelHead>
        <SearchField
          aria-label="Search the sessions"
          placeholder="Search prompts, replies and tool output"
          onSubmit={() => undefined}
          className="w-72"
        />
        <FilterMenu label="Pool" chosen={pools}>
          {sessions.map((row) => (
            <FilterMenuItem
              key={row.pool}
              checked={pools.includes(row.pool)}
              onCheckedChange={(on) =>
                setPools(
                  on
                    ? [...pools, row.pool]
                    : pools.filter((each) => each !== row.pool),
                )
              }
              mark={<PoolMark hue={row.hue} name={row.pool} />}
              count={row.hue * 40}
              fraction={row.hue / 2}
            >
              {row.pool}
            </FilterMenuItem>
          ))}
        </FilterMenu>
        <FilterMenu label="Project">
          <FilterMenuItem checked={false} onCheckedChange={() => undefined}>
            cota
          </FilterMenuItem>
        </FilterMenu>
        {pools.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setPools([])}>
            Reset <X aria-hidden="true" />
          </Button>
        ) : null}
      </ListPanelHead>
      <ListPanelBody>
        {empty ? (
          <Empty>
            <EmptyTitle>No sessions match.</EmptyTitle>
            <EmptyDescription>Try fewer filters.</EmptyDescription>
          </Empty>
        ) : (
          <Table aria-label="Sessions">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Session</TableHead>
                <TableHead scope="col" from="md">
                  Pool
                </TableHead>
                {head("ended", "Ended")}
                {head("tokens", "Tokens")}
              </TableRow>
            </TableHeader>
            {rows.map((row) => (
              <TableBody key={row.id} linked>
                <TableRow>
                  <TableCell className="w-full max-w-0">
                    <span className="flex min-w-0 items-center gap-1.75">
                      <TableLabel render={<a href={`#${row.id}`} />}>
                        {row.title === null ? (
                          <SessionTitle kind="prompt">
                            {row.prompt}
                          </SessionTitle>
                        ) : (
                          <SessionTitle>{row.title}</SessionTitle>
                        )}
                      </TableLabel>
                      {row.errors > 0 ? (
                        <TableFlag>{row.errors} error</TableFlag>
                      ) : null}
                    </span>
                    {row.title === null ? null : (
                      <TableSecondary>{row.prompt}</TableSecondary>
                    )}
                  </TableCell>
                  <TableCell from="md">
                    <span className="flex items-center gap-1.5 text-text">
                      <PoolMark hue={row.hue} name={row.pool} />
                      {row.pool}
                    </span>
                    <TableSecondary>{row.project}</TableSecondary>
                  </TableCell>
                  <TableCell numeric>{row.ended}</TableCell>
                  <TableCell numeric>{row.tokens}</TableCell>
                </TableRow>
                {row.snippet ? (
                  <SessionSnippet columns={4}>
                    …when the provider closes the stream early the{" "}
                    <SnippetMark>relay</SnippetMark> waits for an event that
                    never comes.
                  </SessionSnippet>
                ) : null}
              </TableBody>
            ))}
          </Table>
        )}
      </ListPanelBody>
      {empty ? null : (
        <ListPanelFoot>
          <Pager aria-label="Pages">
            <PagerCount>1–2 of 1,284</PagerCount>
            <PagerControls>
              <PagerPage>Page 1 of 642</PagerPage>
              <PagerStep disabled>
                <ChevronLeft /> Newer
              </PagerStep>
              <PagerStep href="#older">
                Older <ChevronRight />
              </PagerStep>
            </PagerControls>
          </Pager>
        </ListPanelFoot>
      )}
    </ListPanel>
  );
}

const meta = {
  title: "Components/ListPanel",
  component: Sessions,
} satisfies Meta<typeof Sessions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ATableOfSessions: Story = {
  play: async ({ canvas, userEvent }) => {
    const table = canvas.getByRole("table", { name: "Sessions" });
    const links = within(table).getAllByRole("link");
    await expect(links).toHaveLength(2);
    await expect(links[0]).toHaveAccessibleName(
      "Fix the relay hang when a stream ends early",
    );
    await expect(
      canvas.getByRole("columnheader", { name: "Ended" }),
    ).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(canvas.getByRole("button", { name: "Tokens" }));
    await expect(
      canvas.getByRole("columnheader", { name: "Tokens" }),
    ).toHaveAttribute("aria-sort", "descending");
    await expect(
      canvas.getByRole("columnheader", { name: "Ended" }),
    ).not.toHaveAttribute("aria-sort");
    await expect(within(table).getAllByRole("link")[0]).toHaveAccessibleName(
      /^bump effect/,
    );
  },
};

export const NothingListed: Story = { args: { empty: true } };

export const AHeadAlone: Story = {
  render: () => (
    <ListPanel aria-labelledby="owner-password">
      <ListPanelHead alone className="items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Subheading level={2} id="owner-password">
            Owner password
          </Subheading>
          <Note>Kept in this hub, set Nov 11 14:05.</Note>
        </div>
        <Button variant="outline" size="sm">
          Change
        </Button>
      </ListPanelHead>
    </ListPanel>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("region", { name: "Owner password" }),
    ).toBeVisible();
  },
};

export const AFormInPlace: Story = {
  render: () => (
    <ListPanel aria-labelledby="owner-password">
      <ListPanelHead>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Subheading level={2} id="owner-password">
            Owner password
          </Subheading>
          <Note>Kept in this hub, set Nov 11 14:05.</Note>
        </div>
      </ListPanelHead>
      <ListPanelInset>
        <form className="flex max-w-md flex-col gap-1.5">
          <Label htmlFor="current">Current password</Label>
          <Input id="current" type="password" />
        </form>
      </ListPanelInset>
    </ListPanel>
  ),
};
