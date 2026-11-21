import { type Hue, tintClass } from "#lib/hue.ts";
import { cn } from "#lib/utils.ts";

/**
 * A hairline as long as `fraction` of its track, from 0 to 1, and never
 * shorter than a few pixels when above nothing: a row's size beside the
 * largest. In a pool's `hue`, or neutral; from the track's `end` under a
 * figure aligned right.
 */
function MagnitudeBar({
  fraction,
  hue,
  from = "start",
  className,
}: {
  fraction: number;
  hue?: Hue;
  from?: "start" | "end";
  className?: string;
}) {
  const shown = Math.min(1, Math.max(0, fraction));
  return (
    <svg
      data-slot="magnitude-bar"
      aria-hidden="true"
      focusable="false"
      className={cn(
        "block h-0.5 w-full",
        hue === undefined ? "fill-text-3/60" : cn("fill-hue", tintClass[hue]),
        className,
      )}
    >
      {shown > 0 ? (
        <>
          <rect
            {...(from === "end"
              ? { x: "100%", transform: "translate(-4 0)" }
              : {})}
            width="4"
            height="100%"
            rx="1"
          />
          <rect
            x={from === "end" ? `${(1 - shown) * 100}%` : 0}
            width={`${shown * 100}%`}
            height="100%"
            rx="1"
          />
        </>
      ) : null}
    </svg>
  );
}

export { MagnitudeBar };
