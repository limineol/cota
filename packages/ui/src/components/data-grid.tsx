import { X } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "#lib/utils.ts";
import { Button } from "./button.tsx";

/** The height of a row of a data grid, in pixels. */
const dataGridRowHeight = 28;

/** The height of a data grid's head, its columns' names over their types, in pixels. */
const headHeight = 44;

const widths = {
  xs: "w-20",
  sm: "w-28",
  md: "w-40",
  lg: "w-60",
  xl: "w-96",
} as const;

type DataGridWidth = keyof typeof widths;

interface DataGridColumn {
  readonly name: string;
  readonly type: string;
  /** Whether its values are numbers, set right and in tabular figures. */
  readonly numeric: boolean;
  readonly width: DataGridWidth;
}

/** What a cell shows: its text, cut short where it is long; nothing, for an empty string; or a null. */
type DataGridValue =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "empty" }
  | { readonly kind: "null" };

interface DataGridCell {
  readonly row: number;
  readonly column: number;
}

/** Which rows are drawn, from `first` up to but not including `last`. */
interface DataGridDrawn {
  readonly first: number;
  readonly last: number;
}

const overscan = 10;

/**
 * A panel holding a grid of an answer, what is said about it and the cell
 * inspected. While `stale`, as when another run is on its way, it is dimmed
 * to 55% after 150 ms.
 */
function DataGridPanel({
  stale = false,
  className,
  ...props
}: ComponentProps<"div"> & { stale?: boolean }) {
  return (
    <div
      data-slot="data-grid-panel"
      data-stale={stale ? "" : undefined}
      aria-busy={stale || undefined}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface transition-state delay-150 data-stale:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

function Spacer({ height }: { height: number }) {
  return height === 0 ? null : (
    <svg aria-hidden="true" className="block" width="1" height={height} />
  );
}

function CellValue({ value }: { value: DataGridValue }) {
  switch (value.kind) {
    case "null":
      return (
        <>
          <span
            aria-hidden="true"
            className="font-sans text-xs font-medium tracking-wide text-text-3"
          >
            NULL
          </span>
          <span className="sr-only">null</span>
        </>
      );
    case "empty":
      return <span className="sr-only">empty string</span>;
    case "text":
      return value.text;
  }
}

/**
 * The rows of an answer under its columns' names and types, drawn only where
 * they are seen: `drawn` is asked which rows to draw for the view, scrolled
 * `top` pixels into the rows and `height` tall, and `cell` for each cell of
 * those. A click, or Enter on the cell the arrow keys reached, calls
 * `onInspect`; the inspected cell is `inspected`.
 */
function DataGrid({
  label,
  columns,
  rows,
  drawn,
  cell,
  inspected = null,
  onInspect,
  className,
}: {
  label: string;
  columns: ReadonlyArray<DataGridColumn>;
  rows: number;
  drawn: (view: { top: number; height: number }) => DataGridDrawn;
  cell: (row: number, column: number) => DataGridValue;
  inspected?: DataGridCell | null;
  onInspect: (cell: DataGridCell) => void;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const [active, setActive] = useState<DataGridCell>({ row: 0, column: 0 });
  const [focusing, setFocusing] = useState(false);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = () =>
      setView({
        top: element.scrollTop,
        height: Math.max(0, element.clientHeight - headHeight),
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!focusing) return;
    setFocusing(false);
    const target = table.current?.querySelector<HTMLElement>(
      `[data-row="${active.row}"][data-column="${active.column}"]`,
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusing, active]);

  const { first, last } = drawn(view);
  const held = {
    row: Math.min(active.row, Math.max(0, rows - 1)),
    column: Math.min(active.column, Math.max(0, columns.length - 1)),
  };

  const moveTo = (row: number, column: number) => {
    const next = {
      row: Math.min(Math.max(0, row), rows - 1),
      column: Math.min(Math.max(0, column), columns.length - 1),
    };
    const element = scroller.current;
    if (element !== null) {
      const above = next.row * dataGridRowHeight;
      const below = headHeight + (next.row + 1) * dataGridRowHeight;
      if (above < element.scrollTop) element.scrollTop = above;
      if (below > element.scrollTop + element.clientHeight) {
        element.scrollTop = below - element.clientHeight;
      }
    }
    setActive(next);
    setFocusing(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (rows === 0) return;
    const page = Math.max(1, Math.floor(view.height / dataGridRowHeight) - 1);
    const whole = event.ctrlKey || event.metaKey;
    switch (event.key) {
      case "ArrowDown":
        moveTo(held.row + 1, held.column);
        break;
      case "ArrowUp":
        moveTo(held.row - 1, held.column);
        break;
      case "ArrowRight":
        moveTo(held.row, held.column + 1);
        break;
      case "ArrowLeft":
        moveTo(held.row, held.column - 1);
        break;
      case "PageDown":
        moveTo(held.row + page, held.column);
        break;
      case "PageUp":
        moveTo(held.row - page, held.column);
        break;
      case "Home":
        moveTo(whole ? 0 : held.row, 0);
        break;
      case "End":
        moveTo(whole ? rows - 1 : held.row, columns.length - 1);
        break;
      case "Enter":
      case " ":
        onInspect(held);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const drawnRows = Array.from(
    { length: Math.max(0, last - first) },
    (_, offset) => first + offset,
  );
  const spacer = (height: number) =>
    height === 0 ? null : (
      // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: the room of the rows not drawn is no row of the grid
      <tr role="presentation">
        <td
          role="presentation"
          colSpan={columns.length + 1}
          className="border-0 p-0"
        >
          <Spacer height={height} />
        </td>
      </tr>
    );

  return (
    <div
      ref={scroller}
      data-slot="data-grid"
      onScroll={(event) => {
        const { scrollTop, clientHeight } = event.currentTarget;
        setView({
          top: scrollTop,
          height: Math.max(0, clientHeight - headHeight),
        });
      }}
      className={cn(
        "relative max-h-112 min-h-0 overflow-auto [scrollbar-width:thin]",
        className,
      )}
    >
      <table
        ref={table}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a table whose cells the arrow keys reach is the WAI-ARIA data grid
        role="grid"
        aria-label={label}
        aria-rowcount={rows + 1}
        aria-colcount={columns.length + 1}
        onKeyDown={onKeyDown}
        className="w-0 min-w-full table-fixed border-separate border-spacing-0 text-sm"
      >
        <thead className="sticky top-0 z-10 bg-surface">
          <tr aria-rowindex={1} className="h-11">
            <th
              scope="col"
              aria-colindex={1}
              className="sticky left-0 z-10 w-14 border-r border-b border-r-border border-b-border-strong bg-surface pr-2.5 text-right text-xs font-normal text-text-3"
            >
              <span aria-hidden="true">#</span>
              <span className="sr-only">Row</span>
            </th>
            {columns.map((column, index) => (
              <th
                // biome-ignore lint/suspicious/noArrayIndexKey: an answer's columns may share a name; a column is its place
                key={index}
                scope="col"
                aria-colindex={index + 2}
                title={`${column.name} · ${column.type}`}
                className={cn(
                  "truncate border-r border-b border-r-border border-b-border-strong px-2.5 text-left font-normal",
                  widths[column.width],
                  column.numeric && "text-right",
                )}
              >
                <span className="block truncate font-medium text-text">
                  {column.name}
                </span>
                <span className="block truncate font-mono text-xs text-text-3">
                  {column.type}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spacer(first * dataGridRowHeight)}
          {drawnRows.map((row) => (
            <tr
              key={row}
              aria-rowindex={row + 2}
              className="h-7 hover:bg-surface-2"
            >
              <th
                scope="row"
                aria-colindex={1}
                className="sticky left-0 border-r border-b border-r-border border-b-border/60 bg-surface pr-2.5 text-right text-xs font-normal text-text-3 tabular-nums"
              >
                {row + 1}
              </th>
              {columns.map((column, index) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the grid's own keys move between cells, and Enter inspects the one reached
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: an answer's columns may share a name; a column is its place
                  key={index}
                  // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a cell of a data grid is a gridcell, which can be selected
                  role="gridcell"
                  aria-colindex={index + 2}
                  aria-selected={
                    inspected?.row === row && inspected.column === index
                  }
                  tabIndex={held.row === row && held.column === index ? 0 : -1}
                  data-row={row}
                  data-column={index}
                  onClick={() => {
                    setActive({ row, column: index });
                    onInspect({ row, column: index });
                  }}
                  className={cn(
                    "cursor-pointer truncate border-r border-b border-r-border/60 border-b-border/60 px-2.5 font-mono text-text-2 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text aria-selected:bg-surface-3 aria-selected:text-text",
                    column.numeric && "text-right text-text tabular-nums",
                  )}
                >
                  <CellValue value={cell(row, index)} />
                </td>
              ))}
            </tr>
          ))}
          {spacer(Math.max(0, rows - last) * dataGridRowHeight)}
        </tbody>
      </table>
    </div>
  );
}

/** A line about the answer under its grid: its figures, a note, and actions at its end. */
function DataGridFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="data-grid-foot"
      className={cn(
        "flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-border px-3.5 py-2 text-sm text-text-3 tabular-nums [&_strong]:font-medium [&_strong]:text-text",
        className,
      )}
      {...props}
    />
  );
}

/** Actions at the end of the foot. */
function DataGridActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="data-grid-actions"
      className={cn("ml-auto flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

/** What the panel says in place of a grid: that the answer has no rows, or no columns. */
function DataGridMessage({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="data-grid-message"
      className={cn(
        "flex flex-col gap-1 px-3.5 py-6 text-text-2 [&_p]:m-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The whole value of the cell inspected, under a line naming its row and
 * column, with `actions` (a copy) and a button that closes it.
 */
function DataGridInspector({
  title,
  actions,
  onClose,
  className,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-slot="data-grid-inspector"
      aria-label="The value inspected"
      className={cn(
        "flex flex-col gap-2 border-t border-border px-3.5 pt-2.5 pb-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 text-sm text-text-2">
        <div className="min-w-0 truncate [&_code]:font-mono [&_code]:text-text-3 [&_strong]:font-medium [&_strong]:text-text">
          {title}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close the value"
            title="Close the value"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
      {children}
    </section>
  );
}

/** A value that is text, whole, as it was written. */
function DataGridText({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      data-slot="data-grid-text"
      className={cn(
        "m-0 max-h-80 overflow-auto rounded-panel border border-border bg-surface-2 px-3.5 py-3 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-text-2",
        className,
      )}
      {...props}
    />
  );
}

export {
  DataGrid,
  DataGridActions,
  type DataGridCell,
  type DataGridColumn,
  type DataGridDrawn,
  DataGridFoot,
  DataGridInspector,
  DataGridMessage,
  DataGridPanel,
  DataGridText,
  type DataGridValue,
  type DataGridWidth,
  dataGridRowHeight,
  overscan as dataGridOverscan,
};
