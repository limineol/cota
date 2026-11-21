import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ToolItem, ToolList } from "./tool-list.tsx";

const meta = {
  title: "Components/Tool list",
  component: ToolList,
} satisfies Meta<typeof ToolList>;

export default meta;
type Story = StoryObj<typeof meta>;

const long =
  "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures. Before executing the command, verify that the parent directory exists. Always quote file paths that contain spaces. Prefer the dedicated tools for reading and searching files.";

export const ThreeTools: Story = {
  render: () => (
    <div className="@container">
      <ToolList>
        <ToolItem name="Bash" description={long} />
        <ToolItem name="Read" description="Reads a file from the filesystem." />
        <ToolItem name="mcp__docs__search" description={null} />
      </ToolList>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show all" }));
    await expect(canvas.getByText(long)).toBeVisible();
  },
};
