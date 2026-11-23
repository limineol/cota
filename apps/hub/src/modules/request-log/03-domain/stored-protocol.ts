import { Schema } from "effect";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import { RecordForm } from "#shared/03-domain/record-form.ts";

/** The shape an import source holds a conversation in (ADR-0025): never a pool's protocol, and never what the client sent. */
export const SourceForm = Schema.Literals([
  "bifrost-responses",
  "bifrost-chat",
]);
export type SourceForm = typeof SourceForm.Type;

/** How the request log reads a request's items: the protocol the hub forwarded it in, an imported request's source form, or a reported request's record form. */
export const StoredProtocol = Schema.Literals([
  ...ProtocolName.literals,
  ...SourceForm.literals,
  ...RecordForm.literals,
]);
export type StoredProtocol = typeof StoredProtocol.Type;

/** Whether a request's items are a client's record: the request was reported (ADR-0029). */
export const isRecordForm = Schema.is(RecordForm);
