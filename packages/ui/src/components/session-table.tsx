import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";
import { TableCell, TableRow } from "./table.tsx";

/**
 * A session's heading in its row: its `title`, its first prompt in a quieter
 * tone when it has none (`prompt`), or what it is when it has neither
 * (`none`). It goes inside the row's `TableLabel`.
 */
function SessionTitle({
  kind = "title",
  className,
  ...props
}: ComponentProps<"span"> & { kind?: "title" | "prompt" | "none" }) {
  return (
    <span
      data-slot="session-title"
      data-kind={kind}
      className={cn(
        "font-medium text-text",
        kind === "prompt" && "font-normal text-text-2",
        kind === "none" && "font-normal text-text-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Where a search found the session, under its row and across the table: a
 * quiet inset of two lines at most, its words marked by `SnippetMark`.
 */
function SessionSnippet({
  columns,
  className,
  children,
}: {
  columns: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableRow data-slot="session-snippet">
      <TableCell colSpan={columns} className="pt-0 pb-2.5">
        <span
          className={cn(
            "block max-w-4xl rounded-control bg-surface-2 px-2.5 py-1.5 text-sm leading-relaxed break-words text-text-2 transition-state group-hover/row:bg-surface",
            className,
          )}
        >
          <span className="line-clamp-2">{children}</span>
        </span>
      </TableCell>
    </TableRow>
  );
}

function SnippetMark({ className, ...props }: ComponentProps<"mark">) {
  return (
    <mark
      data-slot="snippet-mark"
      className={cn(
        "rounded-block bg-surface-3 px-px font-medium text-text",
        className,
      )}
      {...props}
    />
  );
}

export { SessionSnippet, SessionTitle, SnippetMark };
