import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogOut } from "lucide-react";
import { expect, waitFor, within } from "storybook/test";
import { Button } from "./button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

const meta = {
  title: "Components/Tooltip",
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

const signOut = (side: "top" | "right") => (
  <div className="flex h-24 items-center px-12">
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" aria-label="Sign out" />}
      >
        <LogOut />
      </TooltipTrigger>
      <TooltipContent side={side}>Sign out</TooltipContent>
    </Tooltip>
  </div>
);

export const OnFocus: Story = {
  render: () => signOut("right"),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Sign out" }),
    ).toHaveFocus();
    const tip = await within(canvasElement.ownerDocument.body).findByText(
      "Sign out",
      { selector: "[data-slot=tooltip-content]" },
    );
    await waitFor(() => expect(tip).toBeVisible());
  },
};

export const Above: Story = { render: () => signOut("top") };
