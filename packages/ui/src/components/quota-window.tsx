import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

/**
 * One quota window: a head of its name, how much is used and when it resets,
 * then its block meter, and in `detail` a foot of its pace and reset time.
 */
function QuotaWindow({
  className,
  size = "card",
  ...props
}: ComponentProps<"div"> & { size?: "card" | "detail" }) {
  return (
    <div
      data-slot="quota-window"
      data-size={size}
      className={cn(
        "group/window min-w-0 [&>[data-slot=block-meter]]:mt-1.75 data-[size=detail]:[&>[data-slot=block-meter]]:mt-2",
        className,
      )}
      {...props}
    />
  );
}

function QuotaWindowHead({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="quota-window-head"
      className={cn(
        "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm whitespace-nowrap tabular-nums group-data-[size=detail]/window:text-base",
        className,
      )}
      {...props}
    />
  );
}

function QuotaWindowLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="quota-window-label"
      className={cn(
        "font-medium text-text-2 group-data-[size=detail]/window:font-semibold group-data-[size=detail]/window:text-text",
        className,
      )}
      {...props}
    />
  );
}

function QuotaWindowUsed({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="quota-window-used"
      className={cn(
        "font-semibold text-text group-data-[size=detail]/window:text-[15px]",
        className,
      )}
      {...props}
    />
  );
}

function QuotaWindowReset({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="quota-window-reset"
      className={cn(
        "ml-auto text-text-3 group-data-[size=detail]/window:font-medium group-data-[size=detail]/window:text-text-2",
        className,
      )}
      {...props}
    />
  );
}

function QuotaWindowFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="quota-window-foot"
      className={cn(
        "mt-2.25 flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-text-2 tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

const paceVariants = cva("font-medium", {
  variants: {
    tone: {
      ok: "text-ok",
      warn: "text-warn",
      danger: "text-danger",
    },
  },
});

/** A window's pace in words, in green while it lasts, amber ahead of pace and red when full or emptying soon. */
function Pace({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & Required<VariantProps<typeof paceVariants>>) {
  return (
    <span
      data-slot="pace"
      className={cn(paceVariants({ tone }), className)}
      {...props}
    />
  );
}

export {
  Pace,
  QuotaWindow,
  QuotaWindowFoot,
  QuotaWindowHead,
  QuotaWindowLabel,
  QuotaWindowReset,
  QuotaWindowUsed,
};
