import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Archive from "./archive.ts";

const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map(
  (day) => Archive.Day.make(day),
);
const dayBefore = Archive.Day.make("2026-11-08");

const hour = 3_600_000;
const dayLength = 24 * hour;

const source: Archive.Source = {
  version: "26.8.36.3",
  database: "cota",
  tables: {
    items: { columns: [{ name: "session", type: "String" }], create: "" },
    request_items: { columns: [], create: "" },
    requests: { columns: [], create: "" },
    session_titles: { columns: [], create: "" },
  },
};

const int = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

const DayScene = Schema.Struct({
  manifest: Schema.Literals(["none", "unreadable", "readable"]),
  unreadable: Schema.Literals(["text", "archive", "day", "shape"]),
  rows: Schema.Tuple([int(0, 2), int(0, 2), int(0, 2), int(0, 2)]),
  /** How the log's rows of the day differ from its manifest's: an `earlier` copy of an item keeps the count and changes the fingerprint, and a `moved` item leaves for the day before. */
  change: Schema.Literals([
    "equal",
    "added",
    "earlier",
    "moved",
    "lost",
    "empty",
  ]),
  table: Archive.Table,
});
type DayScene = typeof DayScene.Type;

const Scene = Schema.Struct({
  days: Schema.Tuple([DayScene, DayScene, DayScene, DayScene]),
  /** Now: the end of one of the days, then 0, 1 or 2 hours, then a millisecond either side or none. */
  now: Schema.Struct({ day: int(0, 3), hours: int(0, 2), nudge: int(-1, 1) }),
});
type Scene = typeof Scene.Type;

const sha256Of = (dayIndex: number, tableIndex: number) =>
  `${dayIndex}${tableIndex}`.padEnd(64, "c");

const fingerprintOf = (dayIndex: number, tableIndex: number, rows: number) =>
  rows === 0 ? "0" : String(1000 * (dayIndex + 1) + 10 * tableIndex + rows);

const manifestOf = (dayIndex: number, scene: DayScene, day = days[dayIndex]) =>
  Archive.manifestOf(
    day ?? dayBefore,
    DateTime.makeUnsafe("2026-11-13T00:00:00Z"),
    source,
    {
      items: archivedOf(dayIndex, 0, scene.rows[0]),
      request_items: archivedOf(dayIndex, 1, scene.rows[1]),
      requests: archivedOf(dayIndex, 2, scene.rows[2]),
      session_titles: archivedOf(dayIndex, 3, scene.rows[3]),
    },
  );

const archivedOf = (
  dayIndex: number,
  tableIndex: number,
  rows: number,
): Archive.Archived => ({
  file:
    rows === 0
      ? Option.none()
      : Option.some({ bytes: 10, sha256: sha256Of(dayIndex, tableIndex) }),
  measure: {
    rows,
    checksum: rows === 0 ? "0" : "77",
    fingerprint: fingerprintOf(dayIndex, tableIndex, rows),
  },
});

const unreadableText = (dayIndex: number, scene: DayScene): string => {
  const encoded = JSON.parse(Archive.textOf(manifestOf(dayIndex, scene)));
  if (scene.unreadable === "text") return "{ not json";
  if (scene.unreadable === "archive") {
    return JSON.stringify({ ...encoded, archive: 2 });
  }
  if (scene.unreadable === "day") {
    return Archive.textOf(manifestOf(dayIndex, scene, dayBefore));
  }
  return JSON.stringify({ ...encoded, tables: encoded.tables.slice(1) });
};

type Tallies = Record<Archive.Table, Archive.Tally>;

const noTallies = (): Tallies => ({ ...Archive.emptySummary });

const talliesOf = (dayIndex: number, scene: DayScene): Tallies => {
  const tally = (tableIndex: number) => {
    const rows = scene.rows[tableIndex] ?? 0;
    return { rows, fingerprint: fingerprintOf(dayIndex, tableIndex, rows) };
  };
  return {
    items: tally(0),
    request_items: tally(1),
    requests: tally(2),
    session_titles: tally(3),
  };
};

const changed = (tally: Archive.Tally, rows: number): Archive.Tally => ({
  rows: tally.rows + rows,
  fingerprint: String(Number(tally.fingerprint) + 7 + rows),
});

/** The log's summaries of every day, from each day's rows and how they changed since it was archived; a day of no rows is given now and then, which ClickHouse never gives. */
const summariesOf = (
  scene: Scene,
): ReadonlyMap<Archive.Day, Archive.Summary> => {
  const tallies = new Map<Archive.Day, Tallies>();
  scene.days.forEach((each, index) => {
    const day = days[index];
    if (day === undefined) return;
    if (each.change !== "empty" || each.manifest === "none") {
      tallies.set(day, talliesOf(index, each));
    }
  });
  scene.days.forEach((each, index) => {
    const day = days[index];
    const own = day === undefined ? undefined : tallies.get(day);
    if (own === undefined || each.manifest === "none") return;
    const table = each.table;
    if (each.change === "added") own[table] = changed(own[table], 1);
    if (each.change === "earlier") own[table] = changed(own[table], 0);
    if (each.change === "lost" && own[table].rows > 0) {
      own[table] = changed(own[table], -1);
    }
    if (each.change === "moved" && own.items.rows > 0) {
      own.items = changed(own.items, -1);
      const before = days[index - 1] ?? dayBefore;
      const theirs = tallies.get(before) ?? noTallies();
      theirs.items = changed(theirs.items, 1);
      tallies.set(before, theirs);
    }
  });
  return tallies;
};

const manifestsOf = (scene: Scene): ReadonlyMap<Archive.Day, Archive.Reading> =>
  new Map(
    scene.days.flatMap((each, index): Array<[Archive.Day, Archive.Reading]> => {
      const day = days[index];
      if (day === undefined || each.manifest === "none") return [];
      return [
        [
          day,
          each.manifest === "readable"
            ? { _tag: "Readable", manifest: manifestOf(index, each) }
            : Archive.readManifest(day, unreadableText(index, each)),
        ],
      ];
    }),
  );

const nowOf = (scene: Scene): number =>
  DateTime.toEpochMillis(
    DateTime.makeUnsafe(`${days[scene.now.day]}T00:00:00Z`),
  ) +
  dayLength +
  scene.now.hours * hour +
  scene.now.nudge;

type Expected =
  | "archives it"
  | "does nothing"
  | "cannot read"
  | "unchanged"
  | "missing"
  | "changed";

/** The archive spec's table of a run's step 4, written out again. */
const expectedOf = (
  day: Archive.Day,
  now: number,
  summary: Archive.Summary | undefined,
  reading: Archive.Reading | undefined,
): Expected => {
  const tally = (table: Archive.Table) =>
    summary?.[table] ?? { rows: 0, fingerprint: "0" };
  const logHoldsRows = Archive.tables.some((table) => tally(table).rows > 0);
  const ended =
    DateTime.toEpochMillis(DateTime.makeUnsafe(`${day}T00:00:00Z`)) + dayLength;
  if (reading === undefined) {
    return logHoldsRows && now - ended >= hour ? "archives it" : "does nothing";
  }
  if (reading._tag === "Unreadable") return "cannot read";
  if (
    reading.manifest.tables.every(
      ({ table, rows, fingerprint }) =>
        rows === tally(table).rows && fingerprint === tally(table).fingerprint,
    )
  ) {
    return "unchanged";
  }
  if (!logHoldsRows) return "missing";
  return "changed";
};

const said: Record<Archive.Decision["_tag"], Expected> = {
  Archive: "archives it",
  Nothing: "does nothing",
  Unreadable: "cannot read",
  Unchanged: "unchanged",
  Missing: "missing",
  Changed: "changed",
};

interface Decided {
  readonly day: Archive.Day;
  readonly decision: Archive.Decision;
  readonly expected: Expected;
  readonly reading: Archive.Reading | undefined;
}

const decided = (scene: Scene) =>
  Effect.gen(function* () {
    const summaries = summariesOf(scene);
    const manifests = manifestsOf(scene);
    const now = nowOf(scene);
    yield* TestClock.setTime(now);
    const decisions = yield* Archive.decide(summaries, manifests);
    expect(decisions.map(([day]) => day)).toEqual(
      [...new Set([...summaries.keys(), ...manifests.keys()])].sort(),
    );
    return decisions.map(
      ([day, decision]): Decided => ({
        day,
        decision,
        expected: expectedOf(day, now, summaries.get(day), manifests.get(day)),
        reading: manifests.get(day),
      }),
    );
  });

const plain = (each: Decided) => [each.day, said[each.decision._tag]];
const asExpected = (each: Decided) => [each.day, each.expected];

/** The scene with every archived day's summary equal to its manifest, and every other day not yet due or without rows. */
const unchangedOf = (scene: Scene): Scene => {
  const now = nowOf(scene);
  const unchanged = (each: DayScene, index: number): DayScene => {
    if (each.manifest !== "none") {
      return { ...each, manifest: "readable", change: "equal" };
    }
    const day = days[index] ?? dayBefore;
    const due = now - DateTime.toEpochMillis(Archive.endOf(day)) >= hour;
    return due ? { ...each, rows: [0, 0, 0, 0] } : each;
  };
  const [first, second, third, fourth] = scene.days;
  return {
    ...scene,
    days: [
      unchanged(first, 0),
      unchanged(second, 1),
      unchanged(third, 2),
      unchanged(fourth, 3),
    ],
  };
};

const scenes = Arbitrary.schema(Scene);
const runs = { arbitrary: { runs: 1000 } };

describe("the archive's decision", () => {
  it.effect.prop(
    "B10: a day without a manifest is decided to be archived exactly when the log holds rows of it and an hour has passed since it ended",
    { scene: scenes },
    ({ scene }) =>
      Effect.gen(function* () {
        const all = yield* decided(scene);
        const unarchived = all.filter(({ reading }) => reading === undefined);
        expect(unarchived.map(plain)).toEqual(unarchived.map(asExpected));
      }),
    runs,
  );

  it.effect(
    "B10: a day is decided to be archived at the instant an hour has passed since it ended, and not a millisecond before",
    () =>
      Effect.gen(function* () {
        const day = Archive.Day.make("2026-11-10");
        const summary = {
          ...Archive.emptySummary,
          requests: { rows: 1, fingerprint: "5" },
        };
        const decisions = [];
        for (const at of [
          "2026-11-11T00:59:59.999Z",
          "2026-11-11T01:00:00.000Z",
        ]) {
          yield* TestClock.setTime(
            DateTime.toEpochMillis(DateTime.makeUnsafe(at)),
          );
          decisions.push(
            (yield* Archive.decide(new Map([[day, summary]]), new Map())).map(
              ([, decision]) => decision._tag,
            ),
          );
        }
        expect(decisions).toEqual([["Nothing"], ["Archive"]]);
      }),
  );

  it.effect.prop(
    "B3: when every archived day's summary equals its manifest and no other day is due, the run is decided to write nothing",
    { scene: scenes },
    ({ scene }) =>
      Effect.gen(function* () {
        const all = yield* decided(unchangedOf(scene));
        expect(all.map(plain)).toEqual(all.map(asExpected));
        expect(
          all.filter(({ decision }) =>
            ["Archive", "Changed"].includes(decision._tag),
          ),
        ).toEqual([]);
      }),
    runs,
  );

  it.effect.prop(
    "B4: a day whose manifest differs from the log's summary of it, and that the log holds rows of, is decided changed, to be checked and archived again",
    { scene: scenes },
    ({ scene }) =>
      Effect.gen(function* () {
        const all = yield* decided(scene);
        const readable = all.filter(
          ({ reading }) => reading?._tag === "Readable",
        );
        expect(readable.map(plain)).toEqual(readable.map(asExpected));
        for (const { decision, reading } of readable) {
          if (decision._tag === "Changed" && reading?._tag === "Readable") {
            expect(decision.manifest).toBe(reading.manifest);
          }
        }
      }),
    runs,
  );

  it.effect.prop(
    "B5: a day with a manifest is never decided to be archived as a new day; one whose manifest cannot be read is left, and one the log holds no row of is missing",
    { scene: scenes },
    ({ scene }) =>
      Effect.gen(function* () {
        const all = yield* decided(scene);
        const archived = all.filter(({ reading }) => reading !== undefined);
        expect(archived.map(plain)).toEqual(archived.map(asExpected));
        expect(
          archived.filter(({ decision }) => decision._tag === "Archive"),
        ).toEqual([]);
      }),
    runs,
  );
});
