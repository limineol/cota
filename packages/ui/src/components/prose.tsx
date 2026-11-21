import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/** Text a person or a model wrote, in paragraphs, headings, lists and code, set at the prose size. */
function Prose({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="prose"
      className={cn(
        "flex max-w-[78ch] min-w-0 flex-col gap-2.5 text-lg break-words text-text",
        className,
      )}
      {...props}
    />
  );
}

function ProseParagraph({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="prose-paragraph"
      className={cn("m-0 whitespace-pre-wrap", className)}
      {...props}
    />
  );
}

function ProseHeading({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="prose-heading"
      className={cn("m-0 mt-1 font-semibold", className)}
      {...props}
    />
  );
}

function ProseList({
  ordered = false,
  className,
  children,
}: {
  ordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(
    "m-0 flex flex-col gap-1 pl-5 marker:text-text-3",
    ordered ? "list-decimal" : "list-disc",
    className,
  );
  return ordered ? (
    <ol data-slot="prose-list" className={classes}>
      {children}
    </ol>
  ) : (
    <ul data-slot="prose-list" className={classes}>
      {children}
    </ul>
  );
}

function ProseItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="prose-item"
      className={cn("pl-0.5 whitespace-pre-wrap", className)}
      {...props}
    />
  );
}

function ProseCode({ className, ...props }: ComponentProps<"code">) {
  return (
    <code
      data-slot="prose-code"
      className={cn(
        "rounded-block bg-surface-3 px-1 py-px font-mono text-sm",
        className,
      )}
      {...props}
    />
  );
}

function ProseStrong({ className, ...props }: ComponentProps<"strong">) {
  return (
    <strong
      data-slot="prose-strong"
      className={cn("font-semibold", className)}
      {...props}
    />
  );
}

/** A link written in the text, shown as its words and its address, never followed or fetched. */
function ProseLink({
  url,
  className,
  children,
}: {
  url: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span data-slot="prose-link" className={className}>
      {children}{" "}
      <span className="font-mono text-sm break-all text-text-3">({url})</span>
    </span>
  );
}

/** Code as it was written, in mono, its long lines wrapped and a long block scrolled; `quiet` for what the model was given rather than wrote. */
function CodeBlock({
  quiet = false,
  className,
  ...props
}: ComponentProps<"pre"> & { quiet?: boolean }) {
  return (
    <pre
      data-slot="code-block"
      className={cn(
        "m-0 max-h-[32.5rem] overflow-auto rounded-panel border border-border bg-surface-2 px-3.5 py-3 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-text [scrollbar-width:thin]",
        quiet && "text-text-2",
        className,
      )}
      {...props}
    />
  );
}

/** A button in the text, underlined like a link: Show all, Show less. */
function ProseButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="prose-button"
      className={cn(
        "cursor-pointer self-start rounded-control text-sm text-text-2 underline decoration-text-3 underline-offset-3 transition-state outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
        className,
      )}
      {...props}
    />
  );
}

export {
  CodeBlock,
  Prose,
  ProseButton,
  ProseCode,
  ProseHeading,
  ProseItem,
  ProseLink,
  ProseList,
  ProseParagraph,
  ProseStrong,
};
