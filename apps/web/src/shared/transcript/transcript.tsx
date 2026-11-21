import { Button } from "@cota/ui/components/button";
import {
  Transcript,
  TranscriptFoot,
  TranscriptMessage,
  TranscriptNote,
  TranscriptPart,
  TranscriptRow,
} from "@cota/ui/components/transcript";
import { Link } from "@tanstack/react-router";
import type { Effect } from "effect";
import {
  Braces,
  Brain,
  CornerDownRight,
  Image,
  MessageSquareText,
  Settings2,
  Wrench,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Client } from "#shared/api.ts";
import { pairCalls } from "#shared/domain/pairs.ts";
import { remindersOf } from "#shared/domain/text.ts";
import { counted, plural } from "#shared/words.ts";
import { firstLine, inputSummary, linesOf, setOut } from "./summary.ts";
import { ClampedCode, ClampedMarkdown } from "./text.tsx";

type Detail = Extract<
  Effect.Success<ReturnType<Client["sessions"]["session"]>>,
  { readonly transcript: unknown }
>;

export type Entry = NonNullable<Detail["transcript"]>["entries"][number];

type Message = Extract<Entry, { readonly kind: "message" }>;

export const hideable = ["reasoning", "tools", "context"] as const;

/** What the toggles can hide: reasoning, tool calls with their results, and the context a client adds (system and developer messages, reminders, what the dashboard cannot read). */
export type Hideable = (typeof hideable)[number];

/** Whether every row is opened or closed, as the last "Expand all" or "Collapse all" chose; a new value resets the rows opened one by one. */
export interface Expansion {
  readonly open: boolean;
}

/** How many entries a transcript renders at a time, and adds as the reader nears its end. */
export const entriesAtOnce = 40;

const isContextMessage = (entry: Message) =>
  entry.part === "system" ||
  entry.role === "system" ||
  entry.role === "developer";

/** A message's text parts with their reminders taken out, and whether anything is left to show. */
const speaksOf = (entry: Message) =>
  entry.parts.some(
    (part) =>
      part.type !== "text" ||
      remindersOf(part.text).some(
        (piece) => piece.kind === "text" && piece.raw.trim() !== "",
      ),
  );

const remindersIn = (entry: Message) =>
  entry.parts.reduce(
    (sum, part) =>
      part.type === "text"
        ? sum +
          remindersOf(part.text).filter((piece) => piece.kind === "reminder")
            .length
        : sum,
    0,
  );

/** What toggle hides an entry's row, or none when it is always shown. */
export const switchOf = (entry: Entry): Hideable | null => {
  if (entry.kind === "reasoning") return "reasoning";
  if (entry.kind === "tool-call" || entry.kind === "tool-result")
    return "tools";
  if (entry.kind === "other") return "context";
  return isContextMessage(entry) || !speaksOf(entry) ? "context" : null;
};

/** How many rows of a transcript each toggle hides, a reminder in a message counted as one. */
export const hiddenCounts = (
  entries: ReadonlyArray<Entry>,
): Readonly<Record<Hideable, number>> => {
  const counts = { reasoning: 0, tools: 0, context: 0 };
  for (const row of pairCalls(entries)) {
    const entry = entries[row.at];
    if (entry === undefined) continue;
    const hidden = switchOf(entry);
    if (hidden !== null) counts[hidden] += 1;
    else if (entry.kind === "message") counts.context += remindersIn(entry);
  }
  return counts;
};

const switchWords: Record<Hideable, (n: number) => string> = {
  reasoning: (n) => `${counted(n)} reasoning`,
  tools: (n) => plural(n, "tool call"),
  context: (n) => `${counted(n)} context`,
};

function Cut({
  characters,
  uncut,
}: {
  readonly characters: number;
  readonly uncut: ReactNode;
}) {
  if (characters === 0) return null;
  return (
    <TranscriptNote>
      {plural(characters, "character")} more were left out here; {uncut} has
      them.
    </TranscriptNote>
  );
}

const bytesOf = (bytes: number | null, mediaType: string | null) =>
  [mediaType, bytes === null ? null : plural(bytes, "byte")]
    .filter((each) => each !== null)
    .join(", ");

interface Opened {
  readonly isOpen: (key: string) => boolean;
  readonly setOpen: (key: string, open: boolean) => void;
}

function MessageParts({
  entry,
  at,
  hideReminders,
  opened,
  uncut,
}: {
  readonly entry: Message;
  readonly at: number;
  readonly hideReminders: boolean;
  readonly opened: Opened;
  readonly uncut: ReactNode;
}) {
  return entry.parts.map((part, index) => {
    const key = `${at}:${index}`;
    if (part.type === "image") {
      return (
        <TranscriptRow
          key={key}
          open={opened.isOpen(key)}
          onOpenChange={(open) => opened.setOpen(key, open)}
          icon={<Image aria-hidden="true" />}
          label="Image"
          preview={
            part.mediaType === null && part.bytes === null
              ? "an image the request names"
              : bytesOf(part.bytes, part.mediaType)
          }
        >
          <TranscriptNote>
            A transcript never shows an image's bytes:{" "}
            {part.mediaType === null && part.bytes === null
              ? "this one is named by the request, not carried in it."
              : `it was ${bytesOf(part.bytes, part.mediaType)}.`}
          </TranscriptNote>
        </TranscriptRow>
      );
    }
    if (part.type === "other") {
      return (
        <TranscriptRow
          key={key}
          open={opened.isOpen(key)}
          onOpenChange={(open) => opened.setOpen(key, open)}
          icon={<Braces aria-hidden="true" />}
          label="A part the dashboard cannot read"
          preview={firstLine(part.json)}
          mono
        >
          <ClampedCode text={setOut(part.json)} quiet />
          <Cut characters={part.cut} uncut={uncut} />
        </TranscriptRow>
      );
    }
    let offset = 0;
    return (
      <div key={key} className="flex min-w-0 flex-col gap-2">
        {remindersOf(part.text).map((piece) => {
          const pieceKey = `${key}:${offset}`;
          offset += piece.raw.length;
          if (piece.kind === "reminder") {
            return hideReminders ? null : (
              <TranscriptRow
                key={pieceKey}
                open={opened.isOpen(pieceKey)}
                onOpenChange={(open) => opened.setOpen(pieceKey, open)}
                icon={<Settings2 aria-hidden="true" />}
                label="Reminder"
                preview={firstLine(piece.text)}
              >
                <ClampedCode text={piece.text.trim()} quiet />
              </TranscriptRow>
            );
          }
          return piece.raw.trim() === "" ? null : (
            <ClampedMarkdown key={pieceKey} text={piece.raw.trim()} />
          );
        })}
        <Cut characters={part.cut} uncut={uncut} />
      </div>
    );
  });
}

const roleLabel = (role: string) =>
  role === "user"
    ? "User"
    : role === "assistant"
      ? "Assistant"
      : role.charAt(0).toUpperCase() + role.slice(1);

function EntryRow({
  entries,
  at,
  result,
  hidden,
  opened,
  uncut,
}: {
  readonly entries: ReadonlyArray<Entry>;
  readonly at: number;
  readonly result: number | null;
  readonly hidden: ReadonlySet<Hideable>;
  readonly opened: Opened;
  readonly uncut: ReactNode;
}): ReactNode {
  const entry = entries[at];
  const key = String(at);
  if (entry === undefined) return null;
  const open = opened.isOpen(key);
  const onOpenChange = (next: boolean) => opened.setOpen(key, next);

  if (entry.kind === "message") {
    if (isContextMessage(entry)) {
      const text = entry.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");
      return (
        <TranscriptRow
          open={open}
          onOpenChange={onOpenChange}
          icon={<Settings2 aria-hidden="true" />}
          label={`${roleLabel(entry.role)} message`}
          preview={firstLine(text)}
          meta={plural(linesOf(text), "line")}
        >
          <MessageParts
            entry={entry}
            at={at}
            hideReminders={false}
            opened={opened}
            uncut={uncut}
          />
        </TranscriptRow>
      );
    }
    if (entry.parts.length === 0) {
      return (
        <TranscriptRow
          open={open}
          onOpenChange={onOpenChange}
          icon={<MessageSquareText aria-hidden="true" />}
          label={`${roleLabel(entry.role)} message`}
          preview="with nothing in it"
        >
          <TranscriptNote>
            An item the transcript reads as a message, though it holds no text,
            image or other part.
          </TranscriptNote>
        </TranscriptRow>
      );
    }
    return (
      <TranscriptMessage
        from={entry.role === "user" ? "user" : "assistant"}
        label={roleLabel(entry.role)}
      >
        <MessageParts
          entry={entry}
          at={at}
          hideReminders={hidden.has("context")}
          opened={opened}
          uncut={uncut}
        />
      </TranscriptMessage>
    );
  }

  if (entry.kind === "reasoning") {
    return (
      <TranscriptRow
        open={open}
        onOpenChange={onOpenChange}
        icon={<Brain aria-hidden="true" />}
        label="Reasoning"
        preview={
          entry.hidden || entry.text === null
            ? "withheld by the provider"
            : firstLine(entry.text)
        }
      >
        {entry.hidden || entry.text === null ? (
          <TranscriptNote>
            The provider withheld this reasoning: it sent it encrypted, or not
            at all.
          </TranscriptNote>
        ) : (
          <ClampedMarkdown text={entry.text} />
        )}
        <Cut characters={entry.cut} uncut={uncut} />
      </TranscriptRow>
    );
  }

  if (entry.kind === "tool-call") {
    const paired = result === null ? undefined : entries[result];
    const answer = paired?.kind === "tool-result" ? paired : undefined;
    return (
      <TranscriptRow
        open={open}
        onOpenChange={onOpenChange}
        icon={<Wrench aria-hidden="true" />}
        label={entry.name}
        preview={inputSummary(entry.input)}
        mono
        meta={
          answer === undefined
            ? "no result"
            : answer.error
              ? `failed, ${plural(linesOf(answer.output), "line")}`
              : plural(linesOf(answer.output), "line")
        }
        {...(answer?.error === true ? { tone: "danger" as const } : {})}
      >
        <TranscriptPart label="Input">
          <ClampedCode text={setOut(entry.input)} />
          <Cut characters={entry.cut} uncut={uncut} />
        </TranscriptPart>
        <TranscriptPart
          label={
            answer === undefined
              ? "No result came back in this transcript"
              : answer.error
                ? "Result, an error"
                : "Result"
          }
        >
          {answer === undefined ? null : (
            <>
              <ClampedCode text={answer.output} quiet />
              <Cut characters={answer.cut} uncut={uncut} />
            </>
          )}
        </TranscriptPart>
      </TranscriptRow>
    );
  }

  if (entry.kind === "tool-result") {
    return (
      <TranscriptRow
        open={open}
        onOpenChange={onOpenChange}
        icon={<CornerDownRight aria-hidden="true" />}
        label={entry.name ?? "Tool result"}
        preview="a result whose call is not in this transcript"
        meta={
          entry.error
            ? `failed, ${plural(linesOf(entry.output), "line")}`
            : plural(linesOf(entry.output), "line")
        }
        {...(entry.error ? { tone: "danger" as const } : {})}
      >
        <ClampedCode text={entry.output} quiet />
        <Cut characters={entry.cut} uncut={uncut} />
      </TranscriptRow>
    );
  }

  return (
    <TranscriptRow
      open={open}
      onOpenChange={onOpenChange}
      icon={<Braces aria-hidden="true" />}
      label="An item the dashboard cannot read"
      preview={firstLine(entry.json)}
      mono
    >
      <ClampedCode text={setOut(entry.json)} quiet />
      <Cut characters={entry.cut} uncut={uncut} />
    </TranscriptRow>
  );
}

/** Asks for more once the reader nears the end of what is rendered. */
function More({ onMore }: { readonly onMore: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) onMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMore]);
  return <div ref={sentinel} aria-hidden="true" />;
}

/**
 * A conversation's entries as the transcript grammar sets them out, each tool
 * call with the result paired with it, forty at a time, what the toggles
 * hide counted at its end with the characters cut, and where the whole text
 * is (`uncut`, by default the request's page).
 */
export function TranscriptView({
  entries,
  request,
  uncut = (
    <Link to="/requests/$id" params={{ id: request }}>
      the request
    </Link>
  ),
  cutCharacters,
  hidden,
  expansion,
}: {
  readonly entries: ReadonlyArray<Entry>;
  readonly request: string;
  readonly uncut?: ReactNode;
  readonly cutCharacters: number;
  readonly hidden: ReadonlySet<Hideable>;
  readonly expansion: Expansion;
}) {
  const [shown, setShown] = useState(entriesAtOnce);
  const [seen, setSeen] = useState(expansion);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  if (seen !== expansion) {
    setSeen(expansion);
    setOverrides(new Map());
  }
  const opened: Opened = {
    isOpen: (key) => overrides.get(key) ?? expansion.open,
    setOpen: (key, open) =>
      setOverrides((before) => new Map(before).set(key, open)),
  };

  const rows = pairCalls(entries).filter((row) => {
    const entry = entries[row.at];
    const kind = entry === undefined ? null : switchOf(entry);
    return kind === null || !hidden.has(kind);
  });
  const counts = hiddenCounts(entries);
  const hiddenNow = hideable.filter(
    (each) => hidden.has(each) && counts[each] > 0,
  );
  const hiddenTotal = hiddenNow.reduce((sum, each) => sum + counts[each], 0);
  const more = () => setShown((before) => before + entriesAtOnce);

  return (
    <Transcript>
      {rows.slice(0, shown).map((row) => (
        <EntryRow
          key={row.at}
          entries={entries}
          at={row.at}
          result={row.result}
          hidden={hidden}
          opened={opened}
          uncut={uncut}
        />
      ))}
      <TranscriptFoot>
        {rows.length > shown ? (
          <>
            <More onMore={more} />
            <TranscriptNote>
              {counted(shown)} of {plural(rows.length, "entry", "entries")}{" "}
              shown
            </TranscriptNote>
            <Button variant="outline" size="sm" onClick={more}>
              Show {counted(Math.min(entriesAtOnce, rows.length - shown))} more
            </Button>
          </>
        ) : null}
        {hiddenTotal > 0 ? (
          <TranscriptNote>
            {plural(hiddenTotal, "entry", "entries")} hidden by the toggles:{" "}
            {hiddenNow
              .map((each) => switchWords[each](counts[each]))
              .join(", ")}
          </TranscriptNote>
        ) : null}
        {cutCharacters > 0 ? (
          <TranscriptNote>
            {plural(cutCharacters, "character")} of this transcript's texts were
            left out in all; {uncut} has them.
          </TranscriptNote>
        ) : null}
      </TranscriptFoot>
    </Transcript>
  );
}
