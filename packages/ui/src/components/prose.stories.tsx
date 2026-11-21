import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import {
  CodeBlock,
  Prose,
  ProseButton,
  ProseCode,
  ProseHeading,
  ProseItem,
  ProseLink,
  ProseList,
  ProseParagraph,
  ProseStrong,
} from "./prose.tsx";

function Answer({ quiet = false }: { quiet?: boolean }) {
  return (
    <Prose>
      <ProseHeading>What hangs</ProseHeading>
      <ProseParagraph>
        The relay waits for the stream's last event in{" "}
        <ProseCode>readEvents</ProseCode>, and a provider that closes the stream
        early never sends it. <ProseStrong>Nothing times out</ProseStrong>, so
        the request hangs until the client gives up.
      </ProseParagraph>
      <ProseList>
        <ProseItem>End the reading when the stream ends.</ProseItem>
        <ProseItem>
          Record the request as <ProseCode>cancelled</ProseCode>, not{" "}
          <ProseCode>ok</ProseCode>.
        </ProseItem>
      </ProseList>
      <ProseList ordered>
        <ProseItem>Write the failing test.</ProseItem>
        <ProseItem>Fix the reader.</ProseItem>
      </ProseList>
      <CodeBlock quiet={quiet}>
        {`const events = yield* readEvents(stream);
if (events.done) return yield* Effect.fail(new StreamEnded());`}
      </CodeBlock>
      <ProseParagraph>
        The spec says so in{" "}
        <ProseLink url="https://example.com/docs/specs/relay">
          the relay spec
        </ProseLink>
        .
      </ProseParagraph>
      <ProseButton>Show all 12,480 characters</ProseButton>
    </Prose>
  );
}

const meta = {
  title: "Components/Prose",
  component: Answer,
} satisfies Meta<typeof Answer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnAnswer: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("link")).toBeNull();
    await expect(
      canvas.getByText("(https://example.com/docs/specs/relay)"),
    ).toBeVisible();
  },
};

export const QuietCode: Story = { args: { quiet: true } };
