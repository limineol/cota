import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as InMemoryArchiveDirectory from "#modules/request-log/05-tests/fakes/in-memory-archive-directory.ts";
import * as Scripted from "#modules/request-log/05-tests/fakes/scripted-request-log-archive.ts";
import * as ArchiveDaysCommand from "./archive-days.command.ts";

const hour = 3_600_000;
const dayLength = 24 * hour;
/** 2026-11-09, the first of the four days the logs fall on. */
const firstDay = Date.UTC(2026, 10, 9);

const int = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

/** Where a row falls: one of four days, at its start, its end or between; and its values, with characters JSON escapes. */
const Placed = Schema.Struct({
  day: int(0, 3),
  offset: Schema.Literals([0, 1, 43_200_000, dayLength - 1]),
  text: Schema.Literals(["a", 'b\n"c"', ""]),
});
type Placed = typeof Placed.Type;

const rows = Arbitrary.array(Arbitrary.schema(Placed), { maxLength: 4 });
const logs = Arbitrary.all({
  items: rows,
  request_items: rows,
  requests: rows,
  session_titles: rows,
});
type LogScene = { readonly [table in Archive.Table]: ReadonlyArray<Placed> };

/** How the log changes after a run: a row added, an item's earlier copy written (on its day or before it), a row lost, or every row of a day lost. */
const Change = Schema.Struct({
  kind: Schema.Literals(["add", "earlier", "lose", "empty"]),
  table: Archive.Table,
  index: int(0, 5),
  placed: Placed,
});
type Change = typeof Change.Type;
const changes = Arbitrary.array(Arbitrary.schema(Change), { maxLength: 3 });

const Fault = Schema.Struct({
  op: Schema.Literals([
    "summaries",
    "source",
    "export",
    "load",
    "logged",
    "lacking",
  ]),
  at: int(0, 11),
  how: Schema.Literals(["fails", "breaks off", "disagrees", "differs"]),
});
const faults = Arbitrary.array(Arbitrary.schema(Fault), { maxLength: 4 });
/** Which operations of the directory fail, counted from the run's first. */
const directoryFaults = Arbitrary.array(Arbitrary.schema(int(0, 40)), {
  maxLength: 2,
});

/** An instant at the end of one of the days, then 0, 1 or 2 hours, then a millisecond either side or none. */
const Instant = Schema.Struct({
  day: int(0, 3),
  hours: int(0, 2),
  nudge: int(-1, 1),
});
type Instant = typeof Instant.Type;
const instants = Arbitrary.schema(Instant);
const later = Arbitrary.schema(Schema.Literals([0, hour, dayLength]));

const millisOf = (instant: Instant) =>
  firstDay +
  (instant.day + 1) * dayLength +
  instant.hours * hour +
  instant.nudge;

const atOf = (placed: Placed) =>
  firstDay + placed.day * dayLength + placed.offset;

const logOf = (scene: LogScene): Scripted.Log => {
  const table = (name: Archive.Table) =>
    scene[name].map((placed, index) => ({
      id: `${name}-${index}`,
      at: atOf(placed),
      text: placed.text,
    }));
  return {
    items: table("items"),
    request_items: table("request_items"),
    requests: table("requests"),
    session_titles: table("session_titles"),
  };
};

const change = (log: Scripted.Log, each: Change, count: number) => {
  const rows = log[each.table];
  const picked = rows[each.index % Math.max(rows.length, 1)];
  if (each.kind === "add") {
    rows.push({
      id: `${each.table}-added-${count}`,
      at: atOf(each.placed),
      text: each.placed.text,
    });
  }
  const item = log.items[each.index % Math.max(log.items.length, 1)];
  if (each.kind === "earlier" && item !== undefined) {
    log.items = [
      ...log.items.filter((row) => row !== item),
      { ...item, at: item.at - each.placed.offset - 1 },
    ];
  }
  if (each.kind === "lose" && picked !== undefined) {
    log[each.table] = rows.filter((row) => row !== picked);
  }
  if (each.kind === "empty") {
    const day = Scripted.dayOf(atOf(each.placed));
    for (const table of Archive.tables) {
      log[table] = log[table].filter(({ at }) => Scripted.dayOf(at) !== day);
    }
  }
};

const changeAll = (log: Scripted.Log, changes: ReadonlyArray<Change>) => {
  for (const [count, each] of changes.entries()) change(log, each, count);
};

const layerOf = (log: Scripted.Log) =>
  ArchiveDaysCommand.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(InMemoryArchiveDirectory.layer, Scripted.layer(log)),
    ),
  );

const runAt = (millis: number) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(millis);
    return yield* (yield* ArchiveDaysCommand.ArchiveDays).execute;
  });

const held = Effect.gen(function* () {
  return {
    directory: yield* InMemoryArchiveDirectory.InMemoryArchiveDirectory,
    script: yield* Scripted.ScriptedRequestLogArchive,
  };
});

/** From now on, the operations of the script and of the directory fail as given, counted from here. */
const failing = (
  scriptFaults: ReadonlyArray<typeof Fault.Type>,
  failingOps: ReadonlyArray<number>,
) =>
  Effect.gen(function* () {
    const { directory, script } = yield* held;
    script.faults = scriptFaults.map((fault) => ({
      ...fault,
      at: fault.at + script.calls[fault.op],
    }));
    const from = directory.ops.length;
    directory.fails = (_, index) => failingOps.includes(index - from);
  });

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const manifestsIn = (
  directory: InMemoryArchiveDirectory.InMemoryArchiveDirectory["Service"],
) =>
  [...directory.files].flatMap(([path, bytes]) => {
    const [day, name] = path.split("/");
    if (name !== Archive.manifestName || !Schema.is(Archive.Day)(day)) {
      return [];
    }
    const reading = Archive.readManifest(day, textOf(bytes));
    return reading._tag === "Readable" ? [reading.manifest] : [];
  });

/** The rows a day's archive holds, read back from the files its manifest names. */
const archivedRows = (
  directory: InMemoryArchiveDirectory.InMemoryArchiveDirectory["Service"],
  manifest: Archive.Manifest,
) =>
  Effect.forEach(manifest.tables, ({ table, file }) =>
    Effect.gen(function* () {
      if (file === null) return [];
      const bytes = directory.files.get(`${manifest.day}/${file}`);
      if (bytes === undefined) return [];
      const rows = yield* Scripted.decodedRows(textOf(bytes));
      return rows.map((row) => ({ table, row }));
    }),
  ).pipe(Effect.map((tables) => tables.flat()));

const allHeld = (
  log: Scripted.Log,
  rows: ReadonlyArray<{ table: Archive.Table; row: Scripted.Row }>,
) => rows.every(({ table, row }) => Scripted.isHeld(log, table, row));

const finalName = /^\d{4}-\d{2}-\d{2}\/([a-z_]+)\.[0-9a-f]{16}\.jsonl\.zst$/;

/** Each table file with a final name, or named by a manifest, that was not loaded in a session that found the log's count and checksum of its table and day. */
const unverified = (
  directory: InMemoryArchiveDirectory.InMemoryArchiveDirectory["Service"],
  script: Scripted.ScriptedRequestLogArchive["Service"],
) => {
  const named = manifestsIn(directory).flatMap((manifest) =>
    manifest.tables.flatMap(({ file }) =>
      file === null ? [] : [`${manifest.day}/${file}`],
    ),
  );
  const finals = [...directory.files.keys()].filter((path) =>
    finalName.test(path),
  );
  return [...new Set([...finals, ...named])].filter((path) => {
    const [day, name = ""] = path.split("/");
    const table = name.split(".")[0];
    const bytes = directory.files.get(path);
    if (bytes === undefined) return true;
    return !script.loads.some(
      (load) =>
        load.table === table &&
        load.bytes === textOf(bytes) &&
        script.checks.some(
          (check) =>
            check.session === load.session &&
            check.day === day &&
            check.table === table &&
            check.logged.rows === load.measure.rows &&
            check.logged.checksum === load.measure.checksum,
        ),
    );
  });
};

/** The paths an operation wrote, renamed from or to, or removed. */
const touched = (op: InMemoryArchiveDirectory.Op) =>
  op.op === "rename" ? [op.path, op.to] : [op.path];

const runs = { arbitrary: { runs: 200 } };

describe("ArchiveDays", () => {
  it.effect.prop(
    "B2: after runs whose exports, loads and checks fail, break off or disagree, and whose writes and renames fail, every table file with a final name or named by a manifest was loaded and found the log's count and checksum of its table and day",
    {
      log: logs,
      between: changes,
      first: instants,
      after: later,
      scriptFaults: Arbitrary.array(faults, { minLength: 2, maxLength: 2 }),
      failingOps: Arbitrary.array(directoryFaults, {
        minLength: 2,
        maxLength: 2,
      }),
    },
    ({ log: scene, between, first, after, scriptFaults, failingOps }) => {
      const log = logOf(scene);
      return Effect.gen(function* () {
        const { directory, script } = yield* held;
        const found = [];
        for (const [index, at] of [
          millisOf(first),
          millisOf(first) + after,
        ].entries()) {
          yield* failing(scriptFaults[index] ?? [], failingOps[index] ?? []);
          yield* runAt(at);
          found.push(unverified(directory, script));
          changeAll(log, between);
        }
        expect(found).toEqual([[], []]);
      }).pipe(Effect.provide(layerOf(log)));
    },
    runs,
  );

  it.effect.prop(
    "B3: a second run over a log that has not changed, with no other day due and no partial file, writes, renames and removes no file, whatever fails, left over or unreadable",
    {
      log: logs,
      first: instants,
      scriptFaults: faults,
      orphans: Arbitrary.array(Arbitrary.schema(Placed), { maxLength: 2 }),
      unreadable: Arbitrary.array(Arbitrary.schema(int(0, 3)), {
        maxLength: 2,
      }),
    },
    ({ log: scene, first, scriptFaults, orphans, unreadable }) => {
      const log = logOf(scene);
      return Effect.gen(function* () {
        const { directory } = yield* held;
        yield* runAt(millisOf(first));
        for (const orphan of orphans) {
          const day = Scripted.dayOf(atOf(orphan));
          directory.directories.add(day);
          directory.files.set(
            `${day}/items.${orphan.offset.toString(16).padStart(16, "0")}.jsonl.zst`,
            new TextEncoder().encode(orphan.text),
          );
        }
        for (const index of unreadable) {
          const path = `${Scripted.dayOf(firstDay + index * dayLength)}/${Archive.manifestName}`;
          if (directory.files.has(path)) {
            directory.files.set(path, new TextEncoder().encode("{ not json"));
          }
        }
        const before = new Map(directory.files);
        directory.ops.length = 0;
        yield* failing(scriptFaults, []);
        yield* runAt(millisOf(first));
        expect([directory.ops, directory.files]).toEqual([[], before]);
      }).pipe(Effect.provide(layerOf(log)));
    },
    runs,
  );

  it.effect.prop(
    "B4: after a run in which nothing failed, every archived day that the log holds rows of, and whose archived rows it all holds, has a manifest equal to the log's summary of it",
    { log: logs, between: changes, first: instants, after: later },
    ({ log: scene, between, first, after }) => {
      const log = logOf(scene);
      return Effect.gen(function* () {
        const { directory } = yield* held;
        yield* runAt(millisOf(first));
        changeAll(log, between);
        const second = yield* runAt(millisOf(first) + after);
        expect(
          second._tag === "Ran" &&
            second.days.every(([, { _tag }]) => _tag !== "Failed"),
        ).toBe(true);
        const differing = [];
        for (const manifest of manifestsIn(directory)) {
          if (!allHeld(log, yield* archivedRows(directory, manifest))) continue;
          const summary = Archive.tables.map((table) =>
            Scripted.tallyOf(Scripted.rowsOf(log, manifest.day, table)),
          );
          if (summary.every(({ rows }) => rows === 0)) continue;
          const archived = manifest.tables.map(({ rows, fingerprint }) => ({
            rows,
            fingerprint,
          }));
          if (JSON.stringify(archived) !== JSON.stringify(summary)) {
            differing.push({ day: manifest.day, archived, summary });
          }
        }
        expect(differing).toEqual([]);
      }).pipe(Effect.provide(layerOf(log)));
    },
    runs,
  );

  it.effect(
    "keeps the archive of a day whose only rows moved to an earlier day, archives that day, and lists the first as missing",
    () => {
      const noon = Date.parse("2026-11-11T12:00:00Z");
      const log: Scripted.Log = {
        ...Scripted.emptyLog(),
        items: [{ id: "items-0", at: noon, text: "a" }],
      };
      return Effect.gen(function* () {
        const { directory } = yield* held;
        const at = Date.parse("2026-11-12T01:00:00Z");
        yield* runAt(at);
        const archived = directory.files.get("2026-11-11/manifest.json");
        log.items = [{ id: "items-0", at: noon - 12 * hour - 1, text: "a" }];
        const second = yield* runAt(at);
        expect([
          second._tag === "Ran"
            ? second.days.map(([day, { _tag }]) => [day, _tag])
            : second,
          directory.files.get("2026-11-11/manifest.json") === archived,
        ]).toEqual([
          [
            ["2026-11-10", "Archived"],
            ["2026-11-11", "Missing"],
          ],
          true,
        ]);
      }).pipe(Effect.provide(layerOf(log)));
    },
  );

  it.effect.prop(
    "B5: a run never replaces, renames or removes the manifest of a day whose archived rows the log does not all hold, nor a file it names, whatever fails",
    {
      log: logs,
      between: Arbitrary.array(Arbitrary.schema(Change), {
        minLength: 1,
        maxLength: 3,
      }),
      first: instants,
      after: later,
      scriptFaults: faults,
      failingOps: directoryFaults,
    },
    ({ log: scene, between, first, after, scriptFaults, failingOps }) => {
      const log = logOf(scene);
      return Effect.gen(function* () {
        const { directory } = yield* held;
        yield* runAt(millisOf(first));
        changeAll(log, between);
        const kept = new Map<string, Uint8Array>();
        for (const manifest of manifestsIn(directory)) {
          if (allHeld(log, yield* archivedRows(directory, manifest))) continue;
          for (const name of [
            Archive.manifestName,
            ...manifest.tables.flatMap(({ file }) =>
              file === null ? [] : [file],
            ),
          ]) {
            const path = `${manifest.day}/${name}`;
            kept.set(path, directory.files.get(path) ?? new Uint8Array());
          }
        }
        directory.ops.length = 0;
        yield* failing(scriptFaults, failingOps);
        yield* runAt(millisOf(first) + after);
        expect([
          directory.ops.filter((op) =>
            touched(op).some((path) => kept.has(path)),
          ),
          [...kept.keys()].filter(
            (path) =>
              directory.files.get(path)?.join() !== kept.get(path)?.join(),
          ),
        ]).toEqual([[], []]);
      }).pipe(Effect.provide(layerOf(log)));
    },
    runs,
  );

  it.effect.prop(
    "B10: no run archives a day for the first time before an hour has passed since it ended, at any instant and whatever fails",
    {
      log: logs,
      instants: Arbitrary.array(instants, { minLength: 2, maxLength: 2 }),
      scriptFaults: faults,
    },
    ({ log: scene, instants: [first, second], scriptFaults }) => {
      const log = logOf(scene);
      return Effect.gen(function* () {
        const { directory } = yield* held;
        yield* failing(scriptFaults, []);
        const early = [];
        for (const instant of [first, second]) {
          if (instant === undefined) continue;
          const now = millisOf(instant);
          const before = new Set(manifestsIn(directory).map(({ day }) => day));
          yield* runAt(now);
          for (const { day } of manifestsIn(directory)) {
            const ended = Date.parse(`${day}T00:00:00Z`) + dayLength;
            if (!before.has(day) && now - ended < hour) {
              early.push({ day, now: new Date(now).toISOString() });
            }
          }
        }
        expect(early).toEqual([]);
      }).pipe(Effect.provide(layerOf(log)));
    },
    runs,
  );
});
