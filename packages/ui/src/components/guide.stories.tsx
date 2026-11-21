import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "./button.tsx";
import { Card } from "./card.tsx";
import { Guide, GuideLead, GuideTitle, GuideWords } from "./guide.tsx";
import { Input } from "./input.tsx";
import { Label } from "./label.tsx";

const meta = {
  title: "Components/Guide",
  component: Guide,
  tags: ["page"],
} satisfies Meta<typeof Guide>;

export default meta;
type Story = StoryObj<typeof meta>;

const guide = (
  <Guide>
    <GuideWords>
      <GuideTitle>Set up this hub</GuideTitle>
      <GuideLead>
        This hub has no owner yet. Prove it is yours with the code it printed,
        and choose the owner password.
      </GuideLead>
    </GuideWords>
    <Card>
      <form className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guide-code">Setup code</Label>
          <Input id="guide-code" />
        </div>
        <Button type="submit">Set up the hub</Button>
      </form>
    </Card>
  </Guide>
);

export const TwoColumns: Story = {
  render: () => guide,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Set up this hub" }),
    ).toBeVisible();
  },
};

export const OnAPhone: Story = {
  render: () => guide,
  globals: { viewport: { value: "mobile2" } },
};
