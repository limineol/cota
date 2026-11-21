import { Schema } from "effect";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";

/** The shape an import source holds a conversation in (ADR-0025): never a pool's protocol, and never what the client sent. */
export const SourceForm = Schema.Literals([
  "bifrost-responses",
  "bifrost-chat",
]);
export type SourceForm = typeof SourceForm.Type;

/** How the request log reads a request's items: the protocol the hub forwarded it in, or an imported request's source form. */
export const StoredProtocol = Schema.Union([ProtocolName, SourceForm]);
export type StoredProtocol = typeof StoredProtocol.Type;
