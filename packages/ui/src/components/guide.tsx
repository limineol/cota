import type { ComponentProps } from "react";
import { cn } from "#lib/utils.ts";
import { Mark } from "./mark.tsx";

/**
 * A screen shown before the dashboard, in two columns: the words on the left
 * and a card with the form on the right; one column on a phone, words first.
 */
function Guide({ className, children, ...props }: ComponentProps<"main">) {
  return (
    <main
      data-slot="guide"
      className={cn(
        "grid min-h-dvh place-items-center px-4 py-8 wide:px-8 wide:py-12",
        className,
      )}
      {...props}
    >
      <div className="grid w-full max-w-[56rem] gap-8 wide:grid-cols-[minmax(0,1fr)_22rem] wide:items-center wide:gap-16">
        {children}
      </div>
    </main>
  );
}

/** The guide's words: Cota's mark and name, then the title, its lead and what follows. */
function GuideWords({
  className,
  children,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      data-slot="guide-words"
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    >
      <div className="mb-8 flex items-center gap-2.5 wide:mb-10">
        <Mark />
        <span className="text-base font-semibold text-text">Cota</span>
      </div>
      {children}
    </section>
  );
}

function GuideTitle({ className, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      data-slot="guide-title"
      className={cn(
        "m-0 text-3xl font-semibold tracking-tight text-balance text-text",
        className,
      )}
      {...props}
    />
  );
}

function GuideLead({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="guide-lead"
      className={cn("m-0 mt-2 mb-8 text-lg text-pretty text-text-2", className)}
      {...props}
    />
  );
}

export { Guide, GuideLead, GuideTitle, GuideWords };
