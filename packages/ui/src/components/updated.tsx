import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#lib/utils.ts";
import { Button } from "./button.tsx";

/**
 * When what a screen shows was read, and a button to read it again, which
 * turns while a read is under way.
 */
function Updated({
  children,
  busy,
  onRefresh,
  label = "Refresh now",
  className,
}: {
  children: ReactNode;
  busy: boolean;
  onRefresh: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <div
      data-slot="updated"
      className={cn(
        "flex items-center gap-1 text-sm text-text-3 tabular-nums",
        className,
      )}
    >
      <span aria-live="polite">{children}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        onClick={onRefresh}
      >
        <RefreshCw
          className={cn(busy && "motion-safe:animate-spin")}
          aria-hidden="true"
        />
      </Button>
    </div>
  );
}

export { Updated };
