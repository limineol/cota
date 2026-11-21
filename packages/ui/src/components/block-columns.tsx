import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Tint, tintClass } from "#lib/hue.ts";
import { cn } from "#lib/utils.ts";

interface Series {
  readonly key: string;
  readonly label: string;
  readonly tint: Tint;
  readonly mark?: ReactNode;
}

interface ColumnPart {
  readonly blocks: number;
  /** The part's value as written, or null when the bucket has none of it. */
  readonly value: string | null;
}

interface BlockColumn {
  readonly key: string;
  /** The bucket's span, as the readout names it. */
  readonly label: string;
  /** The bucket's start, as an axis tick. */
  readonly tick: string;
  readonly total: string;
  /** One per series, in the series' order. */
  readonly parts: ReadonlyArray<ColumnPart>;
}

interface ColumnsLayout {
  /** One block's worth, as the readout names it. */
  readonly unit: string;
  readonly columns: ReadonlyArray<BlockColumn>;
}

const smallestPitch = 6;
const largestPitch = 18;
const tickRow = 18;

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
 * Stacked columns of blocks of one unit, drawn as SVG at the width of their
 * container. `fit` is asked for the columns once the chart knows how many fit
 * across it.
 */
function BlockColumns({
  series,
  fit,
  label,
  empty,
  className,
}: {
  series: ReadonlyArray<Series>;
  fit: (capacity: number) => ColumnsLayout;
  label: string;
  empty: ReactNode;
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
  const heights = columns.map((column) =>
    column.parts.reduce((sum, part) => sum + part.blocks, 0),
  );
  const hasData = heights.some((height) => height > 0);
  const pitch = Math.min(largestPitch, width / Math.max(1, columns.length));
  const gap = pitch >= 9 ? 2 : 1;
  const rows = Math.max(1, ...heights);
  const base = rows * pitch;
  const ticks = Math.min(width < 500 ? 3 : 6, columns.length);
  const focus = active === null ? undefined : columns[active];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = stepOf(event.key, active, columns.length - 1);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const at = Math.floor((event.clientX - left) / pitch);
    setActive(at >= 0 && at < columns.length ? at : null);
  };

  return (
    <div data-slot="block-columns" className={cn("min-w-0", className)}>
      <div
        aria-live="polite"
        className="mb-2.5 flex min-h-5 flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-text-2"
      >
        {focus !== undefined ? (
          <>
            <strong className="font-medium text-text tabular-nums">
              {focus.label}
            </strong>
            <span className="tabular-nums">{focus.total} total</span>
            {series.map((entry, index) => {
              const value = focus.parts[index]?.value ?? null;
              return value === null ? null : (
                <span
                  key={entry.key}
                  className="inline-flex items-center gap-1.5"
                >
                  {entry.mark ?? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-block bg-hue",
                        tintClass[entry.tint],
                      )}
                    />
                  )}
                  {entry.label}
                  <span className="text-text tabular-nums">{value}</span>
                </span>
              );
            })}
          </>
        ) : layout !== null && hasData ? (
          <span>
            One block is <span className="tabular-nums">{layout.unit}</span>.
            Hover a column, or focus the chart and use the arrow keys.
          </span>
        ) : null}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls, and this is a chart read with the arrow keys */}
      <div
        ref={plot}
        role="group"
        aria-label={`${label}. Use the arrow keys to read each column.`}
        tabIndex={hasData ? 0 : -1}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onMouseMove={hasData ? onMouseMove : undefined}
        onMouseLeave={() => setActive(null)}
        className="relative rounded-control outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-text"
      >
        {layout === null ? null : !hasData ? (
          <div className="py-12 text-center text-text-2">{empty}</div>
        ) : (
          <svg
            aria-hidden="true"
            focusable="false"
            width={width}
            height={base + 1 + tickRow}
            className="block overflow-visible"
          >
            {columns.map((column, index) => {
              let level = 0;
              const x = index * pitch;
              return (
                <g
                  key={column.key}
                  className={cn(
                    "transition-state",
                    active !== null && active !== index && "opacity-35",
                  )}
                >
                  {column.parts.map((part, at) => {
                    const tint = series[at]?.tint ?? "neutral";
                    return (
                      <g
                        // biome-ignore lint/suspicious/noArrayIndexKey: a column's parts are the series, in order
                        key={at}
                        className={cn("fill-hue", tintClass[tint])}
                      >
                        {Array.from({ length: part.blocks }, () => {
                          level += 1;
                          return (
                            <rect
                              key={level}
                              x={x}
                              y={base - level * pitch}
                              width={pitch - gap}
                              height={pitch - gap}
                              rx={pitch >= 9 ? 2 : 1}
                            />
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <line
              x1={0}
              x2={width}
              y1={base + 0.5}
              y2={base + 0.5}
              className="stroke-border-strong"
            />
            {Array.from({ length: ticks }, (_, index) => {
              const at = Math.round(
                (index / Math.max(1, ticks - 1)) * (columns.length - 1),
              );
              const column = columns[at];
              const anchor =
                index === 0 ? "start" : index === ticks - 1 ? "end" : "middle";
              const x =
                anchor === "start"
                  ? at * pitch
                  : anchor === "end"
                    ? (at + 1) * pitch - gap
                    : (at + 0.5) * pitch;
              return column === undefined ? null : (
                <text
                  key={column.key}
                  x={x}
                  y={base + 1 + tickRow - 4}
                  textAnchor={anchor}
                  className="fill-text-3 text-xs tabular-nums"
                >
                  {column.tick}
                </text>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export { type BlockColumn, BlockColumns, type ColumnsLayout, type Series };
