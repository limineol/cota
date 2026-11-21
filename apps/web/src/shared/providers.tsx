import { type Logo, ProviderLogo } from "@cota/ui/components/provider-logo";
import type { ReactNode } from "react";

/** The providers with a logo, as the hub names a pool's provider: from the configuration, or from its protocol. */
const logos: ReadonlyMap<string, Logo> = new Map([
  ["anthropic", "claude"],
  ["chatgpt", "openai"],
  ["openai", "openai"],
  ["zai", "zai"],
  ["opencode", "opencode"],
  ["opencode-go", "opencode"],
  ["lmstudio", "lmstudio"],
]);

/** The logo a pool's mark draws for its provider, or `null` for a provider with none, whose pools keep their initial. */
export const logoOf = (provider: string): Logo | null =>
  logos.get(provider) ?? null;

/** A pool mark's glyph for its provider: the provider's logo, or nothing, so that the mark draws the pool's initial. */
export const glyphOf = (provider: string): ReactNode => {
  const logo = logoOf(provider);
  return logo === null ? undefined : <ProviderLogo logo={logo} />;
};
