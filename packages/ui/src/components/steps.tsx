import { Check, CircleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/** Numbered steps, joined by a line: what the owner does, in order. */
function Steps({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="steps"
      className={cn("m-0 flex list-none flex-col p-0", className)}
      {...props}
    />
  );
}

type StepState = "done" | "current" | "ahead" | "refused";

const said: Record<StepState, string> = {
  done: "done",
  current: "now",
  ahead: "to come",
  refused: "refused",
};

function StepMark({
  number,
  state,
}: {
  readonly number: number;
  readonly state: StepState;
}) {
  return (
    <span
      data-state={state}
      className="grid size-6 shrink-0 place-items-center rounded-control border text-sm tabular-nums data-[state=ahead]:border-border-strong data-[state=ahead]:text-text-3 data-[state=current]:border-text data-[state=current]:font-medium data-[state=current]:text-text data-[state=done]:border-text data-[state=done]:bg-text data-[state=done]:text-on-text data-[state=refused]:border-danger data-[state=refused]:text-danger"
    >
      {state === "done" ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : state === "refused" ? (
        <CircleAlert aria-hidden="true" className="size-3.5" />
      ) : (
        <span aria-hidden="true">{number}</span>
      )}
    </span>
  );
}

/**
 * One step: its mark (its number, a tick once done, an alert when what it
 * asked for was refused), its title, and what helps with it.
 */
function Step({
  number,
  state,
  title,
  className,
  children,
  ...props
}: Omit<ComponentProps<"li">, "title"> & {
  readonly number: number;
  readonly state: StepState;
  readonly title: ReactNode;
}) {
  return (
    <li
      data-slot="step"
      data-state={state}
      aria-current={state === "current" ? "step" : undefined}
      className={cn(
        "group/step grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-4",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col items-center">
        <StepMark number={number} state={state} />
        <span className="mt-1.5 w-px flex-1 bg-border group-last/step:hidden" />
      </div>
      <div className="flex min-w-0 flex-col gap-2 pb-7 group-last/step:pb-0">
        <p className="m-0 pt-0.5 text-base font-medium text-text group-data-[state=ahead]/step:text-text-2">
          <span className="sr-only">
            Step {number}, {said[state]}:{" "}
          </span>
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}

export { Step, type StepState, Steps };
