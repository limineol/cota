import { Database } from "bun:sqlite";
import type { Conversation } from "./fakes/in-memory-client-records.ts";

/** The tables of an Antigravity conversation's database, as the record showed them, with the columns the reader does not read. */
export const schema = [
  "CREATE TABLE IF NOT EXISTS trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer)",
  "CREATE TABLE IF NOT EXISTS steps (idx integer PRIMARY KEY, step_type integer, status integer, has_subtrajectory numeric, metadata blob, error_details blob, permissions blob, task_details blob, render_info blob, step_payload blob, step_format integer)",
  "CREATE TABLE IF NOT EXISTS gen_metadata (idx integer PRIMARY KEY, data blob, size integer)",
  "CREATE TABLE IF NOT EXISTS executor_metadata (idx integer PRIMARY KEY, data blob)",
  "CREATE TABLE IF NOT EXISTS parent_references (idx integer PRIMARY KEY, data blob)",
  "CREATE TABLE IF NOT EXISTS trajectory_metadata_blob (idx integer PRIMARY KEY, data blob)",
  "CREATE TABLE IF NOT EXISTS battle_mode_infos (idx integer PRIMARY KEY, data blob)",
];

/**
 * Writes a conversation into its database as the client does, in WAL mode:
 * its steps and `gen_metadata` rows added, or replaced where the database
 * holds them already, and a parent reference for a sub-agent's. The
 * database is left open, as a running client holds it.
 */
export const written = (path: string, held: Conversation): Database => {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  for (const statement of schema) db.exec(statement);
  db.exec("DELETE FROM trajectory_meta");
  db.query(
    "INSERT INTO trajectory_meta (trajectory_id, cascade_id, trajectory_type, source) VALUES (?, ?, 1, 1)",
  ).run(held.trajectory, held.cascade);
  for (const step of held.steps) {
    db.query(
      "INSERT OR REPLACE INTO steps (idx, step_type, status, has_subtrajectory, metadata, step_payload, render_info) VALUES (?, ?, ?, ?, ?, ?, x'00')",
    ).run(
      step.idx,
      step.stepType,
      step.status,
      step.hasSubtrajectory ? 1 : 0,
      step.metadata,
      step.payload,
    );
  }
  held.generations.forEach((data, idx) => {
    db.query(
      "INSERT OR REPLACE INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)",
    ).run(idx, data, data?.length ?? 0);
  });
  if (held.subAgent) {
    db.query(
      "INSERT OR REPLACE INTO parent_references (idx, data) VALUES (0, x'0a00')",
    ).run();
  }
  return db;
};
