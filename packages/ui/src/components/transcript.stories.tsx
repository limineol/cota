import type { Meta, StoryObj } from "@storybook/react-vite";
import { Brain, FileText, ImageIcon, Wrench } from "lucide-react";
import { type ReactNode, useState } from "react";
import { expect } from "storybook/test";
import { Button } from "./button.tsx";
import { CodeBlock, Prose, ProseParagraph } from "./prose.tsx";
import { Toggles } from "./toggles.tsx";
import {
  Transcript,
  TranscriptFoot,
  TranscriptMessage,
  TranscriptNote,
  TranscriptPart,
  TranscriptRow,
  TranscriptSkeleton,
} from "./transcript.tsx";

function Row({
  initial = false,
  children,
  ...props
}: Omit<Parameters<typeof TranscriptRow>[0], "open" | "onOpenChange"> & {
  initial?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <TranscriptRow open={open} onOpenChange={setOpen} {...props}>
      {children}
    </TranscriptRow>
  );
}

function Conversation({ openCall = false }: { openCall?: boolean }) {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Toggles
        label="What the transcript shows"
        pressed={["reasoning", "tools", "context"]}
        options={[
          { value: "reasoning", label: "Reasoning", count: "2" },
          { value: "tools", label: "Tool calls", count: "3" },
          { value: "context", label: "Context", count: "2" },
        ]}
        onPressedChange={() => {}}
      />
      <Transcript>
        <Row
          icon={<FileText />}
          label="System"
          preview="You are a coding agent working in a repository…"
          meta="12,480 characters"
        >
          <CodeBlock quiet>
            You are a coding agent working in a repository.
          </CodeBlock>
        </Row>
        <TranscriptMessage from="user" label="User">
          <Row
            icon={<FileText />}
            label="Reminder"
            preview="The date is Nov 15."
            meta="412 characters"
          >
            <CodeBlock quiet>The date is Nov 15.</CodeBlock>
          </Row>
          <Prose>
            <ProseParagraph>
              The relay hangs when the provider closes the stream early. Find
              out why and fix it.
            </ProseParagraph>
          </Prose>
          <Row
            icon={<ImageIcon />}
            label="Image"
            preview="image/png"
            meta="245,120 bytes"
          >
            <TranscriptNote>
              A transcript keeps an image's media type and size, never the
              image.
            </TranscriptNote>
          </Row>
        </TranscriptMessage>
        <Row
          icon={<Brain />}
          label="Reasoning"
          preview="The stream ends before the last event, so the reader…"
          meta="1,204 characters"
        >
          <Prose>
            <ProseParagraph>
              The stream ends before the last event, so the reader waits.
            </ProseParagraph>
          </Prose>
        </Row>
        <Row
          icon={<Brain />}
          label="Reasoning"
          preview="The provider withheld it."
          meta="hidden"
        >
          <TranscriptNote>
            The provider sent this reasoning encrypted, and the hub keeps none
            of it.
          </TranscriptNote>
        </Row>
        <Row
          initial={openCall}
          icon={<Wrench />}
          label="Bash"
          preview="bun test apps/hub/src/modules/relay"
          mono
          meta="48 lines"
        >
          <TranscriptPart label="Input">
            <CodeBlock>{`{
  "command": "bun test apps/hub/src/modules/relay"
}`}</CodeBlock>
          </TranscriptPart>
          <TranscriptPart label="Result">
            <CodeBlock>
              {
                "✓ relay forwards a stream\n✗ relay ends a stream the provider closed early"
              }
            </CodeBlock>
          </TranscriptPart>
        </Row>
        <Row
          icon={<Wrench />}
          label="Edit"
          preview="apps/hub/src/modules/relay/stream.ts"
          mono
          meta="error"
          tone="danger"
        >
          <TranscriptPart label="Result">
            <CodeBlock>
              The string to replace was not found in the file.
            </CodeBlock>
          </TranscriptPart>
        </Row>
        <TranscriptMessage from="assistant" label="Assistant">
          <Prose>
            <ProseParagraph>
              The reader now ends when the stream does, and the request is
              recorded as cancelled.
            </ProseParagraph>
          </Prose>
          <TranscriptNote>
            8,204 characters were left out here.{" "}
            <a href="/requests/a">The request has the whole text.</a>
          </TranscriptNote>
        </TranscriptMessage>
      </Transcript>
      <TranscriptFoot>
        <Button variant="outline" size="sm">
          Show 40 more of 1,180
        </Button>
        <span>4 hidden by the switches: 2 reasoning, 2 context.</span>
      </TranscriptFoot>
    </div>
  );
}

const meta = {
  title: "Components/Transcript",
  component: Conversation,
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ canvas, userEvent }) => {
    const call = canvas.getByRole("button", { name: /^Bash/ });
    await expect(call).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(call);
    await expect(call).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("Input")).toBeVisible();
  },
};

export const ACallOpen: Story = { args: { openCall: true } };

export const Loading: Story = {
  render: () => (
    <div className="max-w-4xl">
      <TranscriptSkeleton />
    </div>
  ),
};
