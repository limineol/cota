import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./button.tsx";

const shownFor = 1600;

/**
 * A button that copies `value`, read when it is pressed, and says so for a
 * moment. With `children` it is an outlined button with its words; without,
 * an icon whose name is `label`.
 */
function CopyButton({
  value,
  label,
  copied: copiedText,
  children,
  className,
}: {
  value: () => string;
  label: string;
  copied: string;
  children?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), shownFor);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    navigator.clipboard?.writeText(value()).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const icon = copied ? (
    <Check aria-hidden="true" />
  ) : (
    <Copy aria-hidden="true" />
  );
  return (
    <>
      {children === undefined ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          onClick={copy}
          {...(className === undefined ? {} : { className })}
        >
          {icon}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={copy}
          {...(className === undefined ? {} : { className })}
        >
          {icon}
          {children}
        </Button>
      )}
      <span role="status" className="sr-only">
        {copied ? copiedText : ""}
      </span>
    </>
  );
}

export { CopyButton };
