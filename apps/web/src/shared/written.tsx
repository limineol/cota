import { JsonView } from "@cota/ui/components/json-view";
import type { Schema } from "effect";
import { ClampedCode } from "#shared/transcript/text.tsx";

const parsed = (text: string): Schema.Json | undefined => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A text a provider wrote: set out as JSON when it is a JSON object or array, as it came otherwise. */
export function Written({ text }: { readonly text: string }) {
  const value = parsed(text);
  return typeof value === "object" && value !== null ? (
    <JsonView value={value} />
  ) : (
    <ClampedCode text={text} />
  );
}
