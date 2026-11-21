import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { apart, contrast, type Vision } from "./colour.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const design = readFileSync(join(root, "DESIGN.md"), "utf8");
const tokens = readFileSync(
  join(root, "packages/ui/src/styles/tokens.css"),
  "utf8",
);

const colorsOfDesign = () => {
  const front = design.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  const colors: unknown = Bun.YAML.parse(front);
  return typeof colors === "object" && colors !== null && "colors" in colors
    ? colors.colors
    : undefined;
};

const colorsOfBlock = (selector: string, suffix: string) => {
  const block =
    tokens.match(new RegExp(`^${selector} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ??
    "";
  return Object.fromEntries(
    Array.from(
      block.matchAll(/^\s*--([\w-]+): (#[0-9a-f]{6});$/gm),
      (match) => [`${match[1]}${suffix}`, match[2]],
    ),
  );
};

describe("DESIGN.md", () => {
  it("names exactly the colours of tokens.css, the light theme as they are and the dark one with -dark", () => {
    expect(colorsOfDesign()).toEqual({
      ...colorsOfBlock(":root", ""),
      ...colorsOfBlock(":root\\.dark", "-dark"),
    });
  });

  it("pairs no text with a background below WCAG AA contrast", () => {
    const lint = Bun.spawnSync(
      [
        join(root, "node_modules/.bin/designmd"),
        "lint",
        "--format",
        "json",
        "DESIGN.md",
      ],
      { cwd: root },
    );
    const { findings }: { findings: ReadonlyArray<{ message: string }> } =
      JSON.parse(lint.stdout.toString());
    expect(
      findings
        .map(({ message }) => message)
        .filter((message) => message.includes("below WCAG")),
    ).toEqual([]);
  });

  const themes = [
    { theme: "light", colors: colorsOfBlock(":root", "") },
    { theme: "dark", colors: colorsOfBlock(":root\\.dark", "") },
  ];
  const pools = [1, 2, 3, 4, 5, 6, 7, 8].map((hue) => `pool-${hue}`);
  const colourOf = (
    colors: Readonly<Record<string, string | undefined>>,
    token: string,
  ) => colors[token] ?? "#000000";

  it("gives every pool hue, and the neutral one, at least 3:1 contrast against the surface in both themes", () => {
    const below = themes.flatMap(({ theme, colors }) =>
      [...pools, "pool-neutral"]
        .map((token) => ({
          theme,
          token,
          ratio: contrast(colourOf(colors, token), colourOf(colors, "surface")),
        }))
        .filter(({ ratio }) => ratio < 3),
    );
    expect(below).toEqual([]);
  });

  it("keeps each pool hue apart from the next by a CIEDE2000 difference of at least 8, in normal vision and in the three dichromacies, in both themes", () => {
    const visions: ReadonlyArray<Vision> = [
      "normal",
      "protanopia",
      "deuteranopia",
      "tritanopia",
    ];
    const close = themes.flatMap(({ theme, colors }) =>
      pools.slice(1).flatMap((token, index) =>
        visions
          .map((vision) => ({
            theme,
            pair: `${pools[index]} and ${token}`,
            vision,
            difference: apart(
              vision,
              colourOf(colors, pools[index] ?? ""),
              colourOf(colors, token),
            ),
          }))
          .filter(({ difference }) => difference < 8),
      ),
    );
    expect(close).toEqual([]);
  });

  it("keeps every pool hue apart from warn and from danger by a CIEDE2000 difference of at least 12, in normal vision, in both themes", () => {
    const close = themes.flatMap(({ theme, colors }) =>
      pools.flatMap((token) =>
        ["warn", "danger"]
          .map((state) => ({
            theme,
            pair: `${token} and ${state}`,
            difference: apart(
              "normal",
              colourOf(colors, token),
              colourOf(colors, state),
            ),
          }))
          .filter(({ difference }) => difference < 12),
      ),
    );
    expect(close).toEqual([]);
  });

  it("orders the token ramp from the least contrast against the surface to the most, in both themes", () => {
    for (const { colors } of themes) {
      const ratios = [1, 2, 3, 4].map((step) =>
        contrast(colourOf(colors, `ramp-${step}`), colourOf(colors, "surface")),
      );
      expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
      expect(new Set(ratios).size).toBe(ratios.length);
    }
  });
});
