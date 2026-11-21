import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookOpen, History } from "lucide-react";
import { expect, fn, screen, waitFor } from "storybook/test";
import { Menu, MenuGroup, MenuItem, MenuNote } from "./menu.tsx";

function Menus({ onChoose }: { onChoose: (what: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Menu label="Examples" icon={<BookOpen aria-hidden="true" />}>
        <MenuItem
          title="Requests in the last day"
          detail="The latest 100, newest first"
          onClick={() => onChoose("requests")}
        />
        <MenuItem
          title="Usage by pool and day"
          detail="Requests, tokens and cost over 30 days"
          onClick={() => onChoose("usage")}
        />
      </Menu>
      <Menu label="History" icon={<History aria-hidden="true" />}>
        <MenuGroup label="This browser's last runs">
          <MenuItem
            code
            title="SELECT pool, count() FROM requests GROUP BY pool"
            detail="14:05 · 4 rows · 38 ms"
            onClick={() => onChoose("history")}
          />
          <MenuItem
            code
            title="SELECT * FROM items LIMIT 10"
            detail="Yesterday 18:40 · failed"
            onClick={() => onChoose("failed")}
          />
        </MenuGroup>
      </Menu>
      <Menu label="Saved">
        <MenuNote>Nothing is saved yet</MenuNote>
      </Menu>
    </div>
  );
}

const meta = {
  title: "Components/Menu",
  component: Menus,
  args: { onChoose: fn() },
} satisfies Meta<typeof Menus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const AnItemIsChosen: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "History" }));
    const item = await screen.findByRole("menuitem", {
      name: /SELECT pool, count\(\)/,
    });
    await expect(
      screen.getByText("This browser's last runs"),
    ).toBeInTheDocument();
    await userEvent.click(item);
    await expect(args.onChoose).toHaveBeenCalledWith("history");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  },
};
