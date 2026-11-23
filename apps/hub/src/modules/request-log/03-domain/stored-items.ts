import { type DateTime, Option, type Schema } from "effect";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type { HubKeyName } from "#shared/03-domain/ids.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";

export interface RequestItems {
  readonly requestId: Request.RequestId;
  readonly session: string;
  readonly startedAt: DateTime.Utc;
  readonly system: ReadonlyArray<Conversation.Digest>;
  readonly tools: ReadonlyArray<Conversation.Digest>;
  readonly input: ReadonlyArray<Conversation.Digest>;
  readonly output: ReadonlyArray<Conversation.Digest>;
  readonly layout: ReadonlyArray<Conversation.Placement>;
  readonly overlay: ReadonlyArray<Conversation.Taken>;
  readonly params: Schema.JsonObject;
}

/**
 * A request as the request log keeps it, its columns, read back or imported:
 * its items are in the protocol or the source form it names, and an imported
 * one was admitted by no hub key.
 */
export type StoredRequest = Omit<Request.Request, "conversation" | "origin"> &
  Omit<Request.Forwarded, "_tag" | "protocol" | "hubKey"> & {
    readonly protocol: StoredProtocol;
    readonly hubKey: HubKeyName | "";
  };

/** A forwarded request's columns: its origin's fields beside the rest, without its conversation. */
export const storedOf = ({
  conversation: _,
  origin: { _tag, ...forwarded },
  ...request
}: Request.ForwardedRequest): StoredRequest => ({ ...request, ...forwarded });

export interface StoredItem extends Conversation.Item {
  readonly session: string;
  readonly protocol: StoredProtocol;
  readonly firstSeen: DateTime.Utc;
  readonly requestId: Request.RequestId;
  readonly part: Conversation.Part;
  readonly position: number;
}

const digests = (items: ReadonlyArray<Conversation.Item>) =>
  items.map(({ digest }) => digest);

const wellFormedTexts = (
  texts: Readonly<Record<string, string>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(texts).map(([name, text]) => [
      name.toWellFormed(),
      text.toWellFormed(),
    ]),
  );

const wellFormedItem = (item: Conversation.Item): Conversation.Item => ({
  ...item,
  type: item.type.toWellFormed(),
  role: item.role.toWellFormed(),
  text: item.text.toWellFormed(),
});

/**
 * The request as the request log keeps it: each lone surrogate in its text
 * becomes U+FFFD, except in its items' content, layout, overlay and params,
 * JSON in which a lone surrogate is its escape, so that the body comes back.
 */
export const wellFormed = (
  request: Request.ForwardedRequest,
): Request.ForwardedRequest => ({
  ...request,
  session: request.session.toWellFormed(),
  machine: request.machine.toWellFormed(),
  project: request.project.toWellFormed(),
  client: request.client.toWellFormed(),
  clientVersion: request.clientVersion.toWellFormed(),
  provider: request.provider.toWellFormed(),
  operation: request.operation.toWellFormed(),
  model: request.model.toWellFormed(),
  errorType: request.errorType.toWellFormed(),
  errorMessage: request.errorMessage.toWellFormed(),
  stopReason: request.stopReason.toWellFormed(),
  usage: Option.map(request.usage, (usage) => ({
    ...usage,
    reported: usage.reported.toWellFormed(),
  })),
  providerRequestId: request.providerRequestId.toWellFormed(),
  conversation: Option.map(request.conversation, (conversation) => ({
    ...conversation,
    system: conversation.system.map(wellFormedItem),
    tools: conversation.tools.map(wellFormedItem),
    input: conversation.input.map(wellFormedItem),
    output: conversation.output.map(wellFormedItem),
  })),
  origin: {
    ...request.origin,
    sessionSource: request.origin.sessionSource.toWellFormed(),
    userAgent: request.origin.userAgent.toWellFormed(),
    purpose: request.origin.purpose.toWellFormed(),
    servedModel: request.origin.servedModel.toWellFormed(),
    serviceTier: request.origin.serviceTier.toWellFormed(),
    rateLimits: wellFormedTexts(request.origin.rateLimits),
    clientHeaders: wellFormedTexts(request.origin.clientHeaders),
    errorBody: request.origin.errorBody.toWellFormed(),
  },
});

/** A request without a conversation has no items. */
export const requestItemsOf = (
  request: Request.Request,
): Option.Option<RequestItems> =>
  Option.map(request.conversation, (conversation) => ({
    requestId: request.id,
    session: request.session,
    startedAt: request.startedAt,
    system: digests(conversation.system),
    tools: digests(conversation.tools),
    input: digests(conversation.input),
    output: digests(conversation.output),
    layout: conversation.layout,
    overlay: conversation.overlay,
    params: conversation.params,
  }));

const parts = ["system", "tools", "input", "output"] as const;

/**
 * Gives the items of a request that its session does not have yet, each once,
 * where it was first seen.
 */
export const newItems = (
  known: ReadonlySet<Conversation.Digest>,
  request: Request.ForwardedRequest,
): ReadonlyArray<StoredItem> => {
  if (Option.isNone(request.conversation)) return [];
  const conversation = request.conversation.value;
  const seen = new Set(known);
  const stored: Array<StoredItem> = [];
  for (const part of parts) {
    conversation[part].forEach((item, position) => {
      if (seen.has(item.digest)) return;
      seen.add(item.digest);
      stored.push({
        ...item,
        session: request.session,
        protocol: request.origin.protocol,
        firstSeen: request.startedAt,
        requestId: request.id,
        part,
        position,
      });
    });
  }
  return stored;
};
