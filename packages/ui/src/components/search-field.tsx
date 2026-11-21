import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/**
 * A search: a form of role `search` holding one 32px field behind a
 * magnifier, and `end`, a small control such as how it matches, inside the
 * field's end. The form's `onSubmit` is the search; the field takes the
 * input's props.
 */
function SearchField({
  onSubmit,
  end,
  className,
  ...props
}: Omit<ComponentProps<"input">, "onSubmit"> & {
  onSubmit: () => void;
  end?: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: aria-query, which the stories' role queries read, does not yet give the search element its role
    <form
      data-slot="search-field"
      role="search"
      className={cn(
        "relative flex h-8 min-w-0 items-center rounded-control border border-border-strong bg-surface transition-state hover:border-text-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-text",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 size-3.5 text-text-3"
      />
      <input
        type="search"
        spellCheck={false}
        autoComplete="off"
        className="h-full w-full min-w-0 bg-transparent pr-2 pl-8 text-base text-text outline-none placeholder:text-text-3 [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {end === undefined ? null : (
        <span className="flex shrink-0 pr-0.75">{end}</span>
      )}
    </form>
  );
}

export { SearchField };
