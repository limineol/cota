import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { Effect, Layer, Option } from "effect";
import { Files, FilesFailed } from "#02-application/interfaces/files.ts";

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;

const reasonOf = (cause: unknown): string => {
  switch (codeOf(cause)) {
    case "EACCES":
    case "EPERM":
      return "permission denied";
    case "ENOTDIR":
      return "a part of its path is a file";
    case "EISDIR":
      return "it is a directory";
    case "ENOSPC":
      return "the disk is full";
    case "EROFS":
      return "its file system is read-only";
    default:
      return codeOf(cause) ?? "it failed";
  }
};

const attempt = <A>(path: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new FilesFailed({ path, reason: reasonOf(cause) }),
  });

const missing = <A>(path: string, run: () => Promise<A>, none: A) =>
  attempt(path, () =>
    run().catch((cause: unknown) => {
      if (codeOf(cause) === "ENOENT") return none;
      throw cause;
    }),
  );

/** The machine's files on its own file system, through Node's API as Bun gives it. */
export const layer: Layer.Layer<Files> = Layer.succeed(
  Files,
  Files.of({
    read: (path) =>
      missing(
        path,
        async () => Option.some(await readFile(path, "utf8")),
        Option.none(),
      ),
    write: (path, text, mode) =>
      attempt(path, async () => {
        const beside = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(beside, text, { mode, flag: "wx" });
          await chmod(beside, mode);
          await rename(beside, path);
        } catch (cause) {
          await unlink(beside).catch(() => undefined);
          throw cause;
        }
      }),
    makeDirectory: (path, mode) =>
      attempt(path, async () => {
        await mkdir(path, { recursive: true, mode });
        await chmod(path, mode);
      }),
    list: (path) => missing(path, () => readdir(path), []),
    remove: (path) =>
      missing(
        path,
        async () => {
          await stat(path);
          await rm(path, { recursive: true, force: true });
          return true;
        },
        false,
      ),
    executable: (path) =>
      Effect.promise(async () => {
        try {
          if (!(await stat(path)).isFile()) return false;
          await access(path, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
    isLink: (path) =>
      Effect.promise(() =>
        lstat(path).then(
          (stats) => stats.isSymbolicLink(),
          () => false,
        ),
      ),
    head: (path, bytes) =>
      missing(
        path,
        async () => {
          const file = await open(path, "r");
          try {
            if (!(await file.stat()).isFile()) return Option.none();
            const buffer = Buffer.alloc(bytes);
            const { bytesRead } = await file.read(buffer, 0, bytes, 0);
            return Option.some(buffer.subarray(0, bytesRead).toString("utf8"));
          } finally {
            await file.close();
          }
        },
        Option.none(),
      ),
    modeOf: (path) =>
      missing(
        path,
        async () => Option.some((await stat(path)).mode & 0o7777),
        Option.none(),
      ),
  }),
);
