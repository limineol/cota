import { open, readFile, rm } from "node:fs/promises";
import { Effect, Layer } from "effect";
import { FilesFailed } from "#02-application/interfaces/files.ts";
import { RunLock } from "#02-application/interfaces/run-lock.ts";

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return codeOf(cause) === "EPERM";
  }
};

const create = async (path: string) => {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${process.pid}\n`);
  } finally {
    await handle.close();
  }
};

/** A lock file made exclusively, holding this process's id. */
export const layer: Layer.Layer<RunLock> = Layer.succeed(
  RunLock,
  RunLock.of({
    take: (path) =>
      Effect.tryPromise({
        try: async () => {
          try {
            await create(path);
            return true;
          } catch (cause) {
            if (codeOf(cause) !== "EEXIST") throw cause;
          }
          const pid = Number((await readFile(path, "utf8")).trim());
          if (Number.isSafeInteger(pid) && pid > 0 && isAlive(pid)) {
            return false;
          }
          await rm(path, { force: true });
          await create(path);
          return true;
        },
        catch: (cause) =>
          new FilesFailed({ path, reason: codeOf(cause) ?? "it failed" }),
      }),
    release: (path) =>
      Effect.tryPromise(() => rm(path, { force: true })).pipe(Effect.ignore),
  }),
);
