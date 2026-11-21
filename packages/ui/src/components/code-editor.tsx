import {
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
  useRef,
} from "react";
import { cn } from "#lib/utils.ts";

/** What a piece of code is, for its tone. */
type CodeTone =
  | "keyword"
  | "name"
  | "quoted"
  | "string"
  | "number"
  | "comment"
  | "punctuation"
  | "space";

interface CodePiece {
  readonly kind: CodeTone;
  readonly text: string;
}

const tones: Record<CodeTone, string> = {
  keyword: "font-semibold text-text",
  name: "text-text",
  quoted: "text-text",
  string: "text-text-2",
  number: "font-medium text-text",
  comment: "text-text-3 italic",
  punctuation: "text-text-3",
  space: "",
};

const indent = "  ";

/** A panel holding an editor and the bar of its actions. */
function CodeEditorPanel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-editor-panel"
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface transition-state has-[[data-slot=code-editor-input]:focus-visible]:border-text-3",
        className,
      )}
      {...props}
    />
  );
}

/** The actions under an editor: a run, its shortcut and what goes with them. */
function CodeEditorBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="code-editor-bar"
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5",
        className,
      )}
      {...props}
    />
  );
}

/** A quiet figure at the end of the bar, such as how many lines the code has. */
function CodeEditorStatus({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="code-editor-status"
      className={cn("ml-auto text-sm text-text-3 tabular-nums", className)}
      {...props}
    />
  );
}

/**
 * Code typed into a textarea laid over a toned copy of its text, with line
 * numbers. `pieces` are the text cut into tones, which must put together to
 * `value`. Tab indents by two spaces, unless Escape was pressed just before,
 * so that Tab can still leave the editor; ⌘↵ or Ctrl+↵ calls `onRun`.
 */
function CodeEditor({
  value,
  pieces,
  onValueChange,
  onRun,
  ref,
  className,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange" | "children"> & {
  value: string;
  pieces: ReadonlyArray<CodePiece>;
  onValueChange: (value: string) => void;
  onRun: () => void;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const toned = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const released = useRef(false);
  const lines = value.split("\n").length;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onRun();
      return;
    }
    if (event.key === "Escape") {
      released.current = true;
      return;
    }
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.altKey &&
      !released.current
    ) {
      event.preventDefault();
      const field = event.currentTarget;
      field.setRangeText(
        indent,
        field.selectionStart,
        field.selectionEnd,
        "end",
      );
      onValueChange(field.value);
      return;
    }
    released.current = false;
  };

  return (
    <div
      data-slot="code-editor"
      className={cn(
        "grid h-60 min-h-32 resize-y grid-cols-[auto_minmax(0,1fr)] overflow-hidden font-mono text-sm leading-5",
        className,
      )}
    >
      <div
        ref={gutter}
        aria-hidden="true"
        className="flex min-w-11 flex-col overflow-hidden border-r border-border pt-3 pr-2.5 pb-8 pl-3 text-right text-text-3 tabular-nums select-none"
      >
        {Array.from({ length: lines }, (_, line) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line number is its place
          <span key={line}>{line + 1}</span>
        ))}
      </div>
      <div className="relative min-w-0">
        <pre
          ref={toned}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-0 overflow-hidden pt-3 pr-8 pb-8 pl-3.5 font-mono whitespace-pre text-text [tab-size:2]"
        >
          {pieces.map((piece, index) =>
            piece.kind === "space" ? (
              piece.text
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: a piece is known by its place in the text
              <span key={index} className={tones[piece.kind]}>
                {piece.text}
              </span>
            ),
          )}
          {"\n"}
        </pre>
        <textarea
          ref={ref}
          data-slot="code-editor-input"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            const { scrollTop, scrollLeft } = event.currentTarget;
            if (toned.current !== null) {
              toned.current.scrollTop = scrollTop;
              toned.current.scrollLeft = scrollLeft;
            }
            if (gutter.current !== null) gutter.current.scrollTop = scrollTop;
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          className="absolute inset-0 m-0 resize-none overflow-auto border-0 bg-transparent px-3.5 py-3 font-mono whitespace-pre text-transparent caret-text outline-none [scrollbar-width:thin] [tab-size:2] selection:bg-text/20 selection:text-transparent"
          {...props}
        />
      </div>
    </div>
  );
}

/** A key of a shortcut, as it is written on the control it works. */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn("font-sans text-sm font-normal opacity-75", className)}
      {...props}
    />
  );
}

export {
  CodeEditor,
  CodeEditorBar,
  CodeEditorPanel,
  CodeEditorStatus,
  type CodePiece,
  type CodeTone,
  Kbd,
};
