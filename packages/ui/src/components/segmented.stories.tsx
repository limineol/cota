import type { Meta, StoryObj } from "@storybook/react-vite";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { Segmented, type SegmentedOption } from "./segmented.tsx";

type Theme = "system" | "light" | "dark";

const themes: ReadonlyArray<SegmentedOption<Theme>> = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

function ThemeChoice({
  iconOnly = false,
  orientation,
}: {
  iconOnly?: boolean;
  orientation?: "horizontal" | "vertical";
}) {
  const [theme, setTheme] = useState<Theme>("system");
  return (
    <Segmented
      label="Theme"
      value={theme}
      options={themes}
      onValueChange={setTheme}
      iconOnly={iconOnly}
      {...(orientation === undefined ? {} : { orientation })}
    />
  );
}

const meta = {
  title: "Components/Segmented",
  component: ThemeChoice,
} satisfies Meta<typeof ThemeChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLabels: Story = {
  play: async ({ canvas, userEvent }) => {
    const group = canvas.getByRole("radiogroup", { name: "Theme" });
    await expect(
      within(group).getByRole("radio", { name: "System" }),
    ).toBeChecked();
    await userEvent.click(within(group).getByRole("radio", { name: "Dark" }));
    await expect(
      within(group).getByRole("radio", { name: "Dark" }),
    ).toBeChecked();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(
      within(group).getByRole("radio", { name: "Light" }),
    ).toBeChecked();
  },
};

export const IconsOnly: Story = {
  args: { iconOnly: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("radio", { name: "Light" }));
    await expect(canvas.getByRole("radio", { name: "Light" })).toBeChecked();
  },
};

export const Stacked: Story = {
  args: { iconOnly: true, orientation: "vertical" },
};

const ranges = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
] as const;

export const Ranges: Story = {
  render: function Render() {
    const [range, setRange] = useState<(typeof ranges)[number]["value"]>("24h");
    return (
      <Segmented
        label="Range"
        value={range}
        options={ranges}
        onValueChange={setRange}
      />
    );
  },
};

const roles = [
  { value: "all", label: "All 312" },
  { value: "main", label: "Main 212" },
  { value: "subagent", label: "Subagent 64" },
  { value: "title", label: "Title 2" },
  { value: "utility", label: "Utility 34" },
] as const;

export const SmallInANarrowPanel: Story = {
  render: function Render() {
    const [role, setRole] = useState<(typeof roles)[number]["value"]>("all");
    return (
      <div className="w-72 rounded-card border border-border bg-surface p-3.5">
        <Segmented
          label="Request role"
          size="sm"
          value={role}
          options={roles}
          onValueChange={setRole}
        />
      </div>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("radio", { name: "Utility 34" }));
    await expect(
      canvas.getByRole("radio", { name: "Utility 34" }),
    ).toBeChecked();
  },
};
