import { Schema } from "effect";

/** The shape a client's record holds a conversation in (ADR-0029): never a protocol, and never an import's source form. */
export const RecordForm = Schema.Literals(["antigravity-steps"]);
export type RecordForm = typeof RecordForm.Type;
