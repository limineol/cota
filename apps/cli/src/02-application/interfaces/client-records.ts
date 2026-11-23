import { Context, type Effect, type Option } from "effect";
import type { ClientRecord } from "#03-domain/antigravity-record.ts";
import type { Stamps } from "#03-domain/requests.ts";
import type { FilesFailed } from "./files.ts";

/** A conversation of a data folder, by its id (its database's name) and its files' stamps. */
export interface Listed {
  readonly conversation: string;
  readonly stamps: Stamps;
}

/** What reading a conversation gave: its record and the stamps taken before it was copied; files that kept changing while copied; or a database without the tables and columns the reader reads. */
export type Copied =
  | {
      readonly _tag: "Read";
      readonly record: ClientRecord;
      readonly stamps: Stamps;
    }
  | { readonly _tag: "Changing" }
  | { readonly _tag: "Schema" };

/** The client records of a data folder, copied to be read and never opened, written or locked (`docs/specs/request-reporter/spec.md`, What it opens, and how). */
export class ClientRecords extends Context.Service<
  ClientRecords,
  {
    /** A directory's path with its links resolved, or none when it is not a directory. */
    readonly folder: (
      path: string,
    ) => Effect.Effect<Option.Option<string>, FilesFailed>;
    /** The regular files `<folder>/conversations/<id>.db`, never a link; none when the folder does not exist. */
    readonly conversations: (
      folder: string,
    ) => Effect.Effect<Option.Option<ReadonlyArray<Listed>>, FilesFailed>;
    /**
     * Copies a conversation's database and its `-wal` into a directory of
     * its own under `scratch`, reads the copy from after a step on, and
     * removes the directory.
     */
    readonly read: (
      folder: string,
      conversation: string,
      scratch: string,
      after: number,
    ) => Effect.Effect<Copied, FilesFailed>;
  }
>()("@cota/cli/ClientRecords") {}
