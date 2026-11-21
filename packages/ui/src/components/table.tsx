import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";
import { MagnitudeBar } from "./magnitude-bar.tsx";

/** A compact table of figures: its first and last columns flush with the panel, numbers right-aligned. */
function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full border-collapse tabular-nums", className)}
        {...props}
      />
    </div>
  );
}

/** The heads; `from` keeps them for assistive technology only below a width of the list panel, where one column is left and a lone head would only push the rows down. */
function TableHeader({
  from,
  className,
  ...props
}: ComponentProps<"thead"> & { from?: Shown }) {
  return (
    <thead
      data-slot="table-header"
      className={cn(from !== undefined && headsFrom[from], className)}
      {...props}
    />
  );
}

/**
 * The rows, or, `linked`, one item's rows (its row and what continues it,
 * such as a search's snippet) as one link: its `TableLabel` is stretched
 * over them, and their ground darkens on hover and while the link has the
 * focus. A table holds one such body per item. `marked` sets apart the item
 * the page led the reader to.
 */
function TableBody({
  linked = false,
  marked = false,
  className,
  ...props
}: ComponentProps<"tbody"> & { linked?: boolean; marked?: boolean }) {
  return (
    <tbody
      data-slot="table-body"
      data-linked={linked ? "" : undefined}
      data-marked={marked ? "" : undefined}
      className={cn(
        "last:[&>tr:last-child>td]:border-b-0 data-marked:bg-surface-3",
        linked &&
          "group/row relative transition-state hover:bg-surface-2 has-[[data-slot=table-label]:focus-visible]:bg-surface-2 [&>tr:not(:last-child)>td]:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow(props: ComponentProps<"tr">) {
  return <tr data-slot="table-row" {...props} />;
}

/** From which width of its `ListPanel` a column is shown: 512px, 672px, 896px or 1024px. */
type Shown = "sm" | "md" | "lg" | "xl";

const shownFrom: Record<Shown, string> = {
  sm: "hidden @lg/panel:table-cell",
  md: "hidden @2xl/panel:table-cell",
  lg: "hidden @4xl/panel:table-cell",
  xl: "hidden @5xl/panel:table-cell",
};

const headsFrom: Record<Shown, string> = {
  sm: "@max-lg/panel:[&_th]:sr-only",
  md: "@max-2xl/panel:[&_th]:sr-only",
  lg: "@max-4xl/panel:[&_th]:sr-only",
  xl: "@max-5xl/panel:[&_th]:sr-only",
};

const cell = (numeric: boolean, wide: boolean, from: Shown | undefined) =>
  cn(
    "px-3 first:pl-0 last:pr-0",
    numeric ? "text-right whitespace-nowrap" : "text-left",
    wide && "hidden wide:table-cell",
    from !== undefined && shownFrom[from],
  );

interface Column {
  /** Aligns the column right, with its figures. */
  numeric?: boolean;
  /** Shows the column only from the `wide` breakpoint. */
  wide?: boolean;
  /** Shows the column only from a width of its list panel. */
  from?: Shown;
}

/** A column's heading; `sorted` says the rows are in its order. */
function TableHead({
  className,
  numeric = false,
  wide = false,
  from,
  sorted,
  ...props
}: ComponentProps<"th"> &
  Column & { sorted?: "ascending" | "descending" | undefined }) {
  return (
    <th
      data-slot="table-head"
      aria-sort={sorted}
      className={cn(
        cell(numeric, wide, from),
        "border-b border-border py-2 text-xs font-medium whitespace-nowrap text-text-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * What orders the rows by a column, in its head: a link given by `render`,
 * or a button. The column the rows are in the order of shows an arrow, on
 * the side away from its figures.
 */
function TableSort({
  render,
  sorted,
  numeric = false,
  className,
  children,
  ...props
}: useRender.ComponentProps<"button"> & {
  sorted?: "ascending" | "descending" | undefined;
  numeric?: boolean;
}) {
  const Arrow = sorted === "ascending" ? ArrowUp : ArrowDown;
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(
      {
        className: cn(
          "group/sort relative cursor-pointer rounded-control font-medium whitespace-nowrap text-text-3 transition-state outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
          sorted !== undefined && "text-text",
          className,
        ),
        children: (
          <>
            {children}
            <Arrow
              aria-hidden="true"
              className={cn(
                "absolute top-1/2 size-3 -translate-y-1/2",
                numeric ? "right-full mr-0.75" : "left-full ml-0.75",
                sorted === undefined &&
                  "opacity-0 transition-state group-hover/sort:opacity-100",
              )}
            />
          </>
        ),
      },
      props,
    ),
  });
}

function TableCell({
  className,
  numeric = false,
  wide = false,
  from,
  ...props
}: ComponentProps<"td"> & Column) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        cell(numeric, wide, from),
        "border-b border-border/60 py-2.25 align-middle text-text-2",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A row's name, cut short with an ellipsis rather than wrapped. Given a link
 * by `render`, it leads to what the row counts; in a `linked` body the link
 * is stretched over the item's rows.
 */
function TableLabel({
  render,
  className,
  ...props
}: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    render,
    props: {
      ...mergeProps<"span">(
        {
          className: cn(
            "min-w-0 truncate text-text",
            render !== undefined &&
              "rounded-control decoration-text-3 underline-offset-3 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text group-data-linked/row:group-hover/row:underline group-data-linked/row:after:absolute group-data-linked/row:after:inset-0 group-data-linked/row:focus-visible:outline-0 group-data-linked/row:focus-visible:after:outline-2 group-data-linked/row:focus-visible:after:-outline-offset-2 group-data-linked/row:focus-visible:after:outline-text",
            className,
          ),
        },
        props,
      ),
      "data-slot": "table-label",
    },
  });
}

/** A quiet second line under a cell's value, on one line. */
function TableSecondary({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="table-secondary"
      className={cn("mt-0.5 block truncate text-sm text-text-3", className)}
      {...props}
    />
  );
}

/** A short count beside a row's name that needs attention, such as its errors. */
function TableFlag({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="table-flag"
      className={cn(
        "shrink-0 text-xs whitespace-nowrap text-danger tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A numeric cell's share of the column's largest, as a hairline of at most
 * 3rem under the figure and ending at its right edge; it takes no height,
 * so the figure keeps the row's line.
 */
function TableMagnitude({ fraction }: { fraction: number }) {
  return (
    <MagnitudeBar
      fraction={fraction}
      from="end"
      className="-mb-1.75 mt-1.25 ml-auto w-12"
    />
  );
}

export {
  Table,
  TableBody,
  TableCell,
  TableFlag,
  TableHead,
  TableHeader,
  TableLabel,
  TableMagnitude,
  TableRow,
  TableSecondary,
  TableSort,
};
