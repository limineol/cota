import { createHash } from "node:crypto";
import { accessSync, constants, createReadStream, statSync } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, Option, Result, Schema, Stream } from "effect";
import {
  ArchiveDirectory,
  ArchiveDirectoryFailed,
} from "#modules/request-log/02-application/interfaces/archive-directory.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";

/** Why the hub does not start with its archive directory; it prints this and exits 1. */
export class ArchiveDirectoryRefused extends Schema.TaggedError<
  ArchiveDirectoryRefused,
  { readonly brand: unique symbol }
>()("ArchiveDirectoryRefused", {
  path: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `The archive directory ${this.path} ${this.problem}.`;
  }
}

const codeOf = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;

const failed = (cause: unknown) =>
  new ArchiveDirectoryFailed({
    detail: cause instanceof Error ? cause.message : String(cause),
  });

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: failed });

/** Refuses a directory that does not exist, is not a directory, or that the hub cannot write. */
export const check = Effect.fn("FileSystemArchiveDirectory.check")(function* (
  directory: string,
) {
  const refused = (problem: string) =>
    new ArchiveDirectoryRefused({ path: directory, problem });
  const stats = yield* Effect.try({
    try: () => statSync(directory),
    catch: (cause) =>
      refused(
        codeOf(cause) === "ENOENT" || codeOf(cause) === "ENOTDIR"
          ? "does not exist"
          : "cannot be written by the hub",
      ),
  });
  if (!stats.isDirectory()) return yield* refused("is not a directory");
  yield* Effect.try({
    try: () => accessSync(directory, constants.W_OK | constants.X_OK),
    catch: () => refused("cannot be written by the hub"),
  });
});

const writeAll = async (handle: FileHandle, chunk: Uint8Array) => {
  for (let offset = 0; offset < chunk.length; ) {
    offset += (await handle.write(chunk, offset)).bytesWritten;
  }
};

const syncDirectory = async (path: string) => {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const missingIsNone = <A>(run: () => Promise<A>) =>
  attempt(async () => {
    try {
      return Option.some(await run());
    } catch (cause) {
      if (codeOf(cause) === "ENOENT") return Option.none<A>();
      throw cause;
    }
  });

/** The archive directory at `directory`, which must exist: each day's directory is made with mode 0700, and each file with mode 0600, flushed to the disk before it is renamed. */
export const make = (directory: string): ArchiveDirectory["Service"] => {
  const dayDirectory = (day: Archive.Day) => join(directory, day);
  const pathOf = (day: Archive.Day, name: string) => join(directory, day, name);

  const entries = attempt(() =>
    readdir(directory, { withFileTypes: true }),
  ).pipe(
    Effect.map((all) =>
      all.flatMap((entry) =>
        Schema.is(Archive.Day)(entry.name)
          ? [{ day: entry.name, isDirectory: entry.isDirectory() }]
          : [],
      ),
    ),
  );

  const days = entries.pipe(
    Effect.map((all) =>
      all.flatMap(({ day, isDirectory }) => (isDirectory ? [day] : [])),
    ),
  );

  const isDayDirectory = (day: Archive.Day) =>
    missingIsNone(() => lstat(dayDirectory(day))).pipe(
      Effect.map(Option.exists((stats) => stats.isDirectory())),
    );

  const dayDirectoryOf = Effect.fn("FileSystemArchiveDirectory.dayDirectory")(
    function* (day: Archive.Day) {
      if (yield* isDayDirectory(day)) return;
      return yield* new ArchiveDirectoryFailed({
        detail: `${dayDirectory(day)} is not a directory`,
      });
    },
  );

  const discard = Effect.fn("FileSystemArchiveDirectory.discard")(function* (
    day: Archive.Day,
  ) {
    if (!(yield* isDayDirectory(day))) return;
    const entries = yield* missingIsNone(() =>
      readdir(dayDirectory(day), { withFileTypes: true }),
    );
    for (const entry of Option.getOrElse(entries, () => [])) {
      if (!(entry.isFile() && entry.name.endsWith(".partial"))) continue;
      yield* attempt(() => rm(pathOf(day, entry.name), { force: true }));
    }
  });

  const hashOf = async (path: string): Promise<Archive.Written> => {
    await stat(path);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of Bun.file(path).stream()) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    return { bytes, sha256: hash.digest("hex") };
  };

  const writeSynced = async (path: string, text: string) => {
    await rm(path, { force: true });
    const handle = await open(path, "wx", 0o600);
    try {
      await writeAll(handle, new TextEncoder().encode(text));
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  return ArchiveDirectory.of({
    manifests: Effect.gen(function* () {
      const manifests = new Map<Archive.Day, Archive.Reading>();
      for (const { day, isDirectory } of yield* entries) {
        if (!isDirectory) {
          manifests.set(day, {
            _tag: "Unreadable",
            why: "it is not a directory",
          });
          continue;
        }
        const text = yield* Effect.result(
          missingIsNone(() =>
            readFile(pathOf(day, Archive.manifestName), "utf8"),
          ),
        );
        if (Result.isFailure(text)) {
          manifests.set(day, {
            _tag: "Unreadable",
            why: `it cannot be read: ${text.failure.detail}`,
          });
        } else if (Option.isSome(text.success)) {
          manifests.set(day, Archive.readManifest(day, text.success.value));
        }
      }
      return manifests;
    }),

    write: Effect.fn("FileSystemArchiveDirectory.write")(function* <E>(
      day: Archive.Day,
      table: Archive.Table,
      bytes: Stream.Stream<Uint8Array, E>,
    ) {
      yield* attempt(() =>
        mkdir(dayDirectory(day), { mode: 0o700 }).catch((cause) => {
          if (codeOf(cause) !== "EEXIST") throw cause;
        }),
      );
      yield* dayDirectoryOf(day);
      const path = pathOf(day, Archive.partialName(table));
      yield* attempt(() => rm(path, { force: true }));
      const written = yield* Effect.acquireUseRelease(
        attempt(() => open(path, "wx", 0o600)),
        (handle) =>
          Effect.gen(function* () {
            const hash = createHash("sha256");
            let size = 0;
            yield* Stream.runForEach(bytes, (chunk) => {
              hash.update(chunk);
              size += chunk.length;
              return attempt(() => writeAll(handle, chunk));
            });
            yield* attempt(() => handle.sync());
            return { bytes: size, sha256: hash.digest("hex") };
          }),
        (handle) => Effect.promise(() => handle.close().catch(() => undefined)),
      );
      if (written.bytes > 0) return Option.some(written);
      yield* attempt(() => rm(path, { force: true }));
      return Option.none();
    }),

    read: (day, name) =>
      Stream.fromAsyncIterable<Uint8Array, ArchiveDirectoryFailed>(
        createReadStream(pathOf(day, name)),
        failed,
      ),

    measure: (day, name) => missingIsNone(() => hashOf(pathOf(day, name))),

    commit: Effect.fn("FileSystemArchiveDirectory.commit")(function* (
      manifest: Archive.Manifest,
      replacing: Option.Option<Archive.Manifest>,
    ) {
      const day = manifest.day;
      yield* dayDirectoryOf(day);
      for (const { table, file } of manifest.tables) {
        if (file === null) continue;
        yield* attempt(() =>
          rename(pathOf(day, Archive.partialName(table)), pathOf(day, file)),
        );
      }
      yield* attempt(() => syncDirectory(dayDirectory(day)));
      const partial = pathOf(day, Archive.manifestPartialName);
      yield* attempt(() => writeSynced(partial, Archive.textOf(manifest)));
      yield* attempt(() => rename(partial, pathOf(day, Archive.manifestName)));
      yield* attempt(() => syncDirectory(dayDirectory(day)));
      const named = new Set(manifest.tables.map(({ file }) => file));
      for (const { file } of Option.match(replacing, {
        onNone: () => [],
        onSome: ({ tables }) => tables,
      })) {
        if (file === null || named.has(file)) continue;
        yield* attempt(() => rm(pathOf(day, file), { force: true }));
      }
    }),

    discard,

    sweep: Effect.gen(function* () {
      for (const day of yield* days) yield* discard(day);
    }),
  });
};

/** The archive directory at `directory`, once the hub has checked it can use it. */
export const layer = (directory: string): Layer.Layer<ArchiveDirectory> =>
  Layer.succeed(ArchiveDirectory, make(directory));
