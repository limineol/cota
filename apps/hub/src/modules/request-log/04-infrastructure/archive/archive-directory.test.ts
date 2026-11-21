import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option, Stream } from "effect";
import { ArchiveDirectory } from "#modules/request-log/02-application/interfaces/archive-directory.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as InMemoryArchiveDirectory from "#modules/request-log/05-tests/fakes/in-memory-archive-directory.ts";
import * as FileSystemArchiveDirectory from "./file-system-archive-directory.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-archive-directory-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** An archive directory under test, and what a test sees of it and does to it from outside. */
interface Subject {
  readonly layer: Layer.Layer<ArchiveDirectory>;
  /** Every day directory, as `<day>/`, and every file with its text, by its path under the directory. */
  readonly contents: () => Record<string, string>;
  readonly put: (path: string, text: string) => void;
  readonly goAway: () => void;
}

let directories = 0;
const onDisk = (): Subject => {
  directories += 1;
  const root = join(scratch, String(directories));
  mkdirSync(root);
  const walk = (path: string, prefix: string): Array<[string, string]> =>
    readdirSync(path, { withFileTypes: true }).flatMap(
      (entry): Array<[string, string]> =>
        entry.isDirectory()
          ? [
              [`${prefix}${entry.name}/`, ""],
              ...walk(join(path, entry.name), `${prefix}${entry.name}/`),
            ]
          : [
              [
                `${prefix}${entry.name}`,
                readFileSync(join(path, entry.name), "utf8"),
              ],
            ],
    );
  return {
    layer: Layer.succeed(
      ArchiveDirectory,
      FileSystemArchiveDirectory.make(root),
    ),
    contents: () => {
      try {
        return Object.fromEntries(walk(root, ""));
      } catch {
        return {};
      }
    },
    put: (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    },
    goAway: () => rmSync(root, { recursive: true }),
  };
};

const inMemory = (): Subject => {
  const held = InMemoryArchiveDirectory.InMemoryArchiveDirectory.of({
    files: new Map(),
    directories: new Set(),
    ops: [],
    present: true,
    fails: () => false,
  });
  return {
    layer: Layer.succeed(ArchiveDirectory, InMemoryArchiveDirectory.make(held)),
    contents: () =>
      held.present
        ? Object.fromEntries([
            ...[...held.directories].map((day) => [`${day}/`, ""]),
            ...[...held.files].map(([path, bytes]) => [
              path,
              new TextDecoder().decode(bytes),
            ]),
          ])
        : {},
    put: (path, text) => {
      const [first, ...rest] = path.split("/");
      if (first !== undefined && rest.length > 0) held.directories.add(first);
      held.files.set(path, new TextEncoder().encode(text));
    },
    goAway: () => {
      held.present = false;
    },
  };
};

const day = Archive.Day.make("2026-11-10");
const sha256Of = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const bytesOf = (...chunks: ReadonlyArray<string>) =>
  Stream.fromArray(chunks.map((chunk) => new TextEncoder().encode(chunk)));

const source: Archive.Source = {
  version: "26.8.36.3",
  database: "cota",
  tables: {
    items: { columns: [], create: "" },
    request_items: { columns: [], create: "" },
    requests: { columns: [], create: "" },
    session_titles: { columns: [], create: "" },
  },
};

/** A manifest of the day naming a file for each table given, by its text. */
const manifestOf = (files: Partial<Record<Archive.Table, string>>) =>
  Archive.manifestOf(day, DateTime.makeUnsafe("2026-11-11T01:00:00Z"), source, {
    items: archivedOf(files.items),
    request_items: archivedOf(files.request_items),
    requests: archivedOf(files.requests),
    session_titles: archivedOf(files.session_titles),
  });

const archivedOf = (text: string | undefined): Archive.Archived =>
  text === undefined
    ? { file: Option.none(), measure: Archive.nothingLoaded }
    : {
        file: Option.some({ bytes: text.length, sha256: sha256Of(text) }),
        measure: { rows: 1, checksum: "1", fingerprint: "1" },
      };

const named = (table: Archive.Table, text: string) =>
  `${day}/${Archive.fileName(table, sha256Of(text))}`;

const collected = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) =>
      chunks.map((chunk) => new TextDecoder().decode(chunk)).join(""),
    ),
  );

for (const [where, subjectOf] of [
  ["on the file system", onDisk],
  ["in memory", inMemory],
] as const) {
  describe(`the archive directory ${where}`, () => {
    const withSubject = (
      test: (
        subject: Subject,
      ) => Effect.Effect<void, unknown, ArchiveDirectory>,
    ) =>
      Effect.suspend(() => {
        const subject = subjectOf();
        return test(subject).pipe(Effect.provide(subject.layer));
      });

    it.effect(
      "writes a table's file to its partial name as its bytes arrive, making the day's directory, and gives its size and SHA-256",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const written = yield* (yield* ArchiveDirectory).write(
              day,
              "items",
              bytesOf('{"a":1}\n', '{"a":2}\n'),
            );
            expect([written, subject.contents()]).toEqual([
              Option.some({
                bytes: 16,
                sha256: sha256Of('{"a":1}\n{"a":2}\n'),
              }),
              {
                "2026-11-10/": "",
                "2026-11-10/items.jsonl.zst.partial": '{"a":1}\n{"a":2}\n',
              },
            ]);
          }),
        ),
    );

    it.effect("leaves no file for a table whose bytes never come", () =>
      withSubject((subject) =>
        Effect.gen(function* () {
          const written = yield* (yield* ArchiveDirectory).write(
            day,
            "requests",
            Stream.empty,
          );
          expect([written, subject.contents()]).toEqual([
            Option.none(),
            { "2026-11-10/": "" },
          ]);
        }),
      ),
    );

    it.effect(
      "fails when the bytes break off, leaving what came under the partial name",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const error = yield* (yield* ArchiveDirectory)
              .write(
                day,
                "items",
                Stream.concat(bytesOf('{"a":1}\n'), Stream.fail("cut")),
              )
              .pipe(Effect.flip);
            expect([error, subject.contents()]).toEqual([
              "cut",
              {
                "2026-11-10/": "",
                "2026-11-10/items.jsonl.zst.partial": '{"a":1}\n',
              },
            ]);
          }),
        ),
    );

    it.effect(
      "commits a day: names its files, puts its manifest in place, and removes the files of the manifest it replaces that the new one does not name",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const archive = yield* ArchiveDirectory;
            yield* archive.write(day, "items", bytesOf("items 1"));
            yield* archive.write(day, "requests", bytesOf("requests 1"));
            const first = manifestOf({
              items: "items 1",
              requests: "requests 1",
            });
            yield* archive.commit(first, Option.none());
            const before = subject.contents();
            yield* archive.write(day, "items", bytesOf("items 2"));
            yield* archive.write(day, "requests", bytesOf("requests 1"));
            const second = manifestOf({
              items: "items 2",
              requests: "requests 1",
            });
            yield* archive.commit(second, Option.some(first));
            expect([before, subject.contents()]).toEqual([
              {
                "2026-11-10/": "",
                [named("items", "items 1")]: "items 1",
                [named("requests", "requests 1")]: "requests 1",
                "2026-11-10/manifest.json": Archive.textOf(first),
              },
              {
                "2026-11-10/": "",
                [named("items", "items 2")]: "items 2",
                [named("requests", "requests 1")]: "requests 1",
                "2026-11-10/manifest.json": Archive.textOf(second),
              },
            ]);
          }),
        ),
    );

    it.effect(
      "fails to commit a day whose file was never written, and leaves its earlier manifest in force",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const archive = yield* ArchiveDirectory;
            subject.put("2026-11-10/manifest.json", "the earlier manifest");
            const error = yield* archive
              .commit(manifestOf({ items: "items 1" }), Option.none())
              .pipe(Effect.flip);
            expect([error._tag, subject.contents()]).toEqual([
              "ArchiveDirectoryFailed",
              {
                "2026-11-10/": "",
                "2026-11-10/manifest.json": "the earlier manifest",
              },
            ]);
          }),
        ),
    );

    it.effect(
      "reads every day's manifest, finds one that cannot be read or a day that is not a directory, and passes over a day without one and anything not named as a day",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const manifest = manifestOf({ items: "items 1" });
            subject.put("2026-11-10/manifest.json", Archive.textOf(manifest));
            subject.put("2026-11-11/manifest.json", "{ not json");
            subject.put("2026-11-12/items.jsonl.zst.partial", "partial");
            subject.put("notes/manifest.json", Archive.textOf(manifest));
            subject.put("2026-11-13", Archive.textOf(manifest));
            const manifests = yield* (yield* ArchiveDirectory).manifests;
            expect([...manifests].sort()).toEqual([
              ["2026-11-10", { _tag: "Readable", manifest }],
              ["2026-11-11", { _tag: "Unreadable", why: "it is not JSON" }],
              [
                "2026-11-13",
                { _tag: "Unreadable", why: "it is not a directory" },
              ],
            ]);
          }),
        ),
    );

    it.effect(
      "never writes, commits or discards through a day that is not a directory, and sweeps past it",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const archive = yield* ArchiveDirectory;
            subject.put(day, "not a day's directory");
            const failures = [
              yield* Effect.flip(archive.write(day, "items", bytesOf("x"))),
              yield* Effect.flip(archive.commit(manifestOf({}), Option.none())),
            ];
            yield* archive.discard(day);
            yield* archive.sweep;
            expect([
              failures.map(({ _tag }) => _tag),
              subject.contents(),
            ]).toEqual([
              ["ArchiveDirectoryFailed", "ArchiveDirectoryFailed"],
              { [day]: "not a day's directory" },
            ]);
          }),
        ),
    );

    it.effect(
      "sweeps the partial files of every day's directory, and nothing else",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            subject.put("2026-11-10/items.jsonl.zst.partial", "partial");
            subject.put("2026-11-10/manifest.json.partial", "partial");
            subject.put("2026-11-10/manifest.json", "manifest");
            subject.put(named("items", "orphan"), "orphan");
            subject.put("2026-11-11/requests.jsonl.zst.partial", "partial");
            subject.put("notes/items.jsonl.zst.partial", "the owner's");
            subject.put("loose.partial", "the owner's");
            yield* (yield* ArchiveDirectory).sweep;
            expect(subject.contents()).toEqual({
              "2026-11-10/": "",
              "2026-11-10/manifest.json": "manifest",
              [named("items", "orphan")]: "orphan",
              "2026-11-11/": "",
              "notes/": "",
              "notes/items.jsonl.zst.partial": "the owner's",
              "loose.partial": "the owner's",
            });
          }),
        ),
    );

    it.effect(
      "sweeps and discards past a directory named as a partial file, and leaves it",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const archive = yield* ArchiveDirectory;
            subject.put("2026-11-10/items.jsonl.zst.partial", "partial");
            subject.put("2026-11-10/copied.partial/x.partial", "the owner's");
            yield* archive.sweep;
            yield* archive.discard(day);
            expect(
              Object.entries(subject.contents()).filter(
                ([path]) => !path.endsWith("/"),
              ),
            ).toEqual([["2026-11-10/copied.partial/x.partial", "the owner's"]]);
          }),
        ),
    );

    it.effect("discards the partial files of one day only", () =>
      withSubject((subject) =>
        Effect.gen(function* () {
          subject.put("2026-11-10/items.jsonl.zst.partial", "partial");
          subject.put("2026-11-10/manifest.json", "manifest");
          subject.put("2026-11-11/items.jsonl.zst.partial", "partial");
          yield* (yield* ArchiveDirectory).discard(day);
          yield* (yield* ArchiveDirectory).discard(
            Archive.Day.make("2026-11-12"),
          );
          expect(subject.contents()).toEqual({
            "2026-11-10/": "",
            "2026-11-10/manifest.json": "manifest",
            "2026-11-11/": "",
            "2026-11-11/items.jsonl.zst.partial": "partial",
          });
        }),
      ),
    );

    it.effect(
      "reads and measures a file of a day, measures a missing one as none, and fails to read it",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const archive = yield* ArchiveDirectory;
            subject.put(named("items", "items 1"), "items 1");
            const name = Archive.fileName("items", sha256Of("items 1"));
            expect([
              yield* collected(archive.read(day, name)),
              yield* archive.measure(day, name),
              yield* archive.measure(day, "requests.jsonl.zst"),
              (yield* Effect.flip(
                collected(archive.read(day, "requests.jsonl.zst")),
              ))._tag,
            ]).toEqual([
              "items 1",
              Option.some({ bytes: 7, sha256: sha256Of("items 1") }),
              Option.none(),
              "ArchiveDirectoryFailed",
            ]);
          }),
        ),
    );

    it.effect(
      "fails every call once the directory has gone, and makes nothing",
      () =>
        withSubject((subject) =>
          Effect.gen(function* () {
            const archive = yield* ArchiveDirectory;
            subject.goAway();
            const failures = [
              yield* Effect.flip(archive.manifests),
              yield* Effect.flip(archive.sweep),
              yield* Effect.flip(archive.write(day, "items", bytesOf("x"))),
            ];
            expect([
              failures.map(({ _tag }) => _tag),
              subject.contents(),
            ]).toEqual([
              [
                "ArchiveDirectoryFailed",
                "ArchiveDirectoryFailed",
                "ArchiveDirectoryFailed",
              ],
              {},
            ]);
          }),
        ),
    );
  });
}

describe("the archive directory on the file system", () => {
  it.effect(
    "makes a day's directory with mode 0700 and every file with mode 0600",
    () =>
      Effect.gen(function* () {
        const root = mkdtempSync(join(scratch, "modes-"));
        const archive = FileSystemArchiveDirectory.make(root);
        yield* archive.write(day, "items", bytesOf("items 1"));
        const partial = statSync(
          join(root, day, Archive.partialName("items")),
        ).mode;
        yield* archive.commit(manifestOf({ items: "items 1" }), Option.none());
        expect(
          [
            statSync(join(root, day)).mode,
            partial,
            statSync(join(root, named("items", "items 1"))).mode,
            statSync(join(root, day, Archive.manifestName)).mode,
          ].map((mode) => (mode & 0o777).toString(8)),
        ).toEqual(["700", "600", "600", "600"]);
      }),
  );

  it.effect(
    "takes a day that is a symbolic link to a directory for one whose manifest cannot be read, and writes, commits and removes nothing through it",
    () =>
      Effect.gen(function* () {
        const root = mkdtempSync(join(scratch, "linked-"));
        const elsewhere = mkdtempSync(join(scratch, "elsewhere-"));
        const manifest = Archive.textOf(manifestOf({ items: "items 1" }));
        writeFileSync(join(elsewhere, Archive.manifestName), manifest);
        writeFileSync(join(elsewhere, Archive.partialName("items")), "partial");
        symlinkSync(elsewhere, join(root, day));
        const archive = FileSystemArchiveDirectory.make(root);
        const manifests = yield* archive.manifests;
        const failures = [
          yield* Effect.flip(archive.write(day, "requests", bytesOf("late"))),
          yield* Effect.flip(archive.commit(manifestOf({}), Option.none())),
        ];
        yield* archive.discard(day);
        yield* archive.sweep;
        expect([
          [...manifests],
          failures.map(({ _tag }) => _tag),
          readdirSync(elsewhere).sort(),
          readFileSync(join(elsewhere, Archive.manifestName), "utf8"),
        ]).toEqual([
          [[day, { _tag: "Unreadable", why: "it is not a directory" }]],
          ["ArchiveDirectoryFailed", "ArchiveDirectoryFailed"],
          [Archive.partialName("items"), Archive.manifestName].sort(),
          manifest,
        ]);
      }),
  );

  it.effect(
    "refuses a directory that does not exist, is not a directory, or that the hub cannot write",
    () =>
      Effect.gen(function* () {
        const missing = join(scratch, "missing");
        const file = join(scratch, "a-file");
        writeFileSync(file, "");
        const locked = mkdtempSync(join(scratch, "locked-"));
        chmodSync(locked, 0o500);
        const refusals = [];
        for (const path of [missing, file, locked]) {
          refusals.push(
            yield* FileSystemArchiveDirectory.check(path).pipe(
              Effect.flip,
              Effect.map((error) => error.message),
            ),
          );
        }
        chmodSync(locked, 0o700);
        expect(refusals).toEqual([
          `The archive directory ${missing} does not exist.`,
          `The archive directory ${file} is not a directory.`,
          `The archive directory ${locked} cannot be written by the hub.`,
        ]);
      }),
  );
});
