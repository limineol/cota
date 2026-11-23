import { createHash, randomUUID } from "node:crypto";
import { link, readFile, rm, writeFile } from "node:fs/promises";
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

/** This run's lock text: its process id, and a token no other run holds. */
const owned = `${process.pid} ${randomUUID()}\n`;

const textAt = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (codeOf(cause) === "ENOENT") return undefined;
    throw cause;
  }
};

/**
 * Makes `path` hold this run's lock text, unless it exists: the text is
 * written to a file of its own and linked to `path`, so that the lock never
 * appears without its owner.
 */
const create = async (path: string) => {
  const written = `${path}.${randomUUID()}.new`;
  await writeFile(written, owned, { mode: 0o600, flag: "wx" });
  try {
    await link(written, path);
    return true;
  } catch (cause) {
    if (codeOf(cause) === "EEXIST") return false;
    throw cause;
  } finally {
    await rm(written, { force: true });
  }
};

/**
 * Takes `path` for this run: creates it, or takes it over when the process
 * it names is gone. A takeover first takes a lock named after the dead lock's
 * text, so that of the runs that saw the same dead owner only one removes
 * its lock, and none removes a lock another run made since.
 */
const claim = async (path: string): Promise<boolean> => {
  for (;;) {
    if (await create(path)) return true;
    const text = await textAt(path);
    if (text === undefined) continue;
    const pid = Number(text.trim().split(/\s+/)[0]);
    if (Number.isSafeInteger(pid) && pid > 0 && isAlive(pid)) return false;
    const digest = createHash("sha256").update(text).digest("hex");
    const taking = `${path}.taking-${digest.slice(0, 32)}`;
    if (!(await claim(taking))) return false;
    try {
      if ((await textAt(path)) === text) await rm(path, { force: true });
      return await create(path);
    } finally {
      await rm(taking, { force: true });
    }
  }
};

/** A lock file made whole or not at all, holding this process's id: a dead process's lock is taken over by one run only, and a run removes only its own. */
export const layer: Layer.Layer<RunLock> = Layer.succeed(
  RunLock,
  RunLock.of({
    take: (path) =>
      Effect.tryPromise({
        try: () => claim(path),
        catch: (cause) =>
          new FilesFailed({ path, reason: codeOf(cause) ?? "it failed" }),
      }),
    release: (path) =>
      Effect.tryPromise(async () => {
        if ((await textAt(path)) === owned) await rm(path, { force: true });
      }).pipe(Effect.ignore),
  }),
);
