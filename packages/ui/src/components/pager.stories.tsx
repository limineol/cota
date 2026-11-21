import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { expect } from "storybook/test";
import {
  Pager,
  PagerControls,
  PagerCount,
  PagerNote,
  PagerPage,
  PagerStep,
} from "./pager.tsx";

function Pages({
  count,
  page,
  newer,
  older,
  note,
}: {
  count: string;
  page: string;
  newer: boolean;
  older: boolean;
  note?: string;
}) {
  return (
    <Pager aria-label="Pages">
      <PagerCount>{count}</PagerCount>
      <PagerControls>
        <PagerStep href="#newer" disabled={!newer}>
          <ChevronLeft /> Newer
        </PagerStep>
        <PagerPage>{page}</PagerPage>
        <PagerStep href="#older" disabled={!older}>
          Older <ChevronRight />
        </PagerStep>
      </PagerControls>
      {note === undefined ? null : <PagerNote>{note}</PagerNote>}
    </Pager>
  );
}

const meta = {
  title: "Components/Pager",
  component: Pages,
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Pages>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstPage: Story = {
  args: {
    count: "1–50 of 1,284",
    page: "Page 1 of 26",
    newer: false,
    older: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /Newer/ })).toBeDisabled();
    await expect(canvas.getByRole("link", { name: /Older/ })).toHaveAttribute(
      "href",
      "#older",
    );
  },
};

export const SecondPage: Story = {
  args: {
    count: "51–100 of 1,284",
    page: "Page 2 of 26",
    newer: true,
    older: true,
  },
};

export const TheLastPageTheHubReaches: Story = {
  args: {
    count: "10,001–10,050 of 18,342",
    page: "Page 201 of 367",
    newer: true,
    older: false,
    note: "The hub lists the first 10,050 sessions. Narrow the range or the filters to see the rest.",
  },
};
