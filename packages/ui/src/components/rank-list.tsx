import type { ComponentProps, ReactNode } from "react";
import type { Hue } from "#lib/hue.ts";
import { cn } from "#lib/utils.ts";
import { MagnitudeBar } from "./magnitude-bar.tsx";

/** The few largest of something, in order, each with its figure and a bar beside the largest. */
function RankList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="rank-list"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

function RankItem({
  label,
  value,
  fraction,
  hue,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  fraction: number;
  hue?: Hue;
  className?: string;
}) {
  return (
    <li
      data-slot="rank-item"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-1.5 text-base tabular-nums",
        className,
      )}
    >
      <span className="min-w-0 truncate text-text">{label}</span>
      <span className="text-text-2">{value}</span>
      <MagnitudeBar
        fraction={fraction}
        {...(hue === undefined ? {} : { hue })}
        className="col-span-full"
      />
    </li>
  );
}

export { RankItem, RankList };
