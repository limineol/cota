import { Option, Schema } from "effect";

/** What this browser keeps of the console between visits: the editor's text and the last runs. */
export const draftKey = "cota-sql";
export const historyKey = "cota-sql-history";

const kept = 20;

const Run = Schema.Struct({
  sql: Schema.String,
  at: Schema.Finite,
  answered: Schema.Union([
    Schema.Struct({
      rows: Schema.Finite,
      elapsedMs: Schema.Finite,
      truncated: Schema.Boolean,
    }),
    Schema.Null,
  ]),
});

/** A run as the history keeps it: its SQL, when it was run, and its rows and time, or `null` when it failed. */
export type Run = typeof Run.Type;

const decodeRuns = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Run)),
);

export const readDraft = (): string | null => {
  try {
    return localStorage.getItem(draftKey);
  } catch {
    return null;
  }
};

export const keepDraft = (sql: string) => {
  try {
    localStorage.setItem(draftKey, sql);
  } catch {
    // A browser that keeps nothing still runs the SQL.
  }
};

export const readRuns = (): ReadonlyArray<Run> => {
  try {
    return Option.getOrElse(
      decodeRuns(localStorage.getItem(historyKey)),
      () => [],
    );
  } catch {
    return [];
  }
};

/** The runs with `run` first, the same SQL run before it dropped, at most twenty of them. */
export const withRun = (
  runs: ReadonlyArray<Run>,
  run: Run,
): ReadonlyArray<Run> =>
  [run, ...runs.filter((each) => each.sql !== run.sql)].slice(0, kept);

export const keepRuns = (runs: ReadonlyArray<Run>) => {
  try {
    localStorage.setItem(historyKey, JSON.stringify(runs));
  } catch {
    // As above: the history is a convenience of this browser.
  }
};
