import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "./button.tsx";
import { Tabs, TabsItem } from "./tabs.tsx";

const parts = [
  { id: "output", label: "Output", count: "3" },
  { id: "input", label: "Input", count: "128" },
  { id: "tools", label: "Tools", count: "18" },
  { id: "params", label: "Params" },
  { id: "metadata", label: "Metadata" },
  { id: "usage", label: "Token usage" },
] as const;

const meta = {
  title: "Components/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ARequest: Story = {
  render: () => (
    <Tabs aria-label="What the request holds">
      {parts.map((part) => (
        <TabsItem
          key={part.id}
          href={`#${part.id}`}
          current={part.id === "output"}
          {...("count" in part ? { count: part.count } : {})}
        >
          {part.label}
        </TabsItem>
      ))}
    </Tabs>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("link", { name: "Output 3" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      canvas.getByRole("link", { name: "Input 128" }),
    ).not.toHaveAttribute("aria-current");
  },
};

export const Narrow: Story = {
  ...ARequest,
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};

export const WithAnEnd: Story = {
  render: () => (
    <Tabs
      aria-label="What the request holds"
      end={
        <Button variant="ghost" size="sm">
          Expand all
        </Button>
      }
    >
      {parts.slice(0, 3).map((part) => (
        <TabsItem
          key={part.id}
          href={`#${part.id}`}
          current={part.id === "output"}
          {...("count" in part ? { count: part.count } : {})}
        >
          {part.label}
        </TabsItem>
      ))}
    </Tabs>
  ),
  play: async ({ canvas }) => {
    const links = canvas.getByRole("navigation", {
      name: "What the request holds",
    });
    const end = canvas.getByRole("button", { name: "Expand all" });
    await expect(end).toBeVisible();
    await expect(end.getBoundingClientRect().top).toBeLessThan(
      links.getBoundingClientRect().bottom,
    );
  },
};

export const NarrowWithAnEnd: Story = {
  ...WithAnEnd,
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    const links = canvas.getByRole("navigation", {
      name: "What the request holds",
    });
    const end = canvas.getByRole("button", { name: "Expand all" });
    await expect(end.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      links.getBoundingClientRect().bottom,
    );
  },
};
