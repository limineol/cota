import { Option, Result, Schema } from "effect";

/** What `cota memory get` and `cota memory sql` ask the hub, as the reader key. */
export type Ask =
  | {
      readonly _tag: "Get";
      readonly path: string;
      readonly query: ReadonlyArray<readonly [string, string]>;
    }
  | { readonly _tag: "Sql"; readonly sql: string };

/** The hub's answer to an ask, its bytes as it gave them. */
export interface Answered {
  readonly status: number;
  readonly body: string;
}

/** The hub answered a problem (4xx or 5xx): its status, and its body or its problem's title and detail. */
export class HubAnswered extends Schema.TaggedError<
  HubAnswered,
  { readonly brand: unique symbol }
>()("HubAnswered", { status: Schema.Int, text: Schema.String }) {}

export class NoReaderKey extends Schema.TaggedError<
  NoReaderKey,
  { readonly brand: unique symbol }
>()("NoReaderKey", {}) {}

/** How long `cota memory` waits for each answer: longer than the SQL console's 30 seconds a query. */
export const memoryDeadline = "40 seconds";

/** Reads `cota memory get`'s path: under `/api/`, with no query, fragment or dot segment. */
export const pathOf = (path: string): Result.Result<string, string> => {
  if (!path.startsWith("/api/")) {
    return Result.fail(
      `${path} is not a path of the hub's API: it starts /api/`,
    );
  }
  if (path.includes("?") || path.includes("#")) {
    return Result.fail(
      `${path} holds a query; give each parameter as <name>=<value>`,
    );
  }
  const dotted = path
    .split("/")
    .some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
  return dotted
    ? Result.fail(`${path} holds a . or .. segment`)
    : Result.succeed(path);
};

/** Reads one `<name>=<value>` parameter, split at its first `=`. */
export const parameterOf = (
  given: string,
): Result.Result<readonly [string, string], string> => {
  const equals = given.indexOf("=");
  if (equals < 1) {
    return Result.fail(`${given} is not a parameter: write it <name>=<value>`);
  }
  return Result.succeed([given.slice(0, equals), given.slice(equals + 1)]);
};

/** The URL an ask is sent to, its parameters encoded in order. */
export const urlOf = (hub: string, ask: Ask): string => {
  if (ask._tag === "Sql") return `${hub}/api/sql`;
  const query = ask.query
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  return `${hub}${ask.path}${query === "" ? "" : `?${query}`}`;
};

export type Part =
  | { readonly type: "text"; readonly text: string; readonly cut: number }
  | {
      readonly type: "image";
      readonly mediaType: string | null;
      readonly bytes: number | null;
    }
  | { readonly type: "other"; readonly json: string; readonly cut: number };

interface Placed {
  readonly item: string;
  readonly part: "system" | "input" | "output";
}

/** One thing a transcript shows, as the hub's API gives it (`docs/specs/sessions/spec.md`, Transcripts). */
export type Entry = Placed &
  (
    | {
        readonly kind: "message";
        readonly role: string;
        readonly parts: ReadonlyArray<Part>;
      }
    | {
        readonly kind: "reasoning";
        readonly text: string | null;
        readonly hidden: boolean;
        readonly cut: number;
      }
    | {
        readonly kind: "tool-call";
        readonly callId: string | null;
        readonly name: string;
        readonly input: string;
        readonly cut: number;
      }
    | {
        readonly kind: "tool-result";
        readonly callId: string | null;
        readonly name: string | null;
        readonly output: string;
        readonly error: boolean;
        readonly cut: number;
      }
    | { readonly kind: "other"; readonly json: string; readonly cut: number }
  );

export interface Transcript {
  readonly request: string;
  readonly protocol: string;
  readonly entries: ReadonlyArray<Entry>;
}

export interface Segment {
  readonly tip: string;
  readonly startedAt: string;
  readonly requests: number;
}

/** What `cota memory transcript` read: a session's segments and its last segment's transcript, or one request's. */
export type TranscriptRead =
  | {
      readonly _tag: "Session";
      readonly session: string;
      readonly segments: ReadonlyArray<Segment>;
      readonly transcript: Option.Option<Transcript>;
    }
  | {
      readonly _tag: "Request";
      readonly request: string;
      readonly transcript: Option.Option<Transcript>;
    };

export interface PageAsked {
  /** The first entry shown, counting from 1. */
  readonly from: number;
  readonly entries: number;
  /** The characters (code points) of each entry's text shown at most. */
  readonly cut: number;
}

export const pageLimits = {
  entries: { least: 1, most: 200, default: 40 },
  cut: { least: 1, most: 100_000, default: 300 },
} as const;

export interface Shown {
  readonly number: number;
  readonly heading: string;
  readonly text: string;
  /** What the page cut of the entry's text, and what the hub cut before it. */
  readonly leftOut: number;
}

export interface Page {
  readonly shown: ReadonlyArray<Shown>;
  readonly total: number;
  /** Where the next page starts, or none when this one is the last. */
  readonly next: Option.Option<number>;
}

const partText = (part: Part): string => {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
      return `[image${part.mediaType === null ? "" : ` ${part.mediaType}`}${part.bytes === null ? "" : `, ${part.bytes} bytes`}]`;
    case "other":
      return part.json;
  }
};

/** An entry's text, whole, and what the hub cut of it. */
export const textOf = (
  entry: Entry,
): { readonly text: string; readonly cut: number } => {
  switch (entry.kind) {
    case "message":
      return {
        text: entry.parts.map(partText).join("\n"),
        cut: entry.parts.reduce(
          (sum, part) => sum + (part.type === "image" ? 0 : part.cut),
          0,
        ),
      };
    case "reasoning":
      return { text: entry.text ?? "[hidden]", cut: entry.cut };
    case "tool-call":
      return { text: entry.input, cut: entry.cut };
    case "tool-result":
      return { text: entry.output, cut: entry.cut };
    case "other":
      return { text: entry.json, cut: entry.cut };
  }
};

export const headingOf = (entry: Entry): string => {
  switch (entry.kind) {
    case "message":
      return `${entry.role} message`;
    case "reasoning":
      return "reasoning";
    case "tool-call":
      return `tool call ${entry.name}${entry.callId === null ? "" : ` (${entry.callId})`}`;
    case "tool-result":
      return `${entry.name === null ? "tool result" : `tool result of ${entry.name}`}${entry.error ? ", an error" : ""}`;
    case "other":
      return "other";
  }
};

/** The page of a transcript's entries asked for, each text cut at the page's cut. */
export const pageOf = (
  entries: ReadonlyArray<Entry>,
  asked: PageAsked,
): Page => {
  const start = asked.from - 1;
  const end = Math.min(entries.length, start + asked.entries);
  const shown = entries.slice(start, end).map((entry, index) => {
    const { text, cut } = textOf(entry);
    const characters = Array.from(text);
    return {
      number: asked.from + index,
      heading: `${entry.part}, ${headingOf(entry)}`,
      text: characters.slice(0, asked.cut).join(""),
      leftOut: Math.max(0, characters.length - asked.cut) + cut,
    };
  });
  return {
    shown,
    total: entries.length,
    next: end < entries.length ? Option.some(end + 1) : Option.none(),
  };
};

const pageLines = (page: Page, from: number): Array<string> => {
  const lines: Array<string> = [];
  for (const { number, heading, text, leftOut } of page.shown) {
    lines.push(`#${number} ${heading}`);
    if (text !== "") lines.push(text);
    if (leftOut > 0) lines.push(`… [${leftOut} characters left out]`);
  }
  const first = page.shown[0];
  const last = page.shown.at(-1);
  if (first === undefined || last === undefined) {
    lines.push(
      page.total === 0
        ? "the transcript has no entries."
        : `there is no entry ${from}: the transcript has ${page.total}.`,
    );
    return lines;
  }
  lines.push(
    `entries ${first.number} to ${last.number} of ${page.total}; ${Option.match(
      page.next,
      {
        onNone: () => "that is the last.",
        onSome: (next) => `the next page: --from ${next}`,
      },
    )}`,
  );
  return lines;
};

/** What `cota memory transcript` prints (`docs/specs/memory-skill/spec.md`, A transcript page). */
export const transcriptText = (
  read: TranscriptRead,
  asked: PageAsked,
): string => {
  const lines: Array<string> = [];
  if (Option.isNone(read.transcript)) {
    lines.push(
      read._tag === "Session"
        ? `session ${read.session} has no transcript: no main request of it carries a conversation.`
        : `request ${read.request} has no transcript: the request log kept no conversation of it.`,
    );
    return `${lines.join("\n")}\n`;
  }
  const transcript = read.transcript.value;
  const counted = `${transcript.entries.length} ${transcript.entries.length === 1 ? "entry" : "entries"}`;
  if (read._tag === "Session") {
    lines.push(
      `session ${read.session}: segment ${read.segments.length} of ${read.segments.length}, read from its tip ${transcript.request} (${transcript.protocol}), ${counted}`,
      ...read.segments.map(
        (segment, index) =>
          `segment ${index + 1}: ${segment.requests} ${segment.requests === 1 ? "request" : "requests"} from ${segment.startedAt}, tip ${segment.tip}`,
      ),
    );
  } else {
    lines.push(
      `request ${transcript.request} (${transcript.protocol}), ${counted}`,
    );
  }
  lines.push(...pageLines(pageOf(transcript.entries, asked), asked.from));
  return `${lines.join("\n")}\n`;
};
