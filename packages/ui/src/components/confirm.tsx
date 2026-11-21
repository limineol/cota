import { type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "#lib/utils.ts";
import { Button } from "./button.tsx";

/**
 * A question asked once, in place, before something that cannot be taken
 * back: what it does and what it costs, the danger button that does it and
 * a quiet one that does not. It takes the focus on its way in, on the
 * button that does nothing, and Escape is that button.
 */
function Confirm({
  question,
  confirm,
  cancel = "Cancel",
  pending = false,
  onConfirm,
  onCancel,
  className,
}: {
  question: ReactNode;
  confirm: string;
  cancel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const label = useId();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <fieldset
      data-slot="confirm"
      aria-labelledby={label}
      className={cn(
        "m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-2",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <p id={label} className="m-0 min-w-0 text-pretty">
        {question}
      </p>
      <span className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={onConfirm}
        >
          {confirm}
        </Button>
        <Button
          ref={keep}
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onCancel}
        >
          {cancel}
        </Button>
      </span>
    </fieldset>
  );
}

export { Confirm };
