import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlert, Clock, RotateCw } from "lucide-react";
import { expect, fn } from "storybook/test";
import {
  Alert,
  AlertAction,
  AlertCode,
  AlertDescription,
  AlertTitle,
} from "./alert.tsx";
import { Button } from "./button.tsx";

const meta = {
  title: "Components/Alert",
  component: Alert,
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Problem: Story = {
  render: () => (
    <Alert variant="danger">
      <CircleAlert />
      <AlertTitle>That is not the owner password.</AlertTitle>
      <AlertDescription>Check it and sign in again.</AlertDescription>
    </Alert>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "That is not the owner password.",
    );
  },
};

export const Notice: Story = {
  render: () => (
    <Alert>
      <Clock />
      <AlertTitle>Signing in is paused until 14:32.</AlertTitle>
      <AlertDescription>
        Too many wrong passwords were given in the last 10 minutes.
      </AlertDescription>
    </Alert>
  ),
};

const retry = fn();

export const WithRetry: Story = {
  render: () => (
    <Alert variant="danger">
      <CircleAlert />
      <AlertTitle>The hub did not answer.</AlertTitle>
      <AlertDescription>
        Check that it is running and reachable from this browser, then try
        again.
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={retry}>
          <RotateCw data-icon="inline-start" /> Try again
        </Button>
      </AlertAction>
    </Alert>
  ),
  play: async ({ canvas, userEvent }) => {
    retry.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(retry).toHaveBeenCalledOnce();
  },
};

export const WithMessage: Story = {
  render: () => (
    <Alert variant="danger">
      <CircleAlert />
      <AlertTitle>ClickHouse refused the query.</AlertTitle>
      <AlertDescription>A syntax error at line 1, column 8.</AlertDescription>
      <AlertCode>
        {
          "Syntax error: failed at position 8 (FORM) (line 1, col 8): FORM requests LIMIT 10. Expected one of: token sequence, Dot, OpeningRoundBracket, FROM, end of query"
        }
      </AlertCode>
    </Alert>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^Syntax error: failed at/)).toBeVisible();
  },
};
