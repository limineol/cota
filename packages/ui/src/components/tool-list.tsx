import { type ComponentProps, type ReactNode, useState } from "react";
import { cn } from "#lib/utils.ts";

/** The characters a tool's description shows before "Show all". */
const clampedAt = 240;

/** The tools a request offered the model, one under another. */
function ToolList({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="tool-list"
      className={cn(
        "m-0 flex list-none flex-col divide-y divide-border p-0",
        className,
      )}
      {...props}
    />
  );
}

/** One tool: its name in mono, and its description clamped, with a button for the rest. */
function ToolItem({
  name,
  description,
}: {
  name: ReactNode;
  description: string | null;
}) {
  const [all, setAll] = useState(false);
  const long = description !== null && description.length > clampedAt;
  return (
    <li
      data-slot="tool-item"
      className="grid gap-x-6 gap-y-1 py-3 first:pt-0 @2xl:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <code className="min-w-0 font-mono text-sm font-medium break-all text-text">
        {name}
      </code>
      <div className="flex min-w-0 flex-col items-start gap-1 text-sm text-text-2">
        {description === null ? (
          <span className="text-text-3">No description</span>
        ) : (
          <p className="m-0 whitespace-pre-wrap">
            {long && !all
              ? `${description.slice(0, clampedAt).trimEnd()}…`
              : description}
          </p>
        )}
        {long ? (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="cursor-pointer rounded-control text-sm text-text-3 underline decoration-text-3 underline-offset-3 transition-state outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
          >
            {all ? "Show less" : "Show all"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export { ToolItem, ToolList };
