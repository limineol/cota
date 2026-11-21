import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "./button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card.tsx";
import { Input } from "./input.tsx";
import { Label } from "./label.tsx";

const meta = {
  title: "Components/Card",
  component: Card,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAForm: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Owner password</CardTitle>
        <CardDescription>
          The one the hub's configuration names.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" />
        </div>
        <Button>Sign in</Button>
      </CardContent>
    </Card>
  ),
};

export const AsThePageHeading: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle
          // biome-ignore lint/a11y/useHeadingContent: CardTitle gives the heading its children
          render={<h1 />}
        >
          Cota
        </CardTitle>
        <CardDescription>
          Sign in to read this hub's pools, quota windows and request log.
        </CardDescription>
      </CardHeader>
    </Card>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Cota" }),
    ).toBeVisible();
  },
};

export const Compact: Story = {
  render: () => (
    <Card size="compact" className="max-w-md">
      <CardTitle>Where the tokens went</CardTitle>
      <CardDescription>
        A compact card is one of several in a section.
      </CardDescription>
    </Card>
  ),
};
