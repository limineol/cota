import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { Button } from "./button.tsx";
import {
  Segment,
  SegmentHead,
  SegmentMeta,
  SegmentShow,
  SegmentTitle,
} from "./segment.tsx";
import { TranscriptSkeleton } from "./transcript.tsx";

function Segments({
  onShow,
  loading = false,
}: {
  onShow: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Segment aria-label="Segment 1 of 3">
        <SegmentHead>
          <SegmentTitle>Segment 1 of 3</SegmentTitle>
          <SegmentMeta>
            11:02 – 12:20 · 96 requests · 182K tokens at its tip · the next
            began when the prompt fell under half
          </SegmentMeta>
        </SegmentHead>
        {loading ? (
          <TranscriptSkeleton />
        ) : (
          <SegmentShow onClick={onShow}>
            Show this segment's transcript <span>96 requests</span>
          </SegmentShow>
        )}
      </Segment>
      <Segment aria-label="Segment 3 of 3">
        <SegmentHead>
          <SegmentTitle>Segment 3 of 3</SegmentTitle>
          <SegmentMeta>
            13:40 – 14:11 · 40 requests · 96K tokens at its tip
          </SegmentMeta>
          <Button variant="ghost" size="sm">
            Hide
          </Button>
        </SegmentHead>
      </Segment>
    </div>
  );
}

const meta = {
  title: "Components/Segment",
  component: Segments,
  args: { onShow: fn() },
} satisfies Meta<typeof Segments>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /Show this segment's transcript/ }),
    );
    await expect(args.onShow).toHaveBeenCalled();
  },
};

export const Loading: Story = { args: { loading: true } };
