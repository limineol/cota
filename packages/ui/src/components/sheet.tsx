import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "#lib/utils.ts";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

/** A panel that slides in from the left over a scrim, holding focus until it closes. */
function SheetContent({ className, ...props }: SheetPrimitive.Popup.Props) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-40 bg-bg/70 transition-state data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(280px,84vw)] flex-col border-r border-border-strong bg-rail text-text-2 transition-move outline-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
          className,
        )}
        {...props}
      />
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-medium text-text", className)}
      {...props}
    />
  );
}

export { Sheet, SheetContent, SheetTitle, SheetTrigger };
