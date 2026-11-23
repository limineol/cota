import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import { join, sep } from "node:path";
import { Effect, Layer, Option } from "effect";
import {
  ClientRecords,
  type Copied,
  type Listed,
} from "#02-application/interfaces/client-records.ts";
import { FilesFailed } from "#02-application/interfaces/files.ts";
import {
  type ClientRecord,
  type RecordStep,
  record,
} from "#03-domain/antigravity-record.ts";
import { type Stamps, sameStamps } from "#03-domain/requests.ts";

/** A file's kind, size and modification time, as `lstat` gives them. */
export interface Status {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isLink: boolean;
  readonly size: number;
  readonly changedAt: number;
}

/** What the reader does to the disk: every file of a data folder it touches goes through these, so that a test can watch them. */
export interface Disk {
  readonly status: (path: string) => Promise<Status>;
  readonly names: (directory: string) => Promise<ReadonlyArray<string>>;
  readonly realPath: (path: string) => Promise<string>;
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  readonly writeBytes: (path: string, bytes: Uint8Array) => Promise<void>;
  readonly makeScratch: (under: string) => Promise<string>;
  readonly removeScratch: (directory: string) => Promise<void>;
  readonly openDatabase: (path: string) => Database;
}

export const nodeDisk: Disk = {
  status: async (path) => {
    const status = await fs.lstat(path);
    return {
      isFile: status.isFile(),
      isDirectory: status.isDirectory(),
      isLink: status.isSymbolicLink(),
      size: status.size,
      changedAt: status.mtimeMs,
    };
  },
  names: (directory) => fs.readdir(directory),
  realPath: (path) => fs.realpath(path),
  readBytes: async (path) => new Uint8Array(await fs.readFile(path)),
  writeBytes: (path, bytes) => fs.writeFile(path, bytes, { mode: 0o600 }),
  makeScratch: async (under) => {
    await fs.mkdir(under, { recursive: true, mode: 0o700 });
    return fs.mkdtemp(join(under, "copy-"));
  },
  removeScratch: (directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  openDatabase: (path) => new Database(path),
};

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;

const isMissing = (cause: unknown) =>
  codeOf(cause) === "ENOENT" || codeOf(cause) === "ENOTDIR";

/** A path the reader will not read through: a linked `conversations` directory, or a file that leads out of it. */
class NotFollowed extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(reason);
  }
}

const reasonOf = (cause: unknown): string => {
  switch (codeOf(cause)) {
    case "EACCES":
    case "EPERM":
      return "permission denied";
    default:
      return codeOf(cause) ?? "it failed";
  }
};

/** The tables and columns the reader reads, each with its declared type (`docs/specs/request-reporter/spec.md`, What it reads). */
const expected: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  trajectory_meta: { trajectory_id: "text", cascade_id: "text" },
  steps: {
    idx: "integer",
    step_type: "integer",
    status: "integer",
    has_subtrajectory: "numeric",
    metadata: "blob",
    step_payload: "blob",
  },
  gen_metadata: { data: "blob" },
  parent_references: {},
};

type Value = string | number | bigint | boolean | Uint8Array | null;

const hasSchema = (db: Database): boolean =>
  Object.entries(expected).every(([table, columns]) => {
    const rows = db.query(`PRAGMA table_info(${table})`).values();
    if (rows.length === 0) return false;
    const declared = new Map(
      rows.map((row) => [String(row[1]), String(row[2]).toLowerCase()]),
    );
    return Object.entries(columns).every(
      ([column, type]) => declared.get(column) === type,
    );
  });

const columnOf = (value: Value): number | string | null =>
  typeof value === "number" || typeof value === "string" ? value : null;

const blobOf = (value: Value): Uint8Array | null =>
  value instanceof Uint8Array ? value : null;

const stepOf = (row: ReadonlyArray<Value>): Option.Option<RecordStep> => {
  const [idx, stepType, status, sub, metadata, payload] = row;
  if (typeof idx !== "number" || !Number.isSafeInteger(idx)) {
    return Option.none();
  }
  return Option.some({
    idx,
    stepType: columnOf(stepType ?? null),
    status: columnOf(status ?? null),
    hasSubtrajectory:
      sub !== null &&
      sub !== undefined &&
      sub !== 0 &&
      sub !== "0" &&
      sub !== false &&
      sub !== 0n,
    metadata: blobOf(metadata ?? null),
    payload: blobOf(payload ?? null),
  });
};

const stepColumns =
  "idx, step_type, status, has_subtrajectory, metadata, step_payload";

/** The record of a copied database, or nothing when its schema is not the one read. */
const recordOf = (
  db: Database,
  conversation: string,
  after: number,
): Option.Option<ClientRecord> => {
  if (!hasSchema(db)) return Option.none();
  const meta = db
    .query("SELECT trajectory_id, cascade_id FROM trajectory_meta LIMIT 2")
    .values();
  const [first] = meta;
  if (meta.length !== 1 || first === undefined) return Option.none();
  const [trajectory, cascade] = first;
  if (typeof trajectory !== "string" || typeof cascade !== "string") {
    return Option.none();
  }
  const steps: Array<RecordStep> = [];
  for (const row of db
    .query(`SELECT ${stepColumns} FROM steps WHERE idx > ? ORDER BY idx`)
    .values(after)) {
    const step = stepOf(row);
    if (Option.isNone(step)) return Option.none();
    steps.push(step.value);
  }
  const greatest = db.query("SELECT MAX(idx) FROM steps").values()[0]?.[0];
  const lastUser = db
    .query(
      `SELECT ${stepColumns} FROM steps WHERE step_type = ? AND idx <= ? ORDER BY idx DESC LIMIT 1`,
    )
    .values(record.userMessage, after)[0];
  return Option.some({
    conversation,
    trajectory,
    cascade,
    subAgent:
      db.query("SELECT 1 FROM parent_references LIMIT 1").values().length > 0,
    greatestStep:
      typeof greatest === "number" ? Option.some(greatest) : Option.none(),
    steps,
    lastUserMessage: lastUser === undefined ? Option.none() : stepOf(lastUser),
    generations: db
      .query("SELECT data FROM gen_metadata")
      .values()
      .map((row) => blobOf(row[0] ?? null)),
  });
};

/** How many times a conversation whose files change while copied is copied again within one run. */
const copies = 2;

/** The client records through `bun:sqlite`, over a disk: Node's, or one a test watches. */
export const layerOf = (disk: Disk): Layer.Layer<ClientRecords> => {
  const attempt = <A>(path: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        cause instanceof NotFollowed
          ? new FilesFailed({ path: cause.path, reason: cause.reason })
          : new FilesFailed({ path, reason: reasonOf(cause) }),
    });

  /**
   * A file of the `conversations` directory `within` (a real path), by its
   * real path and its stamp: a link is followed only to a file inside it.
   */
  const fileOf = async (path: string, within: string) => {
    try {
      let real = path;
      let status = await disk.status(path);
      if (status.isLink) {
        real = await disk.realPath(path);
        if (!real.startsWith(`${within}${sep}`)) {
          throw new NotFollowed(
            path,
            `it leads out of ${within}, and cota reads no conversation out of it`,
          );
        }
        status = await disk.status(real);
      }
      return status.isFile
        ? Option.some({
            real,
            stamp: { size: status.size, changedAt: status.changedAt },
          })
        : Option.none();
    } catch (cause) {
      if (isMissing(cause)) return Option.none();
      throw cause;
    }
  };

  /** A conversation's database and its `-wal`, by their real paths, and their stamps. */
  const filesOf = async (database: string, within: string) => {
    const db = await fileOf(database, within);
    if (Option.isNone(db)) return Option.none();
    const wal = await fileOf(`${database}-wal`, within);
    const stamps: Stamps = {
      db: db.value.stamp,
      wal: Option.map(wal, ({ stamp }) => stamp),
    };
    return Option.some({
      db: db.value.real,
      wal: Option.map(wal, ({ real }) => real),
      stamps,
    });
  };

  /**
   * The `conversations` directory of a data folder's real path, or none
   * when it has none; one that is a link is not read.
   */
  const conversationsOf = async (real: string) => {
    const directory = join(real, "conversations");
    try {
      const status = await disk.status(directory);
      if (status.isLink) {
        throw new NotFollowed(
          directory,
          "it is a symbolic link, and cota reads no conversation through one",
        );
      }
      return status.isDirectory ? Option.some(directory) : Option.none();
    } catch (cause) {
      if (isMissing(cause)) return Option.none();
      throw cause;
    }
  };

  const copyOnce = async (
    database: string,
    within: string,
    scratch: string,
    conversation: string,
    after: number,
  ): Promise<Copied | "again"> => {
    const before = await filesOf(database, within);
    if (Option.isNone(before)) return { _tag: "Changing" };
    const directory = await disk.makeScratch(scratch);
    try {
      const copy = join(directory, "conversation.db");
      await disk.writeBytes(copy, await disk.readBytes(before.value.db));
      if (Option.isSome(before.value.wal)) {
        await disk.writeBytes(
          `${copy}-wal`,
          await disk.readBytes(before.value.wal.value),
        );
      }
      const afterCopy = await filesOf(database, within);
      if (
        Option.isNone(afterCopy) ||
        afterCopy.value.db !== before.value.db ||
        Option.getOrUndefined(afterCopy.value.wal) !==
          Option.getOrUndefined(before.value.wal) ||
        !sameStamps(before.value.stamps, afterCopy.value.stamps)
      ) {
        return "again";
      }
      const db = disk.openDatabase(copy);
      try {
        db.exec("PRAGMA query_only = 1");
        const read = recordOf(db, conversation, after);
        return Option.match(read, {
          onNone: (): Copied => ({ _tag: "Schema" }),
          onSome: (each): Copied => ({
            _tag: "Read",
            record: each,
            stamps: before.value.stamps,
          }),
        });
      } finally {
        db.close();
      }
    } catch (cause) {
      if (isMissing(cause)) return "again";
      throw cause;
    } finally {
      await disk.removeScratch(directory);
    }
  };

  return Layer.succeed(
    ClientRecords,
    ClientRecords.of({
      folder: (path) =>
        attempt(path, async () => {
          try {
            const real = await disk.realPath(path);
            return (await disk.status(real)).isDirectory
              ? Option.some(real)
              : Option.none<string>();
          } catch (cause) {
            if (isMissing(cause)) return Option.none<string>();
            throw cause;
          }
        }),
      conversations: (folder) =>
        attempt(join(folder, "conversations"), async () => {
          let real: string;
          try {
            real = await disk.realPath(folder);
            if (!(await disk.status(real)).isDirectory) {
              return Option.none<ReadonlyArray<Listed>>();
            }
          } catch (cause) {
            if (isMissing(cause)) return Option.none<ReadonlyArray<Listed>>();
            throw cause;
          }
          const directory = await conversationsOf(real);
          if (Option.isNone(directory)) {
            return Option.some<ReadonlyArray<Listed>>([]);
          }
          let names: ReadonlyArray<string>;
          try {
            names = await disk.names(directory.value);
          } catch (cause) {
            if (isMissing(cause)) return Option.some<ReadonlyArray<Listed>>([]);
            throw cause;
          }
          const listed: Array<Listed> = [];
          for (const name of [...names].sort()) {
            if (!name.endsWith(".db") || name.length <= 3) continue;
            const files = await filesOf(
              join(directory.value, name),
              directory.value,
            );
            if (Option.isSome(files)) {
              listed.push({
                conversation: name.slice(0, -3),
                stamps: files.value.stamps,
              });
            }
          }
          return Option.some<ReadonlyArray<Listed>>(listed);
        }),
      read: (folder, conversation, scratch, after) =>
        attempt(
          join(folder, "conversations", `${conversation}.db`),
          async () => {
            const directory = await conversationsOf(
              await disk.realPath(folder),
            );
            if (Option.isNone(directory))
              return { _tag: "Changing" } satisfies Copied;
            const database = join(directory.value, `${conversation}.db`);
            for (let tried = 0; tried < copies; tried++) {
              const copied = await copyOnce(
                database,
                directory.value,
                scratch,
                conversation,
                after,
              );
              if (copied !== "again") return copied;
            }
            return { _tag: "Changing" } satisfies Copied;
          },
        ),
    }),
  );
};

export const layer = layerOf(nodeDisk);
