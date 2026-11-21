import {
  CodeBlock,
  Prose,
  ProseButton,
  ProseCode,
  ProseHeading,
  ProseItem,
  ProseLink,
  ProseList,
  ProseParagraph,
  ProseStrong,
} from "@cota/ui/components/prose";
import { useState } from "react";
import { blocksOf, fencesOf, inlinesOf } from "#shared/domain/text.ts";
import { counted, plural } from "#shared/words.ts";

/** The most lines, and characters, a text shows before "Show all". */
const clampedLines = 24;
const clampedCharacters = 2400;

/** A text's first lines up to the clamp, or null when the whole text fits. */
export const clampOf = (text: string): string | null => {
  const lines = text.split("\n");
  const kept = lines.slice(0, clampedLines).join("\n");
  const shown =
    kept.length > clampedCharacters
      ? kept.slice(
          0,
          kept.lastIndexOf("\n", clampedCharacters) + 1 || clampedCharacters,
        )
      : kept;
  return shown.length < text.length ? shown : null;
};

const linesIn = (text: string) => text.split("\n").length;

function Inlines({ text }: { readonly text: string }) {
  let at = 0;
  return inlinesOf(text).map((piece) => {
    const key = at;
    at += piece.raw.length;
    if (piece.kind === "code")
      return <ProseCode key={key}>{piece.text}</ProseCode>;
    if (piece.kind === "strong") {
      return <ProseStrong key={key}>{piece.text}</ProseStrong>;
    }
    if (piece.kind === "link") {
      return (
        <ProseLink key={key} url={piece.url}>
          {piece.label}
        </ProseLink>
      );
    }
    return piece.raw;
  });
}

function Blocks({ prose }: { readonly prose: string }) {
  let at = 0;
  return blocksOf(prose).map((block) => {
    const key = at;
    at += block.raw.length;
    if (block.kind === "space") return null;
    if (block.kind === "heading") {
      return (
        <ProseHeading key={key}>
          <Inlines text={block.text} />
        </ProseHeading>
      );
    }
    if (block.kind === "list") {
      return (
        <ProseList key={key} ordered={block.ordered}>
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a list's items are its lines, in order
            <ProseItem key={index}>
              <Inlines text={item} />
            </ProseItem>
          ))}
        </ProseList>
      );
    }
    return (
      <ProseParagraph key={key}>
        <Inlines text={block.text} />
      </ProseParagraph>
    );
  });
}

/** Text a model or a person wrote, as paragraphs, headings, lists and fenced code, never as HTML. */
export function Markdown({ text }: { readonly text: string }) {
  let at = 0;
  return (
    <Prose>
      {fencesOf(text).map((piece) => {
        const key = at;
        at += piece.raw.length;
        return piece.kind === "code" ? (
          <CodeBlock key={key} aria-label={piece.language || undefined}>
            {piece.code}
          </CodeBlock>
        ) : (
          <Blocks key={key} prose={piece.raw} />
        );
      })}
    </Prose>
  );
}

/** A long text's first lines, with "Show all" for the rest. */
export function ClampedMarkdown({ text }: { readonly text: string }) {
  const [all, setAll] = useState(false);
  const clamp = clampOf(text);
  if (clamp === null) return <Markdown text={text} />;
  return (
    <>
      <Markdown text={all ? text : clamp} />
      <ProseButton onClick={() => setAll(!all)}>
        {all
          ? "Show less"
          : `Show all ${plural(linesIn(text), "line")}, ${counted(text.length)} characters`}
      </ProseButton>
    </>
  );
}

/** Text as it was given, in mono, its first lines with "Show all" for the rest when it is long. */
export function ClampedCode({
  text,
  quiet = false,
}: {
  readonly text: string;
  readonly quiet?: boolean;
}) {
  const [all, setAll] = useState(false);
  const clamp = clampOf(text);
  return (
    <>
      <CodeBlock quiet={quiet}>
        {clamp === null || all ? text : clamp}
      </CodeBlock>
      {clamp === null ? null : (
        <ProseButton onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${plural(linesIn(text), "line")}`}
        </ProseButton>
      )}
    </>
  );
}
