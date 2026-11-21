import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";

const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center whitespace-nowrap font-medium tabular-nums",
  {
    variants: {
      variant: {
        outline:
          "rounded-control border border-border-strong px-1.75 text-xs text-text-2",
        danger:
          "rounded-control border border-danger px-1.75 text-xs text-danger",
        live: "gap-1.75 rounded-full bg-ok/12 pr-2 pl-1.75 text-sm text-ok",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

/**
 * A short label beside a name: a plan, a kind, how a request ended (`danger`
 * only for an error), or, as `live`, something running now, with the one
 * ambient motion the design allows.
 */
function Badge({
  className,
  variant = "outline",
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {variant === "live" ? (
        <span aria-hidden="true" className="relative size-1.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-ok" />
          <span className="absolute inset-0 rounded-full bg-ok motion-safe:animate-live" />
        </span>
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
