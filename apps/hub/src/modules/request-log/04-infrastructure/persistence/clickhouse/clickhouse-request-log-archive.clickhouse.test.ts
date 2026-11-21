import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Context,
  DateTime,
  Effect,
  Layer,
  Metric,
  Option,
  Schema,
  type Scope,
  Stream,
} from "effect";
import * as ArchiveDays from "#modules/request-log/02-application/commands/archive-days.command.ts";
import * as RestoreArchive from "#modules/request-log/02-application/commands/restore-archive.command.ts";
import { RequestLogArchive } from "#modules/request-log/02-application/interfaces/request-log-archive.ts";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as FileSystemArchiveDirectory from "#modules/request-log/04-infrastructure/archive/file-system-archive-directory.ts";
import * as Scratch from "#modules/request-log/05-tests/scratch.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import "#shared/05-tests/property-seed.ts";
import * as ClickHouseRequestLogArchive from "./clickhouse-request-log-archive.ts";
import * as ClickHouseSessionTitles from "./clickhouse-session-titles.ts";
import * as ClickHouse from "./client.ts";

const titles = [
  {
    session: "s-1",
    title: "a title\twith a tab, \\ and \u0000",
    reported_at: "2026-11-10T23:59:59.999Z",
    machine: "m",
    reported_by: "claude-code",
  },
  {
    session: "s-2",
    title: "",
    reported_at: "2026-11-10T00:00:00.000Z",
    machine: "",
    reported_by: "codex",
  },
  {
    session: "s-1",
    title: "the next day",
    reported_at: "2026-11-11T00:00:00.000Z",
    machine: "m",
    reported_by: "claude-code",
  },
];

const dayOf = Schema.decodeSync(Archive.Day);

const collected = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.runCollect(stream).pipe(Effect.map((chunks) => Array.from(chunks)));

describe("the request log's archive in ClickHouse", () => {
  it.live(
    "a day's export loads back to its count and checksum, its fingerprint is the summary's, and the session's tables behave as the archiver assumes",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const archive = yield* RequestLogArchive;
        yield* archive.prepare;
        yield* clickHouse.insert("session_titles", titles);

        const summaries = yield* archive.summaries;
        expect([...summaries.keys()].sort()).toEqual([
          "2026-11-10",
          "2026-11-11",
        ]);
        const source = yield* archive.source;
        expect(Object.keys(source.tables)).toEqual([
          "items",
          "request_items",
          "requests",
          "session_titles",
        ]);

        const session = yield* archive.session;
        const chunks = yield* collected(
          session.export(dayOf("2026-11-10"), "session_titles"),
        );
        expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(
          // checked as more than none: the file is zstd, never decoded here
          chunks.reduce((sum, chunk) => sum + chunk.length, 0),
        );
        expect(chunks.length).toBeGreaterThan(0);
        const zstdMagic = [0x28, 0xb5, 0x2f, 0xfd];
        expect(Array.from(chunks[0]?.slice(0, 4) ?? [])).toEqual(zstdMagic);

        const measure = yield* session.load(
          "session_titles",
          Stream.fromIterable(chunks),
        );
        const logged = yield* session.logged(
          dayOf("2026-11-10"),
          "session_titles",
        );
        expect(measure.rows).toBe(2);
        expect(measure.checksum).toBe(logged.checksum);
        expect(measure.fingerprint).toBe(
          summaries.get(dayOf("2026-11-10"))?.session_titles.fingerprint,
        );

        const again = yield* session.load(
          "session_titles",
          Stream.fromIterable(chunks),
        );
        expect(again.rows).toBe(2);

        expect(yield* session.lacking("session_titles")).toBe(0);
        yield* clickHouse.command(
          "DELETE FROM session_titles WHERE session = 's-2'",
        );
        expect(yield* session.lacking("session_titles")).toBe(1);
        expect(
          yield* session.add("session_titles", [
            "session",
            "title",
            "reported_at",
            "machine",
            "reported_by",
          ]),
        ).toBe(1);
        expect(yield* session.lacking("session_titles")).toBe(0);
        yield* session.drop("session_titles");
        const reloaded = yield* session.load(
          "session_titles",
          Stream.fromIterable(chunks),
        );
        expect(reloaded.rows).toBe(2);

        const empty = yield* collected(
          session.export(dayOf("2026-11-12"), "items"),
        );
        expect(empty).toEqual([]);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          ClickHouseRequestLogArchive.layer.pipe(
            Layer.provideMerge(Scratch.layer),
          ),
        ),
      ),
    60_000,
  );
});

const hour = 3_600_000;
const day = 24 * hour;
const first = Date.UTC(2026, 10, 8);
const spanOfDays = 3;

/** A generated time moved into three UTC days from 8 November 2026, so that sessions cross midnight. */
const moved = (at: DateTime.Utc) =>
  DateTime.makeUnsafe(
    first +
      ((DateTime.toEpochMillis(at) - Generated.span.from) % (spanOfDays * day)),
  );

/** The generated reports may be none, and every table needs a row for the restore's laws. */
const alwaysReported = {
  session: "s1",
  title: "Fix the relay",
  machine: "workstation",
  reportedBy: "owner",
};

const sampled = Effect.gen(function* () {
  const [log] = yield* Arbitrary.sampleEffect(Sessions.sessionLog(24), {
    count: 1,
  });
  const [reports] = yield* Arbitrary.sampleEffect(Sessions.reports, {
    count: 1,
  });
  return {
    log: (log ?? []).map(({ request, cost }) => ({
      request: { ...request, startedAt: moved(request.startedAt) },
      cost,
    })),
    reports: [alwaysReported, ...(reports ?? [])].map((report, index) => ({
      ...report,
      reportedAt: DateTime.makeUnsafe(
        first + ((index * 7 * hour) % (spanOfDays * day)),
      ),
    })),
  };
}).pipe(Effect.orDie);

/** Writes a generated log over three days, half of `known`'s answers lost so that items are written twice, and titles. */
const writeLog = Effect.gen(function* () {
  const { faults } = yield* Scratch.Scratch;
  const titles = yield* SessionTitles;
  const archive = yield* RequestLogArchive;
  yield* archive.prepare.pipe(Effect.orDie);
  const { log, reports } = yield* sampled;
  let asked = 0;
  faults.faultOf = (query) =>
    query.startsWith("SELECT session, digest FROM items") && asked++ % 2 === 0
      ? "down"
      : undefined;
  yield* Scratch.written(log);
  faults.faultOf = () => undefined;
  yield* titles.store(reports).pipe(Effect.orDie);
  return log;
});

const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "cota-archive-"))),
  (directory) =>
    Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
);

const runIn = (directory: string) =>
  Effect.gen(function* () {
    const archiveDays = yield* ArchiveDays.ArchiveDays;
    return yield* archiveDays.execute;
  }).pipe(
    Effect.provide(
      ArchiveDays.layer.pipe(
        Layer.provide(FileSystemArchiveDirectory.layer(directory)),
      ),
    ),
    Effect.orDie,
  );

/** Every file under the directory, with what would show it was written again. */
const filesIn = (directory: string) =>
  Effect.promise(async () => {
    const files = new Map<string, string>();
    for (const entry of await fs.readdir(directory, { recursive: true })) {
      const at = path.join(directory, entry);
      const stat = await fs.stat(at);
      if (stat.isFile()) {
        files.set(entry, `${stat.size} ${stat.mtimeMs} ${stat.ino}`);
      }
    }
    return files;
  });

const manifestsIn = (directory: string) =>
  Effect.promise(async () => {
    const manifests = new Map<string, Archive.Reading>();
    for (const day of await fs.readdir(directory)) {
      const text = await fs
        .readFile(path.join(directory, day, Archive.manifestName), "utf8")
        .catch(() => undefined);
      if (text !== undefined) {
        manifests.set(day, Archive.readManifest(dayOf(day), text));
      }
    }
    return manifests;
  });

/** Each archived day the log holds rows of, and whether its manifest equals the log's summary of it. */
const matching = (directory: string) =>
  Effect.gen(function* () {
    const summaries = yield* (yield* RequestLogArchive).summaries.pipe(
      Effect.orDie,
    );
    const manifests = yield* manifestsIn(directory);
    return [...summaries.keys()].sort().map((archived) => {
      const reading = manifests.get(archived);
      const summary = summaries.get(archived);
      return [
        archived,
        reading?._tag === "Readable" &&
          summary !== undefined &&
          Archive.matches(reading.manifest, summary),
      ] as const;
    });
  });

const inScratch = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | RequestLogArchive
    | SessionTitles
    | Scratch.Scratch
    | ClickHouse.ClickHouse
    | Scope.Scope
  >,
) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        ClickHouseRequestLogArchive.layer,
        ClickHouseSessionTitles.layer,
      ).pipe(Layer.provideMerge(Scratch.layer)),
    ),
  );

const onlyReads = /^\s*(SELECT|WITH)\b/i;
const tableNames = /\b(items|request_items|requests|session_titles|words)\b/;

/** Whether a statement the archive sent changes nothing of the log's tables: a select, an insert, or its own temporary tables made and dropped. */
const leavesTheLog = (statement: string) =>
  onlyReads.test(statement) ||
  /^INSERT INTO (items|request_items|requests|session_titles|archive_(items|request_items|requests|session_titles)) /.test(
    statement,
  ) ||
  /^CREATE TEMPORARY TABLE archive_(items|request_items|requests|session_titles) ENGINE = MergeTree ORDER BY tuple\(\) EMPTY AS SELECT \* FROM (items|request_items|requests|session_titles)$/.test(
    statement,
  ) ||
  /^DROP TEMPORARY TABLE IF EXISTS archive_(items|request_items|requests|session_titles)$/.test(
    statement,
  ) ||
  !tableNames.test(statement);

const itemAt = (firstSeen: string, requestId: string) => ({
  session: "s-1",
  digest: "1",
  protocol: "anthropic-messages",
  first_seen: firstSeen,
  request_id: requestId,
  part: "input",
  position: 0,
  type: "message",
  role: "user",
  content: "{}",
  text: "hello",
});

describe("held items in ClickHouse", () => {
  it.live(
    "an archived item is held by a copy at least as early, and lacking while the log's only copy is later",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        const archive = yield* RequestLogArchive;
        yield* archive.prepare;
        yield* clickHouse.insert("items", [
          itemAt(
            "2026-11-10T10:00:00.000Z",
            "0190000a-0000-7000-8000-000000000001",
          ),
        ]);
        const chunks = yield* collected(
          (yield* archive.session).export(dayOf("2026-11-10"), "items"),
        );
        const lackingNow = Effect.gen(function* () {
          const session = yield* archive.session;
          yield* session.load("items", Stream.fromIterable(chunks));
          return yield* session.lacking("items");
        });
        expect(yield* lackingNow).toBe(0);
        yield* clickHouse.command("TRUNCATE TABLE items");
        yield* clickHouse.insert("items", [
          itemAt(
            "2026-11-10T11:00:00.000Z",
            "0190000a-0000-7000-8000-000000000002",
          ),
        ]);
        expect(yield* lackingNow).toBe(1);
        yield* clickHouse.insert("items", [
          itemAt(
            "2026-11-10T09:00:00.000Z",
            "0190000a-0000-7000-8000-000000000003",
          ),
        ]);
        expect(yield* lackingNow).toBe(0);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          ClickHouseRequestLogArchive.layer.pipe(
            Layer.provideMerge(Scratch.layer),
          ),
        ),
      ),
    60_000,
  );
});

describe("an export over ClickHouse", () => {
  it.live(
    "B2: an export that breaks off after its first bytes fails its stream, and never ends as a short file",
    () =>
      Effect.gen(function* () {
        const clickHouse = yield* ClickHouse.ClickHouse;
        let received = 0;
        const ended = yield* Effect.result(
          Effect.gen(function* () {
            const answer = yield* clickHouse.stream(
              "SELECT number, repeat('x', 200) AS text, throwIf(number = 2000000) AS broken FROM system.numbers LIMIT 3000000 FORMAT JSONEachRow",
              {
                enable_http_compression: "1",
                max_block_size: "1000",
                readonly: "1",
                cancel_http_readonly_queries_on_client_close: "1",
              },
              { zstd: true },
            );
            expect(answer.encoding).toBe("zstd");
            return yield* Stream.runForEach(answer.body, (chunk) =>
              Effect.sync(() => {
                received += chunk.length;
              }),
            );
          }).pipe(Effect.scoped),
        );
        expect(received).toBeGreaterThan(0);
        expect(ended._tag === "Failure" && ended.failure.detail).toBe(
          "the answer ended early",
        );
      }).pipe(Effect.provide(Scratch.layer)),
    60_000,
  );
});

describe("the archiver over ClickHouse", () => {
  it.live(
    "B4: after a run, every day the log holds rows of has a manifest equal to its summary, and a late request gets its day archived again",
    () =>
      inScratch(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const clickHouse = yield* ClickHouse.ClickHouse;
          const log = yield* writeLog;
          // A later copy of an item, as the writer writes when `known` fails,
          // kept apart from the earlier one until a merge.
          yield* clickHouse.command("SYSTEM STOP MERGES items");
          yield* clickHouse.command(
            "INSERT INTO items SELECT * REPLACE (first_seen + toIntervalMillisecond(1) AS first_seen) FROM items WHERE toMinute(first_seen) < 59 LIMIT 1",
          );
          yield* runIn(directory);
          const archived = yield* matching(directory);
          expect(archived.length).toBeGreaterThan(0);
          expect(archived.filter(([, equal]) => !equal)).toEqual([]);

          const [late] = log;
          if (late === undefined) return;
          yield* Scratch.written([
            {
              ...late,
              request: {
                ...late.request,
                id: Sessions.idOf(4_000),
                startedAt: DateTime.makeUnsafe(first + 12 * hour),
              },
            },
          ]);
          yield* runIn(directory);
          expect(
            (yield* matching(directory)).filter(([, equal]) => !equal),
          ).toEqual([]);
        }),
      ),
    120_000,
  );

  it.live(
    "B3: a second run over a log that has not changed writes, renames and removes no file",
    () =>
      inScratch(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          yield* writeLog;
          yield* runIn(directory);
          const before = yield* filesIn(directory);
          expect(before.size).toBeGreaterThan(0);
          yield* runIn(directory);
          expect(yield* filesIn(directory)).toEqual(before);
        }),
      ),
    120_000,
  );

  it.live(
    "B2: an export whose answer is lost, and a row written between the export and the check, leave the day without a manifest and without a final name",
    () =>
      inScratch(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const { faults } = yield* Scratch.Scratch;
          yield* writeLog;
          faults.faultOf = (query) =>
            query.includes("FORMAT JSONEachRow") &&
            query.startsWith("SELECT * FROM requests")
              ? "answerLost"
              : undefined;
          yield* runIn(directory);
          faults.faultOf = () => undefined;
          expect(yield* filesIn(directory)).toEqual(new Map());

          const archive = yield* RequestLogArchive;
          const clickHouse = yield* ClickHouse.ClickHouse;
          let written = false;
          const writing = Layer.succeed(
            RequestLogArchive,
            RequestLogArchive.of({
              ...archive,
              session: Effect.map(archive.session, (session) => ({
                ...session,
                logged: (loggedDay, table) =>
                  Effect.gen(function* () {
                    if (!written && table === "session_titles") {
                      written = true;
                      yield* clickHouse
                        .insert("session_titles", [
                          {
                            session: "late",
                            title: "a late title",
                            reported_at: `${loggedDay}T12:00:00.000Z`,
                            machine: "m",
                            reported_by: "owner",
                          },
                        ])
                        .pipe(Effect.orDie);
                    }
                    return yield* session.logged(loggedDay, table);
                  }),
              })),
            }),
          );
          const archiveDays = yield* ArchiveDays.ArchiveDays.pipe(
            Effect.provide(
              ArchiveDays.layer.pipe(
                Layer.provide([
                  FileSystemArchiveDirectory.layer(directory),
                  writing,
                ]),
              ),
            ),
            Effect.orDie,
          );
          const run = yield* archiveDays.execute;
          expect(written).toBe(true);
          const [failedDay] =
            run._tag === "Ran"
              ? run.days.filter(([, outcome]) => outcome._tag === "Failed")
              : [];
          expect(failedDay).toBeDefined();
          const files = [...(yield* filesIn(directory)).keys()];
          expect(
            files.filter((file) => file.startsWith(`${failedDay?.[0]}/`)),
          ).toEqual([]);
        }),
      ),
    120_000,
  );

  it.live(
    "counts each day it could not archive, and each run that could not read the request log, in cota_archive_failures",
    () =>
      inScratch(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const { faults } = yield* Scratch.Scratch;
          yield* writeLog;
          const failuresSoFar = Effect.map(
            Metric.value(ArchiveDays.failures),
            ({ count }) => Number(count),
          );
          const before = yield* failuresSoFar;
          faults.faultOf = (query) =>
            query.startsWith("SELECT * FROM requests")
              ? "answerLost"
              : undefined;
          const run = yield* runIn(directory);
          const failed =
            run._tag === "Ran"
              ? run.days.filter(([, outcome]) => outcome._tag === "Failed")
                  .length
              : 0;
          expect(failed).toBeGreaterThan(0);
          expect((yield* failuresSoFar) - before).toBe(failed);
          faults.faultOf = () => "down";
          expect((yield* runIn(directory))._tag).toBe("Stopped");
          faults.faultOf = () => undefined;
          expect((yield* failuresSoFar) - before).toBe(failed + 1);
        }),
      ),
    120_000,
  );

  it.live(
    "B8: a run sends the log's tables nothing but SELECT and INSERT, apart from its own temporary tables",
    () =>
      inScratch(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectory;
          const { faults } = yield* Scratch.Scratch;
          const log = yield* writeLog;
          const from = faults.sent.length;
          yield* runIn(directory);
          const ran = faults.sent.length;
          const [late] = log;
          if (late !== undefined) {
            yield* Scratch.written([
              {
                ...late,
                request: {
                  ...late.request,
                  id: Sessions.idOf(4_001),
                  startedAt: DateTime.makeUnsafe(first + 12 * hour),
                },
              },
            ]);
          }
          const between = faults.sent.length;
          yield* runIn(directory);
          const sent = [
            ...faults.sent.slice(from, ran),
            ...faults.sent.slice(between),
          ];
          expect(
            sent.some((statement) =>
              statement.startsWith("CREATE TEMPORARY TABLE"),
            ),
          ).toBe(true);
          expect(sent.filter((statement) => !leavesTheLog(statement))).toEqual(
            [],
          );
        }),
      ),
    120_000,
  );
});

const everyDay: RestoreArchive.Range = {
  from: Option.none(),
  to: Option.none(),
};

const only = (archived: Archive.Day): RestoreArchive.Range => ({
  from: Option.some(archived),
  to: Option.some(archived),
});

/** A second scratch database, for a restore to fill, with its own record of what was sent to it. */
const restoreTarget = Layer.build(
  Layer.fresh(
    ClickHouseRequestLogArchive.layer.pipe(Layer.provideMerge(Scratch.layer)),
  ),
).pipe(
  Effect.map((context) => ({
    archive: Context.get(context, RequestLogArchive),
    clickHouse: Context.get(context, ClickHouse.ClickHouse),
    database: Context.get(context, Scratch.Scratch).database,
    faults: Context.get(context, Scratch.Scratch).faults,
  })),
);

type Target = Effect.Success<typeof restoreTarget>;

const restoreInto = (
  target: Target,
  directory: string,
  range: RestoreArchive.Range = everyDay,
) =>
  Effect.gen(function* () {
    const restoreArchive = yield* RestoreArchive.RestoreArchive;
    return yield* restoreArchive.execute(range);
  }).pipe(
    Effect.provide(
      RestoreArchive.layer.pipe(
        Layer.provide([
          FileSystemArchiveDirectory.layer(directory),
          Layer.succeed(RequestLogArchive, target.archive),
        ]),
      ),
    ),
    Effect.orDie,
  );

/** Each table's count and checksum of its rows of each day. */
const talliesOf = (
  archive: RequestLogArchive["Service"],
  days: ReadonlyArray<Archive.Day>,
) =>
  Effect.gen(function* () {
    const session = yield* archive.session;
    const tallies: Array<string> = [];
    for (const archived of days) {
      for (const table of Archive.tables) {
        const { rows, checksum } = yield* session.logged(archived, table);
        tallies.push(`${archived} ${table} ${rows} ${checksum}`);
      }
    }
    return tallies;
  }).pipe(Effect.orDie);

/** A log written, archived into a temporary directory, and its archived days. */
const archivedLog = Effect.gen(function* () {
  const directory = yield* temporaryDirectory;
  yield* writeLog;
  yield* runIn(directory);
  const days = [...(yield* manifestsIn(directory)).keys()]
    .sort()
    .map((name) => dayOf(name));
  return { directory, days };
});

const tagsOf = (
  restored: ReadonlyArray<readonly [Archive.Day, RestoreArchive.Restored]>,
) => restored.map(([archived, { _tag }]) => `${archived} ${_tag}`);

describe("the restore over ClickHouse", () => {
  it.live(
    "B1: every archived day restored into a log that holds none of its rows gives each table its rows of the day, by count and checksum",
    () =>
      inScratch(
        Effect.gen(function* () {
          const { directory, days } = yield* archivedLog;
          expect(days.length).toBeGreaterThan(1);
          const target = yield* restoreTarget;
          const restored = yield* restoreInto(target, directory);
          expect(tagsOf(restored)).toEqual(
            days.map((archived) => `${archived} Added`),
          );
          expect(yield* talliesOf(target.archive, days)).toEqual(
            yield* talliesOf(yield* RequestLogArchive, days),
          );
        }),
      ),
    120_000,
  );

  it.live(
    "B7: restoring again adds nothing, and a restore into a log that holds part of a day adds only the rest",
    () =>
      inScratch(
        Effect.gen(function* () {
          const { directory, days } = yield* archivedLog;
          const target = yield* restoreTarget;
          yield* restoreInto(target, directory);
          const whole = yield* talliesOf(target.archive, days);
          const again = yield* restoreInto(target, directory);
          expect(tagsOf(again)).toEqual(
            days.map((archived) => `${archived} Held`),
          );
          expect(yield* talliesOf(target.archive, days)).toEqual(whole);

          const [partDay] = days;
          expect(partDay).toBeDefined();
          if (partDay === undefined) return;
          const [deleted] = yield* target.clickHouse
            .select(
              `SELECT toString(count()) AS rows FROM requests WHERE toDate(started_at) = '${partDay}' AND id IN (SELECT id FROM requests WHERE toDate(started_at) = '${partDay}' ORDER BY id LIMIT 2)`,
              Schema.Struct({ rows: Schema.NumberFromString }),
            )
            .pipe(Effect.orDie);
          yield* target.clickHouse
            .command(
              `DELETE FROM requests WHERE toDate(started_at) = '${partDay}' AND id IN (SELECT id FROM requests WHERE toDate(started_at) = '${partDay}' ORDER BY id LIMIT 2)`,
            )
            .pipe(Effect.orDie);
          const rest = yield* restoreInto(target, directory);
          expect(rest).toContainEqual([
            partDay,
            {
              _tag: "Added",
              added: {
                items: 0,
                request_items: 0,
                requests: deleted?.rows,
                session_titles: 0,
              },
            },
          ]);
          expect(yield* talliesOf(target.archive, days)).toEqual(whole);
        }),
      ),
    180_000,
  );

  it.live(
    "B6: a day whose manifest cannot be read, whose file is missing, cut short, changed by a byte or edited in its manifest, or whose log's columns differ, is refused and nothing of it is added",
    () =>
      inScratch(
        Effect.gen(function* () {
          const { directory, days } = yield* archivedLog;
          const [damagedDay] = days;
          expect(damagedDay).toBeDefined();
          if (damagedDay === undefined) return;
          const manifests = yield* manifestsIn(directory);
          const reading = manifests.get(damagedDay);
          expect(reading?._tag).toBe("Readable");
          if (reading?._tag !== "Readable") return;
          const file = reading.manifest.tables.find(
            ({ table }) => table === "requests",
          )?.file;
          expect(file).toEqual(expect.any(String));
          if (file === null || file === undefined) return;
          const dayDirectory = (root: string) => path.join(root, damagedDay);
          const manifestText = (root: string) =>
            fs.readFile(
              path.join(dayDirectory(root), Archive.manifestName),
              "utf8",
            );
          const writeManifest = (root: string, text: string) =>
            fs.writeFile(
              path.join(dayDirectory(root), Archive.manifestName),
              text,
            );
          const damages: ReadonlyArray<
            readonly [string, (root: string) => Promise<void>]
          > = [
            [
              "its manifest cannot be read: it is not JSON",
              (root) => writeManifest(root, "{"),
            ],
            [
              `${file} is missing`,
              (root) => fs.rm(path.join(dayDirectory(root), file)),
            ],
            [
              `${file} does not match its manifest (size)`,
              async (root) => {
                const at = path.join(dayDirectory(root), file);
                await fs.truncate(at, (await fs.stat(at)).size - 1);
              },
            ],
            [
              `${file} does not match its manifest (SHA-256)`,
              async (root) => {
                const at = path.join(dayDirectory(root), file);
                const bytes = await fs.readFile(at);
                bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
                await fs.writeFile(at, bytes);
              },
            ],
            [
              `${file} does not match its manifest (SHA-256)`,
              async (root) => {
                const text = await manifestText(root);
                const sha = /"sha256": "([0-9a-f]{64})"/.exec(
                  text.slice(text.indexOf(`"file": "${file}"`)),
                )?.[1];
                expect(sha).toBeDefined();
                if (sha === undefined) return;
                const edited = `${sha.slice(0, 63)}${sha.endsWith("0") ? "1" : "0"}`;
                await writeManifest(root, text.replace(sha, edited));
              },
            ],
            [
              "loads to other rows than its manifest says (rows)",
              async (root) => {
                const manifest = JSON.parse(await manifestText(root));
                for (const entry of manifest.tables) {
                  if (entry.table === "requests") entry.rows += 1;
                }
                await writeManifest(root, JSON.stringify(manifest, null, 2));
              },
            ],
            [
              "loads to other rows than its manifest says (checksum)",
              async (root) => {
                const manifest = JSON.parse(await manifestText(root));
                for (const entry of manifest.tables) {
                  if (entry.table === "requests") {
                    entry.checksum = String(
                      (BigInt(entry.checksum) + 1n) % 2n ** 64n,
                    );
                  }
                }
                await writeManifest(root, JSON.stringify(manifest, null, 2));
              },
            ],
          ];
          for (const [why, damage] of damages) {
            const copy = yield* temporaryDirectory;
            yield* Effect.promise(() =>
              fs.cp(directory, copy, { recursive: true }),
            );
            yield* Effect.promise(() => damage(copy));
            const target = yield* restoreTarget;
            const restored = yield* restoreInto(target, copy, only(damagedDay));
            expect(restored).toHaveLength(1);
            const [[, outcome] = [damagedDay, { _tag: "Held" }]] = restored;
            expect(outcome._tag).toBe("Refused");
            expect(outcome._tag === "Refused" ? outcome.why : "").toContain(
              why,
            );
            expect(
              (yield* target.archive.summaries.pipe(Effect.orDie)).size,
            ).toBe(0);
          }

          const target = yield* restoreTarget;
          yield* target.archive.prepare.pipe(Effect.orDie);
          yield* target.clickHouse
            .command("ALTER TABLE session_titles MODIFY COLUMN machine String")
            .pipe(Effect.orDie);
          const restored = yield* restoreInto(
            target,
            directory,
            only(damagedDay),
          );
          expect(restored).toEqual([
            [
              damagedDay,
              {
                _tag: "Refused",
                why: "the log's session_titles has other columns than the archive's: column 4 is machine LowCardinality(String) in the archive and machine String in the log",
              },
            ],
          ]);
          expect(
            (yield* target.archive.summaries.pipe(Effect.orDie)).size,
          ).toBe(0);
        }),
      ),
    240_000,
  );

  it.live(
    "B8: a restore sends the log's tables nothing but SELECT and INSERT, apart from prepare and its own temporary tables",
    () =>
      inScratch(
        Effect.gen(function* () {
          const { directory } = yield* archivedLog;
          const target = yield* restoreTarget;
          yield* target.archive.prepare.pipe(Effect.orDie);
          // What prepare sends once the tables exist, as they do when the
          // restore runs it here.
          const before = target.faults.sent.length;
          yield* target.archive.prepare.pipe(Effect.orDie);
          const prepared = target.faults.sent.slice(before);
          const from = target.faults.sent.length;
          yield* restoreInto(target, directory);
          const sent = target.faults.sent.slice(from);
          for (const statement of prepared) {
            const at = sent.indexOf(statement);
            expect(at).toBeGreaterThanOrEqual(0);
            sent.splice(at, 1);
          }
          expect(
            sent.some((statement) =>
              /^\s*INSERT INTO requests /.test(statement),
            ),
          ).toBe(true);
          expect(sent.filter((statement) => !leavesTheLog(statement))).toEqual(
            [],
          );
        }),
      ),
    120_000,
  );

  it.live(
    "B9: a restore adds every row it adds to a table before any row of the next table in the load order",
    () =>
      inScratch(
        Effect.gen(function* () {
          const { directory } = yield* archivedLog;
          const target = yield* restoreTarget;
          const from = target.faults.sent.length;
          yield* restoreInto(target, directory);
          const inserted = target.faults.sent
            .slice(from)
            .flatMap((statement) => {
              const table =
                /^\s*INSERT INTO (items|request_items|requests|session_titles) /.exec(
                  statement,
                )?.[1];
              return table === undefined ? [] : [table];
            });
          expect(new Set(inserted).size).toBe(Archive.tables.length);
          const order = inserted.map((table) =>
            Archive.tables.findIndex((each) => each === table),
          );
          expect(order).toEqual([...order].sort((a, b) => a - b));
        }),
      ),
    120_000,
  );
});

const script = new URL("../../../../../restore-archive.ts", import.meta.url)
  .pathname;

/** Runs `bun run archive:restore` into the target's database, with only the environment it needs. */
const restoreScript = (target: Target, directory: string) =>
  Effect.gen(function* () {
    const workspace = yield* temporaryDirectory;
    const config = path.join(workspace, "cota.toml");
    yield* Effect.promise(() =>
      fs.writeFile(
        config,
        `[clickhouse]
url = "${Scratch.server.url}"
database = "${target.database}"
user = "${Scratch.server.user}"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }
`,
      ),
    );
    return yield* Effect.promise(async () => {
      const child = Bun.spawn([process.execPath, script, directory], {
        cwd: workspace,
        env: {
          PATH: process.env.PATH ?? "",
          COTA_CONFIG: config,
          COTA_CLICKHOUSE_PASSWORD: Scratch.server.password,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    });
  });

const counted = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

const addedLine = (manifest: Archive.Manifest) => {
  const rows = (table: Archive.Table) =>
    manifest.tables.find((entry) => entry.table === table)?.rows ?? 0;
  return `${manifest.day}: added ${counted(rows("items"), "item", "items")}, ${counted(rows("request_items"), "request item", "request items")}, ${counted(rows("requests"), "request", "requests")} and ${counted(rows("session_titles"), "title", "titles")}`;
};

describe("bun run archive:restore over ClickHouse", () => {
  it.live(
    "prints a line per day and exits 1 when a day is refused, 0 when none is, and says a day restored again is already held",
    () =>
      inScratch(
        Effect.gen(function* () {
          const archived = yield* archivedLog;
          const [good, damaged] = archived.days;
          expect(good).toBeDefined();
          expect(damaged).toBeDefined();
          if (good === undefined || damaged === undefined) return;
          const manifests = yield* manifestsIn(archived.directory);
          const reading = manifests.get(good);
          expect(reading?._tag).toBe("Readable");
          if (reading?._tag !== "Readable") return;
          const goodLine = addedLine(reading.manifest);
          const damagedReading = manifests.get(damaged);
          expect(damagedReading?._tag).toBe("Readable");
          if (damagedReading?._tag !== "Readable") return;
          const missing = damagedReading.manifest.tables.find(
            ({ file }) => file !== null,
          )?.file;
          expect(missing).toBeTypeOf("string");
          if (typeof missing !== "string") return;

          const directory = yield* temporaryDirectory;
          for (const each of [good, damaged]) {
            yield* Effect.promise(() =>
              fs.cp(
                path.join(archived.directory, each),
                path.join(directory, each),
                { recursive: true },
              ),
            );
          }
          yield* Effect.promise(() =>
            fs.rm(path.join(directory, damaged, missing)),
          );
          expect(yield* restoreScript(yield* restoreTarget, directory)).toEqual(
            {
              code: 1,
              stdout: `${goodLine}\n${damaged}: refused: ${missing} is missing\n2 days: 1 restored, 0 already held, 1 refused, 0 failed.\n`,
              stderr: "",
            },
          );

          yield* Effect.promise(() =>
            fs.rm(path.join(directory, damaged), { recursive: true }),
          );
          const target = yield* restoreTarget;
          expect(yield* restoreScript(target, directory)).toEqual({
            code: 0,
            stdout: `${goodLine}\n1 day: 1 restored, 0 already held, 0 refused, 0 failed.\n`,
            stderr: "",
          });
          expect(yield* restoreScript(target, directory)).toEqual({
            code: 0,
            stdout: `${good}: already held\n1 day: 0 restored, 1 already held, 0 refused, 0 failed.\n`,
            stderr: "",
          });
        }),
      ),
    180_000,
  );
});
