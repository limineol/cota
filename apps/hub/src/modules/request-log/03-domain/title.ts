import { DateTime, Option, Schema } from "effect";
import { compareText, cut } from "#shared/03-domain/text.ts";
import type { Roled } from "./request-role.ts";
import type { SessionRequest, StoredContent } from "./session.ts";

/** How many characters of a title, and of the machine that reported it, are kept. */
export const longest = 200;

/** A title as it is kept: each lone surrogate made U+FFFD, trimmed, and cut to 200 characters. */
export const keptOf = (text: string): string =>
  cut(text.toWellFormed().trim(), longest);

/** One title a machine reported for a session; an empty title clears it. */
export interface Report {
  readonly session: string;
  readonly title: string;
  readonly reportedAt: DateTime.Utc;
  readonly machine: string;
  /** The hub key's name, or `owner`. */
  readonly reportedBy: string;
}

/** By `reportedAt`, then `machine`, `title` and `reportedBy`, so that every reader picks the same latest report. */
const reportOrder = (one: Report, other: Report): number =>
  DateTime.toEpochMillis(one.reportedAt) -
    DateTime.toEpochMillis(other.reportedAt) ||
  compareText(one.machine, other.machine) ||
  compareText(one.title, other.title) ||
  compareText(one.reportedBy, other.reportedBy);

/** Each session's latest report (T9). */
export const latestReports = (
  reports: ReadonlyArray<Report>,
): ReadonlyMap<string, Report> => {
  const latest = new Map<string, Report>();
  for (const report of reports) {
    const kept = latest.get(report.session);
    if (kept === undefined || reportOrder(report, kept) > 0) {
      latest.set(report.session, report);
    }
  }
  return latest;
};

/** The title a session shows: its latest report when not empty, else its generated title (T8). */
export type Shown =
  | {
      readonly source: "reported";
      readonly text: string;
      readonly at: DateTime.Utc;
      readonly machine: string;
    }
  | {
      readonly source: "generated";
      readonly text: string;
      readonly at: DateTime.Utc;
    };

export interface Generated {
  readonly text: string;
  /** When the request that generated it started. */
  readonly at: DateTime.Utc;
}

export const shownOf = (
  latest: Option.Option<Report>,
  generated: Option.Option<Generated>,
): Option.Option<Shown> => {
  const reported = Option.filter(latest, ({ title }) => title !== "");
  if (Option.isSome(reported)) {
    return Option.some({
      source: "reported",
      text: reported.value.title,
      at: reported.value.reportedAt,
      machine: reported.value.machine,
    });
  }
  return Option.map(generated, ({ text, at }) => ({
    source: "generated",
    text,
    at,
  }));
};

/** The `ok` requests of a session whose role is `title`, the latest first: each is tried in turn for a generated title. */
export const titleRequestsOf = (
  roled: ReadonlyArray<Roled>,
): ReadonlyArray<SessionRequest> =>
  roled
    .filter(
      ({ requestRole, request }) =>
        requestRole === "title" && request.outcome === "ok",
    )
    .map(({ request }) => request)
    .reverse();

const Answer = Schema.fromJsonString(
  Schema.Struct({
    content: Schema.Array(Schema.Unknown),
  }),
);

const TextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

const Titled = Schema.fromJsonString(Schema.Struct({ title: Schema.String }));

/**
 * The title an `anthropic-messages` title request's answer gives: the text of
 * the first `text` block of its output item, read as a JSON object whose
 * `title` is a string, kept as a title; none when that does not hold or the
 * title is empty.
 */
export const generatedOf = (
  output: ReadonlyArray<StoredContent>,
): Option.Option<string> => {
  const [item] = output;
  if (item === undefined) return Option.none();
  return Option.flatMap(
    Schema.decodeOption(Answer)(item.content),
    ({ content }) => {
      const block = content.find(Schema.is(TextBlock));
      if (block === undefined) return Option.none();
      return Option.filter(
        Option.map(Schema.decodeOption(Titled)(block.text), ({ title }) =>
          keptOf(title),
        ),
        (title) => title !== "",
      );
    },
  );
};

/**
 * The generated title: the first of a session's `ok` title requests, the
 * latest first, whose answer reads as one.
 */
export const generatedAmong = (
  titleRequests: ReadonlyArray<SessionRequest>,
  outputOf: (request: SessionRequest) => ReadonlyArray<StoredContent>,
): Option.Option<Generated> => {
  for (const request of titleRequests) {
    const text = generatedOf(outputOf(request));
    if (Option.isSome(text)) {
      return Option.some({ text: text.value, at: request.startedAt });
    }
  }
  return Option.none();
};
