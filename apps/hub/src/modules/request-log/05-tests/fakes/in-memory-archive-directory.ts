import { createHash } from "node:crypto";
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import {
  ArchiveDirectory,
  ArchiveDirectoryFailed,
} from "#modules/request-log/02-application/interfaces/archive-directory.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";

/** What a call did to the directory: a day's directory made, a file opened for writing, renamed or removed, by its path under the directory. */
export type Op =
  | { readonly op: "make"; readonly path: string }
  | { readonly op: "write"; readonly path: string }
  | { readonly op: "rename"; readonly path: string; readonly to: string }
  | { readonly op: "remove"; readonly path: string };

/** The directory's files by their path (`<day>/<name>`), its day directories, every operation tried in order, and when operations fail. */
export class InMemoryArchiveDirectory extends Context.Service<
  InMemoryArchiveDirectory,
  {
    readonly files: Map<string, Uint8Array>;
    readonly directories: Set<string>;
    readonly ops: Array<Op>;
    /** Whether the directory itself is there; every call fails when it is not. */
    present: boolean;
    /** Whether an operation fails, as on a full disk, given it and how many were tried before it. */
    fails: (op: Op, index: number) => boolean;
  }
>()("@cota/hub/request-log/InMemoryArchiveDirectory") {}

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const both = new Uint8Array(left.length + right.length);
  both.set(left);
  both.set(right, left.length);
  return both;
};

const writtenOf = (bytes: Uint8Array): Archive.Written => ({
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

export const make = (held: InMemoryArchiveDirectory["Service"]) => {
  const failed = (detail: string) => new ArchiveDirectoryFailed({ detail });
  const gone = () =>
    held.present
      ? Effect.void
      : Effect.fail(failed("ENOENT: the archive directory is gone"));
  const attempt = (op: Op) =>
    Effect.suspend(() => {
      const index = held.ops.length;
      held.ops.push(op);
      if (!held.present) return gone();
      return held.fails(op, index)
        ? Effect.fail(failed(`${op.op} ${op.path} failed`))
        : Effect.void;
    });
  const pathOf = (day: Archive.Day, name: string) => `${day}/${name}`;
  const days = Effect.suspend(gone).pipe(
    Effect.map(() =>
      [...held.directories].filter((name) => Schema.is(Archive.Day)(name)),
    ),
  );
  const remove = (path: string) =>
    Effect.gen(function* () {
      yield* attempt({ op: "remove", path });
      held.files.delete(path);
    });
  const rename = (path: string, to: string) =>
    Effect.gen(function* () {
      yield* attempt({ op: "rename", path, to });
      const bytes = held.files.get(path);
      if (bytes === undefined) {
        return yield* failed(`ENOENT: no such file ${path}`);
      }
      held.files.delete(path);
      held.files.set(to, bytes);
    });
  const notADirectory = (day: string) => held.files.has(day);
  const dayDirectoryOf = (day: string) =>
    notADirectory(day)
      ? Effect.fail(failed(`${day} is not a directory`))
      : Effect.void;
  const discard = (day: string) =>
    Effect.gen(function* () {
      yield* gone();
      if (notADirectory(day)) return;
      for (const path of [...held.files.keys()]) {
        const name = path.slice(`${day}/`.length);
        if (
          path.startsWith(`${day}/`) &&
          !name.includes("/") &&
          name.endsWith(".partial")
        ) {
          yield* remove(path);
        }
      }
    });

  return ArchiveDirectory.of({
    manifests: Effect.gen(function* () {
      const manifests = new Map<Archive.Day, Archive.Reading>();
      const listed = yield* days;
      for (const name of held.files.keys()) {
        if (Schema.is(Archive.Day)(name)) {
          manifests.set(name, {
            _tag: "Unreadable",
            why: "it is not a directory",
          });
        }
      }
      for (const day of listed) {
        const bytes = held.files.get(`${day}/${Archive.manifestName}`);
        if (bytes === undefined) continue;
        const valid = Archive.Day.make(day);
        manifests.set(
          valid,
          Archive.readManifest(valid, new TextDecoder().decode(bytes)),
        );
      }
      return manifests;
    }),

    write: (day, table, bytes) =>
      Effect.gen(function* () {
        yield* dayDirectoryOf(day);
        if (!held.directories.has(day)) {
          yield* attempt({ op: "make", path: day });
          held.directories.add(day);
        }
        const path = pathOf(day, Archive.partialName(table));
        yield* attempt({ op: "write", path });
        held.files.set(path, new Uint8Array());
        yield* Stream.runForEach(bytes, (chunk) =>
          Effect.sync(() => {
            held.files.set(
              path,
              concat(held.files.get(path) ?? new Uint8Array(), chunk),
            );
          }),
        );
        const written = writtenOf(held.files.get(path) ?? new Uint8Array());
        if (written.bytes > 0) return Option.some(written);
        yield* remove(path);
        return Option.none();
      }),

    read: (day, name) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* gone();
          const bytes = held.files.get(pathOf(day, name));
          if (bytes === undefined) {
            return yield* failed(`ENOENT: no such file ${pathOf(day, name)}`);
          }
          const half = Math.ceil(bytes.length / 2);
          return Stream.fromArray(
            [bytes.slice(0, half), bytes.slice(half)].filter(
              (chunk) => chunk.length > 0,
            ),
          );
        }),
      ),

    measure: (day, name) =>
      Effect.gen(function* () {
        yield* gone();
        return Option.map(
          Option.fromUndefinedOr(held.files.get(pathOf(day, name))),
          writtenOf,
        );
      }),

    commit: (manifest, replacing) =>
      Effect.gen(function* () {
        const day = manifest.day;
        yield* dayDirectoryOf(day);
        for (const { table, file } of manifest.tables) {
          if (file === null) continue;
          yield* rename(
            pathOf(day, Archive.partialName(table)),
            pathOf(day, file),
          );
        }
        const partial = pathOf(day, Archive.manifestPartialName);
        yield* attempt({ op: "write", path: partial });
        held.files.set(
          partial,
          new TextEncoder().encode(Archive.textOf(manifest)),
        );
        yield* rename(partial, pathOf(day, Archive.manifestName));
        const named = new Set(manifest.tables.map(({ file }) => file));
        for (const { file } of Option.match(replacing, {
          onNone: () => [],
          onSome: ({ tables }) => tables,
        })) {
          if (file === null || named.has(file)) continue;
          if (held.files.has(pathOf(day, file))) {
            yield* remove(pathOf(day, file));
          }
        }
      }),

    discard,

    sweep: Effect.gen(function* () {
      for (const day of yield* days) yield* discard(day);
    }),
  });
};

/** An archive directory in memory, and the memory, for tests to look into and break. */
export const layer: Layer.Layer<ArchiveDirectory | InMemoryArchiveDirectory> =
  Layer.effectContext(
    Effect.sync(() => {
      const held = InMemoryArchiveDirectory.of({
        files: new Map(),
        directories: new Set(),
        ops: [],
        present: true,
        fails: () => false,
      });
      return Context.make(InMemoryArchiveDirectory, held).pipe(
        Context.add(ArchiveDirectory, make(held)),
      );
    }),
  );
