import { cn } from "#lib/utils.ts";

const lit: ReadonlyArray<boolean> = [
  false,
  true,
  false,
  false,
  true,
  false,
  true,
  false,
  false,
  false,
  false,
  true,
  true,
  true,
  false,
  true,
];

const sizes = {
  md: "size-5",
  lg: "size-7",
};

/** Cota's mark: a 4×4 pavement whose lit stones trace one crest of a wave. Decorative. */
function Mark({
  size = "md",
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <svg
      data-slot="mark"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      className={cn("shrink-0", sizes[size], className)}
    >
      {lit.map((on, index) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the sixteen stones are their positions
          key={index}
          x={(index % 4) * 5 + 0.5}
          y={Math.floor(index / 4) * 5 + 0.5}
          width={3.5}
          height={3.5}
          rx={1}
          className={on ? "fill-text" : "fill-border-strong"}
        />
      ))}
    </svg>
  );
}

export { Mark };
