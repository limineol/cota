import { Effect, Layer, Option } from "effect";
import {
  ClientRecords,
  type Copied,
  type Listed,
} from "#02-application/interfaces/client-records.ts";
import type {
  ClientRecord,
  RecordStep,
} from "#03-domain/antigravity-record.ts";
import type { Stamps } from "#03-domain/requests.ts";

/** A conversation's database as the stand-in keeps it: its ids, its steps and its `gen_metadata` rows, or a schema the reader does not read. */
export interface Conversation {
  readonly trajectory: string;
  readonly cascade: string;
  readonly subAgent: boolean;
  readonly steps: ReadonlyArray<RecordStep>;
  readonly generations: ReadonlyArray<Uint8Array | null>;
  readonly schema?: "other";
  /** Its files keep changing while copied. */
  readonly changing?: boolean;
  readonly stamps: Stamps;
}

/** What the reader reads of a conversation from after a step on, as the SQLite reader's queries give it. */
export const recordOf = (
  conversation: string,
  held: Conversation,
  after: number,
): ClientRecord => ({
  conversation,
  trajectory: held.trajectory,
  cascade: held.cascade,
  subAgent: held.subAgent,
  greatestStep: Option.fromUndefinedOr(held.steps.at(-1)?.idx),
  steps: held.steps.filter((step) => step.idx > after),
  lastUserMessage: Option.fromUndefinedOr(
    held.steps.findLast((step) => step.idx <= after && step.stepType === 14),
  ),
  generations: held.generations,
});

/** Data folders in memory, each a map of conversations by id, for laws that run the request reporter hundreds of times. */
export const make = (): {
  readonly folders: Map<string, Map<string, Conversation>>;
  readonly reads: Array<{
    readonly conversation: string;
    readonly after: number;
  }>;
  readonly layer: Layer.Layer<ClientRecords>;
} => {
  const folders = new Map<string, Map<string, Conversation>>();
  const reads: Array<{ conversation: string; after: number }> = [];
  const layer = Layer.succeed(
    ClientRecords,
    ClientRecords.of({
      folder: (path) =>
        Effect.succeed(folders.has(path) ? Option.some(path) : Option.none()),
      conversations: (folder) =>
        Effect.sync(() =>
          Option.map(
            Option.fromUndefinedOr(folders.get(folder)),
            (conversations): ReadonlyArray<Listed> =>
              [...conversations]
                .sort(([one], [other]) => (one < other ? -1 : 1))
                .map(([conversation, { stamps }]) => ({
                  conversation,
                  stamps,
                })),
          ),
        ),
      read: (folder, conversation, _scratch, after) =>
        Effect.sync((): Copied => {
          reads.push({ conversation, after });
          const held = folders.get(folder)?.get(conversation);
          if (held === undefined || held.changing === true) {
            return { _tag: "Changing" };
          }
          if (held.schema === "other") return { _tag: "Schema" };
          return {
            _tag: "Read",
            stamps: held.stamps,
            record: recordOf(conversation, held, after),
          };
        }),
    }),
  );
  return { folders, reads, layer };
};
