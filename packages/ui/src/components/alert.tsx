import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-panel border bg-surface px-3 py-2.5 text-left text-base has-data-[slot=alert-action]:pr-24 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-border-strong *:[svg]:text-text-2",
        danger: "border-danger/40 *:[svg]:text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/** A problem or a notice, announced as it appears. */
function Alert({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium text-text group-has-[>svg]/alert:col-start-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-text-2 text-pretty group-has-[>svg]/alert:col-start-2",
        className,
      )}
      {...props}
    />
  );
}

/** What a machine said, as it said it: a message set in mono, wrapped, under the alert's own words. */
function AlertCode({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      data-slot="alert-code"
      className={cn(
        "m-0 mt-1.5 max-h-60 overflow-auto font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-text group-has-[>svg]/alert:col-start-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  );
}

export { Alert, AlertAction, AlertCode, AlertDescription, AlertTitle };
