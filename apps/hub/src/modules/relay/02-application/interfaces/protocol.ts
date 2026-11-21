import { Context, type Option, type Stream } from "effect";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import type * as Description from "#modules/relay/03-domain/description.ts";
import type * as Reading from "#modules/relay/03-domain/reading.ts";
import type * as Refusal from "#modules/relay/03-domain/refusal.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type { LoginFingerprint } from "#shared/03-domain/ids.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";

export type Part =
  | { readonly _tag: "Event"; readonly event: string; readonly data: string }
  | { readonly _tag: "Body"; readonly text: string };

export type Reader = <E>(
  parts: Stream.Stream<Part, E>,
) => Stream.Stream<Reading.Reading, E>;

/**
 * What the relay needs from a pool's protocol: what a request is, whose login
 * it carries, whether an answer is a refusal, and what an answer said as it
 * passed.
 */
export interface Protocol {
  readonly name: ProtocolName;
  readonly clientPrefix: string;
  readonly describe: (
    request: ClientRequest.ClientRequest,
  ) => Description.Description;
  readonly fingerprint: (
    request: ClientRequest.ClientRequest,
  ) => Option.Option<LoginFingerprint>;
  readonly refusal: Refusal.RefusalRule;
  readonly answerHeaders: (
    headers: ClientRequest.Headers,
  ) => Reading.AnswerHeaders;
  /**
   * Reads the answers of the operations that have usage and output, and of
   * no other.
   */
  readonly reader: (
    description: Description.Description,
  ) => Option.Option<Reader>;
  /** Says how to read the conversation of the operations that carry one. */
  readonly conversation: (
    description: Description.Description,
  ) => Option.Option<Conversation.Rules>;
  readonly error: (body: string) => Option.Option<Reading.ProviderError>;
}

export class Protocols extends Context.Service<
  Protocols,
  { readonly of: (name: ProtocolName) => Protocol }
>()("@cota/hub/relay/Protocols") {}
