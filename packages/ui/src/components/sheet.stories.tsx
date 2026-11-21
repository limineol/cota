import type { Meta, StoryObj } from "@storybook/react-vite";
import { Menu } from "lucide-react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./button.tsx";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet.tsx";

const meta = {
  title: "Components/Sheet",
  component: Sheet,
  parameters: { viewport: { defaultViewport: "mobile2" } },
  globals: { viewport: { value: "mobile2" } },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open navigation" />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent>
        <div className="flex flex-col gap-2 p-4">
          <SheetTitle>Navigation</SheetTitle>
          <Button variant="ghost">Overview</Button>
        </div>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole("button", { name: "Open navigation" });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Navigation" });
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
