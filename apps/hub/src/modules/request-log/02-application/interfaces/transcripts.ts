import { Context } from "effect";
import type { StoredContent } from "#modules/request-log/03-domain/session.ts";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import type * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";

/** Rendering a protocol's stored items to be read (ADR-0014), one renderer per protocol. */
export class Transcripts extends Context.Service<
  Transcripts,
  {
    /** A request's transcript, each text cut at `length` characters. */
    readonly entriesOf: (
      protocol: StoredProtocol,
      items: Transcript.Parts,
      length: number,
    ) => ReadonlyArray<Transcript.Entry>;
    /** A request's tool definitions, by name and description. */
    readonly toolsOf: (
      protocol: StoredProtocol,
      tools: ReadonlyArray<StoredContent>,
    ) => ReadonlyArray<Transcript.Tool>;
    /** What a transcript shows of one item, as text, for a snippet. */
    readonly shownOf: (
      protocol: StoredProtocol,
      part: Conversation.Part,
      content: string,
    ) => string;
  }
>()("@cota/hub/request-log/Transcripts") {}
