import { describe, expect, it } from "@effect/vitest";
import { logoOf } from "./providers.tsx";

describe("a provider's logo", () => {
  it("draws the logo of each provider the hub names that has one", () => {
    expect(
      ["anthropic", "chatgpt", "openai", "zai", "opencode-go", "lmstudio"].map(
        logoOf,
      ),
    ).toEqual(["claude", "openai", "openai", "zai", "opencode", "lmstudio"]);
  });

  it("draws no logo for a provider without one, nor for a name an object already has", () => {
    expect(
      [
        "openrouter",
        "llama-swap",
        "ollama",
        "",
        "constructor",
        "Anthropic",
      ].map(logoOf),
    ).toEqual([null, null, null, null, null, null]);
  });
});
