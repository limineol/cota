import { type Hue, tintClass } from "#lib/hue.ts";
import { cn } from "#lib/utils.ts";

type Severity = "normal" | "near" | "full";

const fills: Record<Severity, { block: string; part: string }> = {
  normal: { block: "bg-hue", part: "fill-hue" },
  near: { block: "bg-warn", part: "fill-warn" },
  full: { block: "bg-danger", part: "fill-danger" },
};

const sizes = {
  card: { row: "gap-0.5", block: "h-2" },
  detail: { row: "gap-[3px]", block: "h-3.5" },
};

/**
 * A quota window as twenty blocks, each filled from 0 to 1 as `blocks` says,
 * with the pace marker at `pace` along the track.
 */
function BlockMeter({
  blocks,
  pace,
  severity,
  hue,
  label,
  valueText,
  size = "card",
  className,
}: {
  blocks: ReadonlyArray<number>;
  pace: number | null;
  severity: Severity;
  hue: Hue;
  label: string;
  valueText: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const fill = fills[severity];
  const used = blocks.reduce((sum, block) => sum + block, 0) * 5;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <meter> renders none of its children, and the blocks are drawn as its children
    <div
      data-slot="block-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(used)}
      aria-valuetext={valueText}
      className={cn("relative", tintClass[hue], className)}
    >
      <div className={cn("grid grid-cols-20", sizes[size].row)}>
        {blocks.map((block, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a meter's twenty blocks are its positions
            key={index}
            className={cn(
              "relative overflow-hidden rounded-block",
              sizes[size].block,
              block === 1 ? fill.block : "bg-hue-track",
            )}
          >
            {block > 0 && block < 1 ? (
              <svg
                aria-hidden="true"
                className="absolute inset-0 size-full"
                focusable="false"
              >
                <rect
                  width={`${block * 100}%`}
                  height="100%"
                  className={fill.part}
                />
                <rect width="2" height="100%" className={fill.part} />
              </svg>
            ) : null}
          </span>
        ))}
      </div>
      {pace === null ? null : (
        <svg
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute top-[-3px] left-0 h-[calc(100%+6px)] w-full overflow-visible"
        >
          <rect
            x={`${pace * 100}%`}
            width="6"
            height="100%"
            rx="3"
            transform="translate(-3 0)"
            className="fill-[var(--meter-ring,var(--surface))]"
          />
          <rect
            x={`${pace * 100}%`}
            width="2"
            height="100%"
            rx="1"
            transform="translate(-1 0)"
            className="fill-text"
          />
        </svg>
      )}
    </div>
  );
}

export { BlockMeter };
