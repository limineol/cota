import { Check, Copy } from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { cn } from "#lib/utils.ts";
import { Button } from "./button.tsx";

const shownFor = 1600;

/** An id in mono, as it is typed and copied, with a button that copies it; `label` names what it is. */
function Identifier({
  value,
  label,
  className,
  ...props
}: ComponentProps<"div"> & { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), shownFor);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div
      data-slot="identifier"
      className={cn("flex min-w-0 items-center gap-1 text-text-3", className)}
      {...props}
    >
      <code className="min-w-0 font-mono text-sm wrap-anywhere">{value}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy the ${label}`}
        title={`Copy the ${label}`}
        onClick={copy}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? `The ${label} is copied.` : ""}
      </span>
    </div>
  );
}

export { Identifier };
