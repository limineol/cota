import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { Hue } from "#lib/hue.ts";
import { PoolMark } from "./pool-mark.tsx";
import { type Logo, logos, ProviderLogo } from "./provider-logo.tsx";

const meta = {
  title: "Components/ProviderLogo",
  component: ProviderLogo,
  args: { logo: "claude" },
} satisfies Meta<typeof ProviderLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

const hues: ReadonlyArray<Hue> = [1, 2, 3, 4, 5, 6, 7, 8, "neutral"];

const sizes = ["sm", "md", "lg"] as const;

const row: ReadonlyArray<{
  readonly hue: Hue;
  readonly name: string;
  readonly logo: Logo | null;
}> = [
  { hue: 1, name: "personal", logo: "claude" },
  { hue: 2, name: "work", logo: "claude" },
  { hue: 3, name: "codex", logo: "openai" },
  { hue: 4, name: "openrouter", logo: null },
  { hue: 5, name: "zai", logo: "zai" },
  { hue: 6, name: "opencode", logo: "opencode" },
  { hue: 7, name: "local", logo: null },
  { hue: 8, name: "tower", logo: "lmstudio" },
];

export const InAPoolMark: Story = {
  render: (args) => (
    <PoolMark hue={1} name="personal" glyph={<ProviderLogo {...args} />} />
  ),
};

/** Every logo in every hue and at every size of the mark, beside an initial, to compare their optical size. */
export const EveryLogo: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {sizes.map((size) => (
        <table key={size} className="text-base">
          <caption className="text-left text-sm text-text-2">{size}</caption>
          <tbody>
            {[...logos, null].map((logo) => (
              <tr key={logo ?? "initial"}>
                <th scope="row" className="pr-4 text-left font-normal">
                  {logo ?? "initial"}
                </th>
                {hues.map((hue) => (
                  <td key={hue} className="p-1">
                    <PoolMark
                      hue={hue}
                      name="personal"
                      size={size}
                      glyph={
                        logo === null ? undefined : <ProviderLogo logo={logo} />
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll('[data-slot="provider-logo"]'),
    ).toHaveLength(logos.length * hues.length * sizes.length);
  },
};

/** Logos beside initials at the size of a switcher's or a legend's mark, as a row of pools reads. */
export const BesideInitials: Story = {
  render: () => (
    <ul className="flex flex-wrap items-center gap-4 text-base">
      {row.map((pool) => (
        <li key={pool.name} className="flex items-center gap-1.5">
          <PoolMark
            hue={pool.hue}
            name={pool.name}
            glyph={
              pool.logo === null ? undefined : <ProviderLogo logo={pool.logo} />
            }
          />
          {pool.name}
        </li>
      ))}
    </ul>
  ),
};
