import { Option, Schema } from "effect";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import { fieldOf } from "#shared/03-domain/conversation.ts";
import {
  byStart,
  hasTools,
  type SessionRequest,
  type Shape,
  threadKeyOf,
} from "./session.ts";

export const RequestRole = Schema.Literals([
  "main",
  "subagent",
  "title",
  "utility",
]);
export type RequestRole = typeof RequestRole.Type;

export interface Roled {
  readonly request: SessionRequest;
  readonly requestRole: RequestRole;
}

const at = (value: Schema.Json, ...path: ReadonlyArray<string>) =>
  path.reduce<Schema.Json | undefined>(
    (each, key) => (each === undefined ? undefined : fieldOf(each, key)),
    value,
  );

/** Claude Code's request to name its session: a structured answer whose schema requires exactly `title`. */
const asksForTitle = (protocol: StoredProtocol, shape: Shape): boolean => {
  if (protocol !== "anthropic-messages") return false;
  const required = at(
    shape.params,
    "output_config",
    "format",
    "schema",
    "required",
  );
  return (
    at(shape.params, "output_config", "format", "type") === "json_schema" &&
    Array.isArray(required) &&
    required.length === 1 &&
    required[0] === "title"
  );
};

const subagentHeader: Partial<Record<StoredProtocol, string>> = {
  "anthropic-messages": "x-claude-code-agent-id",
  "chatgpt-codex": "x-openai-subagent",
};

const byPurpose: Partial<
  Record<StoredProtocol, Readonly<Record<string, RequestRole>>>
> = {
  "anthropic-messages": {
    main: "main",
    auxiliary: "utility",
    quota_probe: "utility",
  },
  "chatgpt-codex": { turn: "main" },
};

/** The role rules 1 to 4 give a request on its own, the client's word; none when only its session can say. */
const ownRoleOf = (request: SessionRequest): Option.Option<RequestRole> => {
  if (Option.isNone(request.conversation)) return Option.some("utility");
  const shape = request.conversation.value;
  if (asksForTitle(request.protocol, shape)) return Option.some("title");
  const header = subagentHeader[request.protocol];
  if (header !== undefined && (request.clientHeaders[header] ?? "") !== "") {
    return Option.some("subagent");
  }
  const said = byPurpose[request.protocol]?.[request.purpose];
  if (said !== undefined) return Option.some(said);
  if (!hasTools(request.protocol, shape)) return Option.some("utility");
  return Option.none();
};

interface Thread {
  readonly key: string;
  promptSize: number;
  /** Where its latest request is in the session's order. */
  latest: number;
}

/**
 * The request role of each of a session's requests, in the session's order
 * (`docs/specs/sessions/spec.md`, Request roles): exactly one each, from that
 * session's requests alone (T1), the client's word first (T2), and among the
 * rest one main thread (T3).
 */
export const rolesOf = (
  requests: ReadonlyArray<SessionRequest>,
): ReadonlyArray<Roled> => {
  const ordered = [...requests]
    .sort(byStart)
    .map((request) => ({ request, own: ownRoleOf(request) }));
  const threads = new Map<string, Thread>();
  ordered.forEach(({ request, own }, at) => {
    const key = Option.flatMap(request.conversation, threadKeyOf);
    if (Option.isSome(own) || Option.isNone(key)) return;
    const thread = threads.get(key.value) ?? {
      key: key.value,
      promptSize: 0,
      latest: at,
    };
    thread.promptSize += Option.getOrElse(request.promptSize, () => 0);
    thread.latest = at;
    threads.set(key.value, thread);
  });
  const main = [...threads.values()].reduce<Thread | undefined>(
    (best, thread) =>
      best === undefined ||
      thread.promptSize > best.promptSize ||
      (thread.promptSize === best.promptSize && thread.latest > best.latest)
        ? thread
        : best,
    undefined,
  );
  const inMainThread = (request: SessionRequest) =>
    main !== undefined &&
    Option.contains(
      Option.flatMap(request.conversation, threadKeyOf),
      main.key,
    );
  return ordered.map(({ request, own }) => ({
    request,
    requestRole: Option.getOrElse(own, () =>
      inMainThread(request) ? "main" : "subagent",
    ),
  }));
};
