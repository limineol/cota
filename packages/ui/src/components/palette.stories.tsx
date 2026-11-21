import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  FolderGit2,
  MessagesSquare,
  Search,
  SquareTerminal,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { expect, screen, waitFor, within } from "storybook/test";
import { Button } from "./button.tsx";
import {
  Palette,
  PaletteField,
  PaletteFoot,
  PaletteGroup,
  PaletteItem,
  PaletteList,
  PaletteMark,
  PaletteNote,
  PaletteSnippet,
} from "./palette.tsx";
import { PoolMark } from "./pool-mark.tsx";
import { ProviderLogo } from "./provider-logo.tsx";

function Results() {
  return (
    <>
      <PaletteGroup label="Go to">
        <PaletteItem
          id="option-0"
          active
          href="#sessions"
          icon={<MessagesSquare />}
        >
          <PaletteMark>Se</PaletteMark>ssions
        </PaletteItem>
        <PaletteItem
          id="option-1"
          href="#settings"
          icon={<SquareTerminal />}
          detail="Settings"
        >
          Quota logins
        </PaletteItem>
      </PaletteGroup>
      <PaletteGroup label="Pools">
        <PaletteItem
          id="option-2"
          href="#personal"
          icon={
            <PoolMark
              hue={1}
              name="personal"
              glyph={<ProviderLogo logo="claude" />}
            />
          }
          detail="Overview"
        >
          Per<PaletteMark>se</PaletteMark>onal plan
        </PaletteItem>
      </PaletteGroup>
      <PaletteGroup label="Filter sessions by">
        <PaletteItem
          id="option-3"
          href="#project"
          icon={<FolderGit2 />}
          detail="Project"
        >
          <PaletteMark>se</PaletteMark>arch-index
        </PaletteItem>
      </PaletteGroup>
      <PaletteGroup label="Sessions">
        <PaletteItem
          id="option-4"
          href="#session"
          icon={
            <PoolMark
              hue={2}
              name="work"
              glyph={<ProviderLogo logo="claude" />}
            />
          }
          detail="3m ago"
          secondary={
            <PaletteSnippet>
              …the relay hangs when the provider closes the stream before the
              last event, and the <PaletteMark>session</PaletteMark> never ends
            </PaletteSnippet>
          }
        >
          Fix the relay hang when a stream ends early
        </PaletteItem>
        <PaletteItem id="option-5" href="#search" icon={<Search />}>
          Search sessions for “se”
        </PaletteItem>
      </PaletteGroup>
    </>
  );
}

function States() {
  return (
    <>
      <PaletteGroup label="Pools">
        <PaletteNote>Reading the pools…</PaletteNote>
      </PaletteGroup>
      <PaletteGroup label="Filter sessions by">
        <PaletteNote>The hub could not read the values.</PaletteNote>
      </PaletteGroup>
      <PaletteGroup label="Sessions">
        <PaletteNote>No session mentions “zzz” in the last 7 days.</PaletteNote>
      </PaletteGroup>
    </>
  );
}

function Demo({
  initiallyOpen,
  empty = false,
  children,
}: {
  initiallyOpen: boolean;
  empty?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Search /> Search
      </Button>
      <Palette open={open} onOpenChange={setOpen} label="Search">
        <PaletteField
          aria-label="Search"
          aria-controls="results"
          aria-expanded={!empty}
          {...(empty ? {} : { "aria-activedescendant": "option-0" })}
          placeholder="Go to a screen, a pool or a session"
          defaultValue="se"
        />
        <PaletteList id="results" aria-label="Results" empty={empty}>
          {children}
        </PaletteList>
        <PaletteFoot end={empty ? "No results" : "6 results"} />
      </Palette>
    </>
  );
}

const meta = {
  title: "Components/Palette",
  component: Demo,
  args: { initiallyOpen: true, children: <Results /> },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const list = within(dialog).getByRole("listbox", { name: "Results" });
    await expect(within(list).getAllByRole("option")).toHaveLength(6);
    await expect(
      within(list).getByRole("option", { selected: true }),
    ).toHaveTextContent("Sessions");
    await expect(
      within(list).getByRole("group", { name: "Pools" }),
    ).toBeVisible();
  },
};

export const GroupsWithoutResults: Story = {
  args: { children: <States />, empty: true },
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    await expect(within(dialog).queryAllByRole("option")).toEqual([]);
    await expect(within(dialog).getByText("Reading the pools…")).toBeVisible();
  },
};

export const ClosesOnEscape: Story = {
  args: { initiallyOpen: false },
  play: async ({ canvas, userEvent }) => {
    const opener = canvas.getByRole("button", { name: "Search" });
    await userEvent.click(opener);
    const field = await screen.findByRole("combobox", { name: "Search" });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(opener).toHaveFocus();
  },
};

export const ClosesWithItsButton: Story = {
  play: async ({ userEvent }) => {
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};
