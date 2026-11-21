import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";

/** Groups of named values side by side from the container's `@3xl`, one under another below it. */
function Fields({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="fields"
      className={cn(
        "grid items-start gap-x-10 gap-y-7 @3xl:grid-cols-2",
        className,
      )}
      {...props}
    />
  );
}

/** Values that belong together, under their heading; `level` 2 where the group is the page's own part. */
function FieldGroup({
  title,
  level = 3,
  className,
  children,
  ...props
}: ComponentProps<"section"> & { title: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      data-slot="field-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    >
      <Heading className="text-base font-semibold text-text">{title}</Heading>
      <dl className="m-0 grid grid-cols-[minmax(7rem,38%)_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-border pt-2.5 text-sm">
        {children}
      </dl>
    </section>
  );
}

/** One value: its name in words, the value in mono as it was recorded. */
function Field({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt data-slot="field-name" className="min-w-0 break-words text-text-3">
        {name}
      </dt>
      <dd
        data-slot="field-value"
        className="m-0 min-w-0 font-mono break-all text-text"
      >
        {children}
      </dd>
    </>
  );
}

/** What a field or a group says when nothing was recorded, in words rather than mono. */
function FieldNone({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="field-none"
      className={cn("font-sans text-text-3", className)}
      {...props}
    />
  );
}

export { Field, FieldGroup, FieldNone, Fields };
