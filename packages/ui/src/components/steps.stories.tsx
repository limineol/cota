import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Note } from "./note.tsx";
import { Step, Steps } from "./steps.tsx";

const meta = {
  title: "Components/Steps",
  component: Steps,
} satisfies Meta<typeof Steps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneAtATime: Story = {
  render: () => (
    <Steps className="max-w-md">
      <Step
        number={1}
        state="done"
        title="Find the setup code in the hub's log"
      />
      <Step number={2} state="current" title="Choose the owner password">
        <Note>12 characters or more. It signs you in on any browser.</Note>
      </Step>
      <Step
        number={3}
        state="ahead"
        title="You are signed in on this browser for 30 days"
      />
    </Steps>
  ),
  play: async ({ canvas }) => {
    const steps = canvas.getAllByRole("listitem");
    await expect(steps[0]).toHaveTextContent(/Step 1, done:/);
    await expect(steps[1]).toHaveAttribute("aria-current", "step");
    await expect(steps[2]).toHaveTextContent(/Step 3, to come:/);
  },
};

export const Refused: Story = {
  render: () => (
    <Steps className="max-w-md">
      <Step
        number={1}
        state="refused"
        title="Find the setup code in the hub's log"
      />
      <Step number={2} state="done" title="Choose the owner password" />
      <Step
        number={3}
        state="ahead"
        title="You are signed in on this browser for 30 days"
      />
    </Steps>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")[0]).toHaveTextContent(
      /Step 1, refused:/,
    );
  },
};
