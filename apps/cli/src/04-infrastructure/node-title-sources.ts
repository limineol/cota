import { Database } from "bun:sqlite";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, Option } from "effect";
import { FilesFailed } from "#02-application/interfaces/files.ts";
import {
  type SourceFile,
  SourceUnreadable,
  TitleSources,
} from "#02-application/interfaces/title-sources.ts";

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;

const reasonOf = (cause: unknown): string => {
  switch (codeOf(cause)) {
    case "EACCES":
    case "EPERM":
      return "permission denied";
    case "EISDIR":
      return "it is a directory";
    default:
      return codeOf(cause) ?? "it failed";
  }
};

const isMissing = (cause: unknown) =>
  codeOf(cause) === "ENOENT" || codeOf(cause) === "ENOTDIR";

const orNone = <A>(path: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: async () => {
      try {
        return Option.some(await run());
      } catch (cause) {
        if (isMissing(cause)) return Option.none<A>();
        throw cause;
      }
    },
    catch: (cause) => new FilesFailed({ path, reason: reasonOf(cause) }),
  });

const fileAt = async (path: string): Promise<SourceFile> => {
  const facts = await stat(path);
  return { path, size: facts.size, changedAt: facts.mtimeMs };
};

/**
 * T3 Code's own database, which is not a public interface: an update of T3
 * Code can rename these tables (ADR-0022, Facts to confirm).
 */
const threadTitlesQuery = `SELECT json_extract(p.payload_json, '$.nativeThreadRef.nativeId') AS session, t.title AS title
  FROM orchestration_v2_projection_provider_threads AS p
  JOIN orchestration_v2_projection_threads AS t ON t.thread_id = p.thread_id
  WHERE t.deleted_at IS NULL`;

interface ThreadRow {
  readonly session: unknown;
  readonly title: unknown;
}

/** The clients' files through Node's API as Bun gives it, and T3 Code's database through `bun:sqlite`, opened read only. */
export const layer: Layer.Layer<TitleSources> = Layer.succeed(
  TitleSources,
  TitleSources.of({
    transcripts: (projects) =>
      Effect.map(
        orNone(projects, async () => {
          const found: Array<SourceFile> = [];
          for (const project of await readdir(projects, {
            withFileTypes: true,
          })) {
            if (!project.isDirectory()) continue;
            const directory = join(projects, project.name);
            const names = await readdir(directory).catch((cause: unknown) => {
              if (isMissing(cause)) return [];
              throw cause;
            });
            for (const name of names) {
              if (!name.endsWith(".jsonl")) continue;
              const file = await fileAt(join(directory, name)).catch(
                (cause: unknown) => {
                  if (isMissing(cause)) return undefined;
                  throw cause;
                },
              );
              if (file !== undefined) found.push(file);
            }
          }
          return found;
        }),
        (found) => Option.getOrElse(found, () => []),
      ),
    file: (path) => orNone(path, () => fileAt(path)),
    bytesFrom: (path, offset) =>
      orNone(path, async () => {
        const file = await open(path, "r");
        try {
          const { size } = await file.stat();
          const length = Math.max(size - offset, 0);
          const bytes = new Uint8Array(length);
          let read = 0;
          while (read < length) {
            const { bytesRead } = await file.read(
              bytes,
              read,
              length - read,
              offset + read,
            );
            if (bytesRead === 0) break;
            read += bytesRead;
          }
          return bytes.subarray(0, read);
        } finally {
          await file.close();
        }
      }),
    threadTitles: (database) =>
      Effect.gen(function* () {
        const exists = yield* Effect.promise(() =>
          stat(database).then(
            () => true,
            () => false,
          ),
        );
        if (!exists) return Option.none();
        const rows = yield* Effect.try({
          try: () => {
            const db = new Database(database, { readonly: true });
            try {
              db.run("PRAGMA busy_timeout = 5000");
              return db.query<ThreadRow, []>(threadTitlesQuery).all();
            } finally {
              db.close();
            }
          },
          catch: (cause) =>
            new SourceUnreadable({
              source: database,
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        return Option.some(
          rows.flatMap(({ session, title }) =>
            typeof session === "string" &&
            session !== "" &&
            typeof title === "string"
              ? [[session, title] as const]
              : [],
          ),
        );
      }),
  }),
);
