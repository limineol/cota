import type { ReactNode } from "react";
import { type Hue, tintClass } from "#lib/hue.ts";
import { cn } from "#lib/utils.ts";

const sizes = {
  sm: "size-3.5",
  md: "size-5",
  lg: "size-6",
};

/**
 * A pool's mark in its hue: the glyph given, drawn in `currentColor`, or the
 * pool's initial in a rounded square. Decorative unless it has a `label`.
 */
function PoolMark({
  hue,
  name,
  glyph,
  label,
  size = "sm",
  className,
}: {
  hue: Hue;
  name: string;
  glyph?: ReactNode;
  label?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "";
  return (
    <span
      data-slot="pool-mark"
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
      className={cn(
        "inline-flex shrink-0 text-hue [&>svg]:size-full",
        tintClass[hue],
        sizes[size],
        className,
      )}
    >
      {glyph ?? (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="currentColor"
          focusable="false"
        >
          <rect
            x="0.75"
            y="0.75"
            width="14.5"
            height="14.5"
            rx="4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          />
          <text
            x="8"
            y="11.6"
            textAnchor="middle"
            fontSize="9.5"
            fontWeight={700}
          >
            {initial}
          </text>
        </svg>
      )}
    </span>
  );
}

export { PoolMark };
