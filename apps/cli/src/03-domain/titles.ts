import { DateTime, Option, Result, Schema } from "effect";
import { DirectoryUnknown } from "./paths.ts";
import type { System, Variables } from "./system.ts";

/** The most titles one `PUT /api/session-titles` takes. */
export const batchSize = 1000;

/** How many characters (code points) of a title are sent, as the hub keeps them. */
export const longestTitle = 200;

/** The longest session id the hub takes, in characters. */
export const longestSession = 255;

/** A Claude Code transcript as far as the last run read it: where it stopped, and the latest titles it read. */
export interface Transcript {
  readonly offset: number;
  /** The owner's name for the session (`customTitle`). */
  readonly custom?: string;
  /** The title Claude Code generated (`aiTitle`). */
  readonly ai?: string;
}

/** Codex's session index as far as the last run read it: where it stopped, and each session's latest name. */
export interface CodexIndex {
  readonly offset: number;
  readonly names: ReadonlyMap<string, string>;
}

export const unreadTranscript: Transcript = { offset: 0 };
export const unreadIndex: CodexIndex = { offset: 0, names: new Map() };

const lineFeed = 0x0a;
const decoder = new TextDecoder();

/**
 * The lines a source's bytes end, from where the last run stopped: only
 * those ended by a line feed, and how many bytes they take. What follows the
 * last line feed, a line or a character still being written, waits for the
 * next run.
 */
export const linesOf = (
  bytes: Uint8Array,
): { readonly lines: ReadonlyArray<string>; readonly length: number } => {
  const length = bytes.lastIndexOf(lineFeed) + 1;
  return {
    lines: decoder.decode(bytes.subarray(0, length)).split("\n").slice(0, -1),
    length,
  };
};

/** Where a source is read on from: where the last run stopped, or afresh for a file now shorter than that. */
export const resumed = <Read extends { readonly offset: number }>(
  kept: Read,
  unread: Read,
  size: number,
): Read => (size < kept.offset ? unread : kept);

const parsed = (line: string): Option.Option<Record<string, unknown>> => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Option.some({ ...value })
      : Option.none();
  } catch {
    return Option.none();
  }
};

const customMarker = '"type":"custom-title"';
const aiMarker = '"type":"ai-title"';

/** A transcript read on by the bytes after its offset: a `custom-title` line gives the owner's name, an `ai-title` line the generated title, the later winning. */
export const readTranscript = (
  kept: Transcript,
  bytes: Uint8Array,
): Transcript => {
  const { lines, length } = linesOf(bytes);
  let { custom, ai } = kept;
  for (const line of lines) {
    if (!line.includes(customMarker) && !line.includes(aiMarker)) continue;
    const entry = parsed(line);
    if (Option.isNone(entry)) continue;
    const { type, customTitle, aiTitle } = entry.value;
    if (type === "custom-title" && typeof customTitle === "string") {
      custom = customTitle;
    } else if (type === "ai-title" && typeof aiTitle === "string") {
      ai = aiTitle;
    }
  }
  return {
    offset: kept.offset + length,
    ...(custom === undefined ? {} : { custom }),
    ...(ai === undefined ? {} : { ai }),
  };
};

/** Codex's index read on by the bytes after its offset: each line's `id` and `thread_name`, the later winning. */
export const readIndex = (kept: CodexIndex, bytes: Uint8Array): CodexIndex => {
  const { lines, length } = linesOf(bytes);
  const names = new Map(kept.names);
  for (const line of lines) {
    const entry = parsed(line);
    if (Option.isNone(entry)) continue;
    const { id, thread_name } = entry.value;
    if (typeof id === "string" && typeof thread_name === "string") {
      names.set(id, thread_name);
    }
  }
  return { offset: kept.offset + length, names };
};

/** A transcript's session: its file's name without `.jsonl`. */
export const sessionOfTranscript = (path: string): string =>
  path
    .slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
    .replace(/\.jsonl$/, "");

/** A title as the hub keeps it, and so as it is sent: well-formed, trimmed, and cut to 200 characters with no space left at its end. */
export const keptOf = (text: string): string =>
  [...text.toWellFormed().trim()].slice(0, longestTitle).join("").trimEnd();

/** What each source says of one session. */
export interface Found {
  readonly t3?: string;
  readonly custom?: string;
  readonly ai?: string;
  readonly codex?: string;
}

/** A session's title: T3 Code's, else Claude Code's owner name, else its generated one, else Codex's, each as it is kept, and an empty one none (J13). */
export const titleOf = (found: Found): Option.Option<string> => {
  for (const title of [found.t3, found.custom, found.ai, found.codex]) {
    if (title === undefined) continue;
    const kept = keptOf(title);
    if (kept !== "") return Option.some(kept);
  }
  return Option.none();
};

const isSession = (session: string): boolean => {
  const length = [...session].length;
  return length >= 1 && length <= longestSession;
};

/** Every session's title, from what each source says, for the sessions whose ids the hub takes. */
export const titlesOf = (sources: {
  readonly t3: ReadonlyMap<string, string>;
  readonly transcripts: ReadonlyMap<string, Transcript>;
  readonly codex: CodexIndex;
}): ReadonlyMap<string, string> => {
  const found = new Map<string, Found>();
  const add = (session: string, said: Found) =>
    found.set(session, { ...found.get(session), ...said });
  for (const [session, name] of sources.codex.names) {
    add(session, { codex: name });
  }
  for (const [path, { custom, ai }] of sources.transcripts) {
    add(sessionOfTranscript(path), {
      ...(custom === undefined ? {} : { custom }),
      ...(ai === undefined ? {} : { ai }),
    });
  }
  for (const [session, title] of sources.t3) add(session, { t3: title });
  const titles = new Map<string, string>();
  for (const [session, said] of found) {
    const title = titleOf(said);
    if (isSession(session) && Option.isSome(title)) {
      titles.set(session, title.value);
    }
  }
  return titles;
};

/** What was last kept by the hub, of the sessions that still have a title: a session whose title disappeared is forgotten. */
export const stillSent = (
  sent: ReadonlyMap<string, string>,
  titles: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> =>
  new Map([...sent].filter(([session]) => titles.has(session)));

/** The titles a run sends, in batches of at most `size`: each session's whose title differs from the one the hub last kept for it (J12). */
export const batchesOf = (
  titles: ReadonlyMap<string, string>,
  sent: ReadonlyMap<string, string>,
  size: number = batchSize,
): ReadonlyArray<ReadonlyMap<string, string>> => {
  const changed = [...titles].filter(
    ([session, title]) => sent.get(session) !== title,
  );
  const batches: Array<ReadonlyMap<string, string>> = [];
  for (let start = 0; start < changed.length; start += size) {
    batches.push(new Map(changed.slice(start, start + size)));
  }
  return batches;
};

/** What is recorded once the hub answered a batch 204: its titles, kept. */
export const keptAfter = (
  sent: ReadonlyMap<string, string>,
  batch: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> => new Map([...sent, ...batch]);

/** The reporter's state, `titles.json`: where each source was read to, what it said, what the hub kept, and when it ran. */
export interface State {
  readonly ranAt: DateTime.Utc;
  /** When the last run that ended without a problem ended. */
  readonly goodAt: Option.Option<DateTime.Utc>;
  readonly transcripts: ReadonlyMap<string, Transcript>;
  readonly codex: CodexIndex;
  readonly sent: ReadonlyMap<string, string>;
}

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Names = Schema.Record(Schema.String, Schema.String);

const File = Schema.Struct({
  ranAt: Schema.String,
  goodAt: Schema.NullOr(Schema.String),
  transcripts: Schema.Record(
    Schema.String,
    Schema.Struct({
      offset: Offset,
      custom: Schema.optionalKey(Schema.String),
      ai: Schema.optionalKey(Schema.String),
    }),
  ),
  codex: Schema.Struct({ offset: Offset, names: Names }),
  sent: Names,
});

const instantOf = (text: string) => DateTime.make(text);

/** `titles.json` read back; one that does not read is none, as if the reporter had never run. */
export const stateOf = (text: string): Option.Option<State> => {
  const json = parsed(text);
  if (Option.isNone(json)) return Option.none();
  const decoded = Schema.decodeUnknownResult(File)(json.value);
  if (Result.isFailure(decoded)) return Option.none();
  const file = decoded.success;
  const ranAt = instantOf(file.ranAt);
  if (Option.isNone(ranAt)) return Option.none();
  return Option.some({
    ranAt: DateTime.toUtc(ranAt.value),
    goodAt: Option.map(
      Option.flatMap(Option.fromNullOr(file.goodAt), instantOf),
      DateTime.toUtc,
    ),
    transcripts: new Map(Object.entries(file.transcripts)),
    codex: {
      offset: file.codex.offset,
      names: new Map(Object.entries(file.codex.names)),
    },
    sent: new Map(Object.entries(file.sent)),
  });
};

export const textOf = (state: State): string =>
  `${JSON.stringify({
    ranAt: DateTime.formatIso(state.ranAt),
    goodAt: Option.match(state.goodAt, {
      onNone: () => null,
      onSome: DateTime.formatIso,
    }),
    transcripts: Object.fromEntries(state.transcripts),
    codex: {
      offset: state.codex.offset,
      names: Object.fromEntries(state.codex.names),
    },
    sent: Object.fromEntries(state.sent),
  })}\n`;

/** Where the clients keep what the reporter reads. */
export interface Sources {
  /** Claude Code's projects, each a directory of transcripts. */
  readonly projects: string;
  readonly codexIndex: string;
  readonly t3Database: string;
}

/** Where the sources are: under the home (`USERPROFILE` on Windows), and Codex's under `CODEX_HOME` when it is set. */
export const sourcesOf = (
  system: System,
  variables: Variables,
): Result.Result<Sources, DirectoryUnknown> => {
  const windows = system === "win32";
  const separator = windows ? "\\" : "/";
  const homeVariable = windows ? "USERPROFILE" : "HOME";
  const home = variables[homeVariable];
  if (home === undefined || home === "") {
    return Result.fail(new DirectoryUnknown({ variable: homeVariable }));
  }
  const under = (directory: string, ...names: ReadonlyArray<string>) =>
    [directory.replace(windows ? /[\\/]+$/ : /\/+$/, ""), ...names].join(
      separator,
    );
  const codexHome = variables.CODEX_HOME;
  return Result.succeed({
    projects: under(home, ".claude", "projects"),
    codexIndex:
      codexHome === undefined || codexHome === ""
        ? under(home, ".codex", "session_index.jsonl")
        : under(codexHome, "session_index.jsonl"),
    t3Database: under(home, ".t3", "userdata", "statev2.sqlite"),
  });
};
