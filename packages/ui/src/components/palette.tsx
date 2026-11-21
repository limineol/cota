import { Dialog } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Search } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useRef } from "react";
import { cn } from "#lib/utils.ts";

/**
 * The command palette: a dialog over a scrim near the top of the screen,
 * named by `label`, which puts the focus in its field when it opens, holds it
 * while open and gives it back when it closes.
 */
function Palette({
  open,
  onOpenChange,
  label,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          data-slot="palette-scrim"
          className="fixed inset-0 z-40 bg-bg/70 transition-state data-ending-style:opacity-0 data-starting-style:opacity-0"
        />
        <Dialog.Popup
          data-slot="palette"
          ref={popup}
          initialFocus={() =>
            popup.current?.querySelector<HTMLElement>("[role=combobox]") ?? true
          }
          className={cn(
            "fixed inset-x-0 top-3 z-50 mx-auto flex max-h-[min(35rem,calc(100dvh-1.5rem))] w-[min(40rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-card border border-border-strong bg-surface text-text outline-none transition-state data-ending-style:opacity-0 data-starting-style:opacity-0 wide:top-[12vh] wide:max-h-[min(35rem,76dvh)]",
            className,
          )}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A key of a shortcut, boxed, as the palette writes the keys it takes. */
function PaletteKey({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="palette-key"
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-block border border-border-strong px-1 font-sans text-xs font-normal text-text-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The palette's field across its top, behind a magnifier, with `esc` at its
 * end as the button that closes it; the input takes the props given.
 */
function PaletteField({
  className,
  closeLabel = "Close",
  ...props
}: ComponentProps<"input"> & { closeLabel?: string }) {
  return (
    <div
      data-slot="palette-field"
      className="flex h-13 shrink-0 items-center gap-2.5 border-b border-border pr-3 pl-4"
    >
      <Search aria-hidden="true" className="size-4 shrink-0 text-text-3" />
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-lg text-text outline-none placeholder:text-text-3 [&::-webkit-search-cancel-button]:hidden",
          className,
        )}
        {...props}
      />
      <Dialog.Close className="flex cursor-pointer rounded-control p-0.5 outline-none transition-state hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-text">
        <span className="sr-only">{closeLabel}</span>
        <PaletteKey aria-hidden="true">esc</PaletteKey>
      </Dialog.Close>
    </div>
  );
}

/**
 * The results, a listbox the field drives, which scrolls when they do not
 * fit; while there are none (`empty`), only what its groups say, and no
 * listbox.
 */
function PaletteList({
  empty = false,
  "aria-label": label,
  className,
  ...props
}: ComponentProps<"div"> & { empty?: boolean }) {
  return (
    <div
      data-slot="palette-list"
      {...(empty ? {} : { role: "listbox", "aria-label": label })}
      className={cn(
        "min-h-0 flex-1 scroll-py-1.5 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]",
        className,
      )}
      {...props}
    />
  );
}

/** Results of one kind under a small quiet head, set off from the group before by a hairline. */
function PaletteGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const head = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a listbox's options are grouped by role="group"; a fieldset is for form controls
    <div
      data-slot="palette-group"
      role="group"
      aria-labelledby={head}
      className={cn(
        "[&+&]:mt-1.5 [&+&]:border-t [&+&]:border-border [&+&]:pt-1.5",
        className,
      )}
    >
      <div
        id={head}
        className="sticky -top-1.5 z-10 bg-surface px-2.5 pt-1.5 pb-1 text-xs font-medium text-text-3"
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * One result, an option of the list, drawn as `render` (a link): `icon`, its
 * name, a quiet `detail` at its end, and `secondary` lines under its name.
 * The `active` one is filled and says that Enter opens it.
 */
function PaletteItem({
  icon,
  detail,
  secondary,
  active = false,
  render,
  className,
  children,
  ...props
}: useRender.ComponentProps<"a"> & {
  icon?: ReactNode;
  detail?: ReactNode;
  secondary?: ReactNode;
  active?: boolean;
}) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        role: "option",
        tabIndex: -1,
        "aria-selected": active,
        className: cn(
          "grid min-h-9 cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-control px-2.5 py-2 text-text outline-none select-none data-active:bg-surface-2",
          className,
        ),
        ...(active ? { "data-active": "" } : {}),
      },
      props,
      {
        children: (
          <>
            <span className="flex h-5 items-center justify-center text-text-3 [&_svg]:size-4 [&_svg]:shrink-0">
              {icon}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate leading-5">{children}</span>
              {secondary === undefined ? null : (
                <span className="text-sm text-text-2">{secondary}</span>
              )}
            </span>
            <span className="flex h-5 items-center gap-2 text-sm whitespace-nowrap text-text-3">
              {detail}
              {active ? (
                <span
                  aria-hidden="true"
                  className="hidden items-center gap-1 wide:flex"
                >
                  Open <PaletteKey>↵</PaletteKey>
                </span>
              ) : null}
            </span>
          </>
        ),
      },
    ),
  });
}

/** The part of a name or a snippet that the text typed matched. */
function PaletteMark({ className, ...props }: ComponentProps<"mark">) {
  return (
    <mark
      data-slot="palette-mark"
      className={cn(
        "rounded-block bg-surface-3 px-px font-medium text-text",
        className,
      )}
      {...props}
    />
  );
}

/** An id under a name, in mono, when the text was found in the id. */
function PaletteId({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="palette-id"
      className={cn("font-mono text-sm", className)}
      {...props}
    />
  );
}

/** A quiet line of a result under its name, such as a snippet, held to two lines. */
function PaletteSnippet({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="palette-snippet"
      className={cn("line-clamp-2 break-words", className)}
      {...props}
    />
  );
}

/** A line in a group in place of its results: while they are read, when there are none, or when the read failed. */
function PaletteNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="palette-note"
      className={cn("m-0 px-2.5 pt-0.5 pb-2 text-sm text-text-3", className)}
      {...props}
    />
  );
}

/** The keys the palette takes, under its results, from the `wide` breakpoint, and `end`, such as how many there are. */
function PaletteFoot({
  end,
  className,
}: {
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="palette-foot"
      className={cn(
        "flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-xs text-text-3",
        className,
      )}
    >
      <span aria-hidden="true" className="hidden items-center gap-1 wide:flex">
        <PaletteKey>↑</PaletteKey>
        <PaletteKey>↓</PaletteKey> to move
      </span>
      <span aria-hidden="true" className="hidden items-center gap-1 wide:flex">
        <PaletteKey>↵</PaletteKey> to open
      </span>
      <span aria-hidden="true" className="hidden items-center gap-1 wide:flex">
        <PaletteKey>esc</PaletteKey> to close
      </span>
      {end === undefined ? null : (
        <span className="ml-auto tabular-nums">{end}</span>
      )}
    </div>
  );
}

export {
  Palette,
  PaletteField,
  PaletteFoot,
  PaletteGroup,
  PaletteId,
  PaletteItem,
  PaletteKey,
  PaletteList,
  PaletteMark,
  PaletteNote,
  PaletteSnippet,
};
