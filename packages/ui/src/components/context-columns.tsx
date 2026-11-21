import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Hue, tintClass } from "#lib/hue.ts";
import { cn } from "#lib/utils.ts";

interface ContextColumn {
  readonly key: string;
  /** Blocks above the baseline: the largest prompt size the column holds. */
  readonly blocks: number;
  /** The other requests of its stretch, a small block each under the baseline, at most `mostOthers` of them drawn. */
  readonly others: number;
  readonly danger: boolean;
  /** On a column that begins a segment after the first, the words beside the rule before it. */
  readonly opens: string | null;
  /** What the column holds, read when it is hovered or focused; its `strong` parts read as figures. */
  readonly readout: ReactNode;
}

interface ContextLayout {
  readonly columns: ReadonlyArray<ContextColumn>;
}

const smallestPitch = 6;
const largestPitch = 14;
const mostOthers = 3;
const labelRow = 16;
const tickRow = 18;
const characterWidth = 7;

const stepOf = (
  key: string,
  active: number | null,
  last: number,
): number | null | undefined => {
  if (last < 0) return undefined;
  if (key === "ArrowRight")
    return active === null ? 0 : Math.min(last, active + 1);
  if (key === "ArrowLeft")
    return active === null ? last : Math.max(0, active - 1);
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (key === "Escape") return null;
  return undefined;
};

/**
 * A session's main requests as columns of blocks, oldest left, each as tall
 * as the largest prompt it holds, with a rule before each new segment, the
 * danger mark over a column with an error, and the other requests as small
 * blocks under the baseline. `fit` is asked for the columns once the chart
 * knows how many fit across it, a gap before each segment counted as one.
 * Hovering or focusing a column reads it; clicking it, or Enter, calls
 * `onActivate` with its key.
 */
function ContextColumns({
  fit,
  hue,
  label,
  start,
  end,
  onActivate,
  className,
}: {
  fit: (capacity: number) => ContextLayout;
  hue: Hue;
  label: string;
  start: string;
  end: string;
  onActivate: (key: string) => void;
  className?: string;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const node = plot.current;
    if (node === null) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () =>
      width === 0 ? null : fit(Math.max(1, Math.floor(width / smallestPitch))),
    [fit, width],
  );
  const columns = layout?.columns ?? [];
  const slots = columns.reduce(
    (sum, column) => sum + (column.opens === null ? 1 : 2),
    0,
  );
  const pitch = Math.max(
    smallestPitch,
    Math.min(largestPitch, width / Math.max(1, slots)),
  );
  const gap = pitch >= 9 ? 2 : 1;
  const side = pitch - gap;
  const small = Math.max(2, Math.round(side / 2));
  const rows = Math.max(1, ...columns.map((column) => column.blocks));
  const top = labelRow + small + 3;
  const base = top + rows * pitch;
  const below = mostOthers * (small + 1) + 3;
  const drawn = slots * pitch;
  const focus = active === null ? undefined : columns[active];

  const fitsAfter = (x: number, words: string) =>
    x - pitch / 2 + 2 + words.length * characterWidth <= Math.max(width, drawn);

  const lefts: Array<number> = [];
  let slot = 0;
  for (const column of columns) {
    if (column.opens !== null) slot += 1;
    lefts.push(slot * pitch);
    slot += 1;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Enter" || event.key === " ") && active !== null) {
      event.preventDefault();
      const column = columns[active];
      if (column !== undefined) onActivate(column.key);
      return;
    }
    const next = stepOf(event.key, active, columns.length - 1);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  const columnAt = (event: MouseEvent<HTMLDivElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const x = event.clientX - left + event.currentTarget.scrollLeft;
    const at = lefts.findIndex((each) => x >= each && x < each + pitch);
    return at === -1 ? null : at;
  };

  return (
    <div data-slot="context-columns" className={cn("min-w-0", className)}>
      <div
        aria-live="polite"
        className="mb-2.5 flex min-h-5 flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-text-2 tabular-nums [&_strong]:font-medium [&_strong]:text-text"
      >
        {focus?.readout}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls, and this is a chart read with the arrow keys */}
      <div
        ref={plot}
        role="group"
        aria-label={`${label}. Use the arrow keys to read each column, and Enter to show its requests.`}
        tabIndex={columns.length > 0 ? 0 : -1}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onMouseMove={(event) => setActive(columnAt(event))}
        onMouseLeave={() => setActive(null)}
        onClick={(event) => {
          const at = columnAt(event);
          const column = at === null ? undefined : columns[at];
          if (column !== undefined) onActivate(column.key);
        }}
        className="relative cursor-pointer overflow-x-auto rounded-control outline-none [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-text"
      >
        {layout === null ? (
          <svg
            aria-hidden="true"
            focusable="false"
            width={0}
            height={base + below + tickRow}
            className="block"
          />
        ) : (
          <svg
            aria-hidden="true"
            focusable="false"
            width={Math.max(width, drawn)}
            height={base + below + tickRow}
            className="block"
          >
            {columns.map((column, index) => {
              const x = lefts[index] ?? 0;
              const height = column.blocks * pitch;
              const others = Math.min(mostOthers, column.others);
              return (
                <g
                  key={column.key}
                  className={cn(
                    "transition-state",
                    active !== null && active !== index && "opacity-35",
                  )}
                >
                  {column.opens === null ? null : (
                    <g>
                      <line
                        x1={x - pitch / 2 - gap / 2}
                        x2={x - pitch / 2 - gap / 2}
                        y1={labelRow - 2}
                        y2={base + below}
                        strokeDasharray="2 2"
                        className="stroke-text-3"
                      />
                      <text
                        x={
                          fitsAfter(x, column.opens)
                            ? x - pitch / 2 + 2
                            : x - pitch - 2
                        }
                        y={labelRow - 6}
                        textAnchor={
                          fitsAfter(x, column.opens) ? "start" : "end"
                        }
                        className="fill-text-3 text-xs"
                      >
                        {column.opens}
                      </text>
                    </g>
                  )}
                  <g className={cn("fill-hue", tintClass[hue])}>
                    {Array.from({ length: column.blocks }, (_, level) => (
                      <rect
                        // biome-ignore lint/suspicious/noArrayIndexKey: a column's blocks are its levels, in order
                        key={level}
                        x={x}
                        y={base - (level + 1) * pitch}
                        width={side}
                        height={side}
                        rx={pitch >= 9 ? 2 : 1}
                      />
                    ))}
                  </g>
                  {column.danger ? (
                    <rect
                      x={x + (side - small) / 2}
                      y={base - height - small - 3}
                      width={small}
                      height={small}
                      rx={1}
                      className="fill-danger"
                    />
                  ) : null}
                  <g className="fill-text-3">
                    {Array.from({ length: others }, (_, at) => (
                      <rect
                        // biome-ignore lint/suspicious/noArrayIndexKey: the blocks under a column are counted, not named
                        key={at}
                        x={x + (side - small) / 2}
                        y={base + 3 + at * (small + 1)}
                        width={small}
                        height={small}
                        rx={1}
                      />
                    ))}
                  </g>
                </g>
              );
            })}
            <line
              x1={0}
              x2={Math.max(width, drawn)}
              y1={base + 0.5}
              y2={base + 0.5}
              className="stroke-border-strong"
            />
            <text
              x={0}
              y={base + below + tickRow - 4}
              className="fill-text-3 text-xs tabular-nums"
            >
              {start}
            </text>
            <text
              x={Math.min(Math.max(width, drawn), drawn - gap)}
              y={base + below + tickRow - 4}
              textAnchor="end"
              className="fill-text-3 text-xs tabular-nums"
            >
              {end}
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}

/** What a mark of the context columns stands for: a column in its hue, another request, an error, or a new segment. */
function ContextKey({
  mark,
  hue = "neutral",
  className,
  children,
}: {
  mark: "column" | "other" | "error" | "segment";
  hue?: Hue;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li
      data-slot="context-key"
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
    >
      {mark === "segment" ? (
        <span
          aria-hidden="true"
          className="h-3 w-0 shrink-0 border-l border-dashed border-text-3"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 rounded-block",
            mark === "column" && cn("size-2.5 bg-hue", tintClass[hue]),
            mark === "other" && "size-1.5 bg-text-3",
            mark === "error" && "size-1.5 bg-danger",
          )}
        />
      )}
      {children}
    </li>
  );
}

export { type ContextColumn, ContextColumns, ContextKey, type ContextLayout };
