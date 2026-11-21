import type { ReactNode } from "react";
import { type Tint, tintClass } from "#lib/hue.ts";
import { cn } from "#lib/utils.ts";

interface MixPart {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly share: string;
  readonly blocks: number;
  readonly tint: Tint;
}

/**
 * The parts of a total as a run of blocks, each part's `blocks` in its tint,
 * with a legend of each part's label, value and share. A mix of no blocks
 * shows `empty`.
 */
function BlockMix({
  parts,
  label,
  empty,
  className,
}: {
  parts: ReadonlyArray<MixPart>;
  label: string;
  empty: ReactNode;
  className?: string;
}) {
  const drawn = parts.reduce((sum, part) => sum + part.blocks, 0);
  if (drawn === 0) {
    return (
      <div data-slot="block-mix" className={cn("text-text-2", className)}>
        {empty}
      </div>
    );
  }
  return (
    <div data-slot="block-mix" className={cn("@container", className)}>
      <div
        role="img"
        aria-label={`${label}: ${parts.map((part) => `${part.label} ${part.value}, ${part.share}`).join("; ")}`}
        className="grid max-w-[980px] grid-cols-50 gap-[3px] @max-md:grid-cols-25"
      >
        {parts.flatMap((part) =>
          Array.from({ length: part.blocks }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a part's blocks are alike, and its index is all that tells them apart
              key={`${part.key}-${index}`}
              className={cn(
                "aspect-square rounded-block bg-hue",
                tintClass[part.tint],
              )}
            />
          )),
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-[22px] gap-y-1.5 text-sm">
        {parts.map((part) => (
          <li key={part.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-block bg-hue",
                tintClass[part.tint],
              )}
            />
            <span className="text-text-2">{part.label}</span>
            <span className="font-medium text-text tabular-nums">
              {part.value}
            </span>
            <span className="text-text-3 tabular-nums">{part.share}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { BlockMix, type MixPart };
