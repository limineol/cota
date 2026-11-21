import { Button } from "@cota/ui/components/button";
import { Toggles } from "@cota/ui/components/toggles";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@cota/ui/components/tooltip";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { counted } from "#shared/words.ts";
import { type Expansion, type Hideable, hideable } from "./transcript.tsx";

const labels: Record<Hideable, string> = {
  reasoning: "Reasoning",
  tools: "Tool calls",
  context: "Context",
};

const expansions = [
  { label: "Expand all", open: true, Icon: ChevronsUpDown },
  { label: "Collapse all", open: false, Icon: ChevronsDownUp },
] as const;

/** The toggles that choose what a transcript shows, each with how many rows it holds, and the buttons that open or close every row. */
export function TranscriptControls({
  counts,
  hidden,
  onHiddenChange,
  onExpansion,
}: {
  readonly counts: Readonly<Record<Hideable, number>>;
  readonly hidden: ReadonlySet<Hideable>;
  readonly onHiddenChange: (switched: Hideable, hide: boolean) => void;
  readonly onExpansion: (expansion: Expansion) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggles
        label="What the transcript shows"
        pressed={hideable.filter((each) => !hidden.has(each))}
        options={hideable.map((each) => ({
          value: each,
          label: labels[each],
          count: counted(counts[each]),
        }))}
        onPressedChange={(each, pressed) => onHiddenChange(each, !pressed)}
      />
      <div className="flex items-center gap-0.5">
        {expansions.map(({ label, open, Icon }) => (
          <Tooltip key={label}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  onClick={() => onExpansion({ open })}
                />
              }
            >
              <Icon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
