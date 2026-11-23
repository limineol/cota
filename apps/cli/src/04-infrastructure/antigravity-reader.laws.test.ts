import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { ClientRecords } from "#02-application/interfaces/client-records.ts";
import { fromStart, readingOf } from "#03-domain/antigravity-record.ts";
import { written } from "#05-tests/antigravity-databases.ts";
import {
  conversationOf,
  type Plan,
  Plan as PlanSchema,
  plan,
} from "#05-tests/antigravity-records.ts";
import { recordOf } from "#05-tests/fakes/in-memory-client-records.ts";
import { type Disk, layerOf, nodeDisk } from "./sqlite-client-records.ts";

const conversation = "c0ffee00-0000-4000-8000-000000000002";

/** A data folder in a scratch directory: a conversation's database held open by a writer, as a live client holds it, and files the reader must never open. */
const folderWith = (plans: ReadonlyArray<Plan>) => {
  const folder = mkdtempSync(join(tmpdir(), "cota-agy-"));
  mkdirSync(join(folder, "conversations"));
  mkdirSync(join(folder, "logs"));
  writeFileSync(
    join(folder, "oauth_creds.json"),
    '{"refresh_token":"1//not-a-real-token"}',
  );
  writeFileSync(join(folder, "settings.json"), "{}");
  writeFileSync(join(folder, "logs", "agy.log"), "started\n");
  writeFileSync(join(folder, "conversations", "notes.txt"), "not a database");
  const held = conversationOf(conversation, plans);
  const db = written(join(folder, "conversations", `${conversation}.db`), held);
  return { folder, db, held };
};

/** Every file under a directory, with a digest of its bytes and its modification time. */
const filesOf = (directory: string) =>
  new Map(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [
          relative(directory, path),
          `${createHash("sha256").update(readFileSync(path)).digest("hex")} ${statSync(path).mtimeMs}`,
        ] as const;
      }),
  );

/** The disk the reader is given, recording every path it touches and how. */
const watched = () => {
  const touched: Array<{ readonly how: string; readonly path: string }> = [];
  const note =
    <A extends ReadonlyArray<unknown>, B>(
      how: string,
      f: (path: string, ...rest: A) => B,
    ) =>
    (path: string, ...rest: A) => {
      touched.push({ how, path });
      return f(path, ...rest);
    };
  const disk: Disk = {
    status: note("status", nodeDisk.status),
    names: note("names", nodeDisk.names),
    realPath: note("realPath", nodeDisk.realPath),
    readBytes: note("readBytes", nodeDisk.readBytes),
    writeBytes: note("writeBytes", nodeDisk.writeBytes),
    makeScratch: note("makeScratch", nodeDisk.makeScratch),
    removeScratch: note("removeScratch", nodeDisk.removeScratch),
    openDatabase: note("openDatabase", nodeDisk.openDatabase),
  };
  return { touched, disk };
};

const Tail = Schema.Array(PlanSchema).check(Schema.isMaxLength(10));

const every: ReadonlyArray<Plan> = [
  plan("user", { workspace: 1 }),
  plan("model"),
  plan("tool"),
  plan("other", { text: "﻿starts with a byte order mark" }),
  plan("compaction", { model: 1 }),
  plan("model", { model: 1 }),
];

const read = (disk: Disk, folder: string, scratch: string) =>
  Effect.gen(function* () {
    const records = yield* ClientRecords;
    const listed = yield* records.conversations(folder);
    const copied = yield* records.read(folder, conversation, scratch, -1);
    return { listed, copied };
  }).pipe(Effect.provide(layerOf(disk)));

describe("the Antigravity reader over SQLite", () => {
  it.effect.prop(
    "J23: A run opens no file of a data folder but `conversations/*.db` and their `-wal`, opens none of them to write, and leaves every file of the folder as it was.",
    { tail: Arbitrary.schema(Tail) },
    ({ tail }) =>
      Effect.gen(function* () {
        const { folder, db } = folderWith([...every, ...tail]);
        const scratch = mkdtempSync(join(tmpdir(), "cota-state-"));
        try {
          const before = filesOf(folder);
          expect([...before.keys()]).toContain(
            join("conversations", `${conversation}.db-shm`),
          );
          const { touched, disk } = watched();
          const { listed, copied } = yield* read(disk, folder, scratch);
          expect(
            Option.map(listed, (each) =>
              each.map(({ conversation: id }) => id),
            ),
          ).toEqual(Option.some([conversation]));
          expect(copied._tag).toBe("Read");
          expect(filesOf(folder)).toEqual(before);
          const database = join(folder, "conversations", `${conversation}.db`);
          for (const { how, path } of touched) {
            if (!path.startsWith(folder)) continue;
            const allowed =
              {
                readBytes: [database, `${database}-wal`],
                status: [folder, database, `${database}-wal`],
                names: [join(folder, "conversations")],
              }[how] ?? [];
            expect({ how, path, allowed: allowed.includes(path) }).toEqual({
              how,
              path,
              allowed: true,
            });
          }
          expect(readdirSync(scratch)).toEqual([]);
        } finally {
          db.close();
          rmSync(folder, { recursive: true, force: true });
          rmSync(scratch, { recursive: true, force: true });
        }
      }),
    { arbitrary: { runs: 20 } },
  );

  it.effect.prop(
    "J22: A call's usage, model, times and items are those of the record when it was read, and an item written out in the record form reads back into the step's bytes exactly.",
    { tail: Arbitrary.schema(Tail) },
    ({ tail }) =>
      Effect.gen(function* () {
        const plans = [...every, ...tail];
        const { folder, db, held } = folderWith(plans);
        const scratch = mkdtempSync(join(tmpdir(), "cota-state-"));
        try {
          const { copied } = yield* read(nodeDisk, folder, scratch);
          if (copied._tag !== "Read") throw new Error(copied._tag);
          expect(readingOf(copied.record, fromStart, true)).toEqual(
            readingOf(recordOf(conversation, held, -1), fromStart, true),
          );
        } finally {
          db.close();
          rmSync(folder, { recursive: true, force: true });
          rmSync(scratch, { recursive: true, force: true });
        }
      }),
    { arbitrary: { runs: 20 } },
  );

  it.effect(
    "J24: For any record with a table or column missing, a sub-agent, a step that is not a protocol buffer or a record rewritten, the calls reported are those before it, and `cota requests show` and doctor name the conversation and the reason.",
    () =>
      Effect.gen(function* () {
        const changes = [
          "DROP TABLE parent_references",
          "ALTER TABLE steps DROP COLUMN render_info",
          "ALTER TABLE gen_metadata RENAME COLUMN data TO payload",
          "DROP TABLE trajectory_meta",
        ];
        const outcomes: Array<string> = [];
        for (const change of [undefined, ...changes]) {
          const { folder, db } = folderWith(every);
          if (change !== undefined) db.exec(change);
          const scratch = mkdtempSync(join(tmpdir(), "cota-state-"));
          try {
            const { copied } = yield* read(nodeDisk, folder, scratch);
            outcomes.push(copied._tag);
          } finally {
            db.close();
            rmSync(folder, { recursive: true, force: true });
            rmSync(scratch, { recursive: true, force: true });
          }
        }
        // Dropping a column the reader does not read leaves the schema as it reads it.
        expect(outcomes).toEqual([
          "Read",
          "Schema",
          "Read",
          "Schema",
          "Schema",
        ]);
      }),
  );
});
