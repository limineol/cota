import { type ComponentProps, useState } from "react";
import { cn } from "#lib/utils.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

/** The most characters a string shows before it is clamped. */
const clampedAt = 400;

const indent = "  ";

const count = new Intl.NumberFormat("en-US");

function Punctuation({ children }: { children: string }) {
  return <span className="text-text-3">{children}</span>;
}

function JsonString({ value }: { value: string }) {
  const [all, setAll] = useState(false);
  const characters = [...value];
  const clamped = !all && characters.length > clampedAt;
  const shown = clamped ? characters.slice(0, clampedAt).join("") : value;
  return (
    <span data-slot="json-string" className="text-text-2">
      "{JSON.stringify(shown).slice(1, -1)}
      {characters.length > clampedAt ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mx-1 cursor-pointer rounded-control font-sans text-text-3 underline decoration-text-3 underline-offset-3 transition-state outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
        >
          {all
            ? "show less"
            : `… ${count.format(characters.length - clampedAt)} more characters`}
        </button>
      ) : null}
      "
    </span>
  );
}

function Node({ value, depth }: { value: JsonValue; depth: number }) {
  if (value === null) return <span className="text-text-3">null</span>;
  if (typeof value === "string") return <JsonString value={value} />;
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="font-medium text-text">{String(value)}</span>;
  }
  const inner = indent.repeat(depth + 1);
  const outer = indent.repeat(depth);
  if (Array.isArray(value)) {
    const items: ReadonlyArray<JsonValue> = value;
    if (items.length === 0) return <Punctuation>[]</Punctuation>;
    return (
      <>
        <Punctuation>[</Punctuation>
        {"\n"}
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an array's items are known by their place
          <span key={index}>
            {inner}
            <Node value={item} depth={depth + 1} />
            {index < items.length - 1 ? <Punctuation>,</Punctuation> : null}
            {"\n"}
          </span>
        ))}
        {outer}
        <Punctuation>]</Punctuation>
      </>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return <Punctuation>{"{}"}</Punctuation>;
  return (
    <>
      <Punctuation>{"{"}</Punctuation>
      {"\n"}
      {entries.map(([key, item], index) => (
        <span key={key}>
          {inner}
          <span className="text-text">{JSON.stringify(key)}</span>
          <Punctuation>: </Punctuation>
          <Node value={item} depth={depth + 1} />
          {index < entries.length - 1 ? <Punctuation>,</Punctuation> : null}
          {"\n"}
        </span>
      ))}
      {outer}
      <Punctuation>{"}"}</Punctuation>
    </>
  );
}

/**
 * A JSON value set out to be read, two spaces a level: keys in ink, strings
 * quieter, numbers and booleans in weight, null and punctuation quietest, and
 * a string longer than 400 characters clamped with a button for the rest.
 */
function JsonView({
  value,
  className,
  ...props
}: Omit<ComponentProps<"pre">, "children"> & { value: JsonValue }) {
  return (
    <pre
      data-slot="json-view"
      className={cn(
        "m-0 rounded-panel border border-border bg-surface-2 px-3.5 py-3 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      <Node value={value} depth={0} />
    </pre>
  );
}

export { type JsonValue, JsonView };
