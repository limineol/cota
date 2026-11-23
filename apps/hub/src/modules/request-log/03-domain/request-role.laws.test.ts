import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, type Schema } from "effect";
import * as Generated from "#modules/request-log/05-tests/sessions.ts";
import { fieldOf } from "#shared/03-domain/conversation.ts";
import { type RequestRole, rolesOf } from "./request-role.ts";
import type { SessionRequest } from "./session.ts";

const rolesById = (requests: ReadonlyArray<SessionRequest>) =>
  Object.fromEntries(
    rolesOf(requests).map(({ request, requestRole }) => [
      request.id,
      requestRole,
    ]),
  );

const at = (value: Schema.Json | undefined, ...path: ReadonlyArray<string>) =>
  path.reduce<Schema.Json | undefined>(
    (each, key) => (each === undefined ? undefined : fieldOf(each, key)),
    value,
  );

/** The role rules 2 to 5 of the sessions spec give a request with a conversation, read from the spec's text. */
const clientsWordOf = (request: SessionRequest): Option.Option<RequestRole> => {
  if (Option.isNone(request.conversation)) return Option.none();
  if (request.protocol === "antigravity-steps") return Option.some("main");
  const { params } = request.conversation.value;
  const format = at(params, "output_config", "format");
  if (
    request.protocol === "anthropic-messages" &&
    at(format, "type") === "json_schema" &&
    JSON.stringify(at(format, "schema", "required")) === '["title"]'
  ) {
    return Option.some("title");
  }
  const agent = request.clientHeaders["x-claude-code-agent-id"] ?? "";
  const subagent = request.clientHeaders["x-openai-subagent"] ?? "";
  if (request.protocol === "anthropic-messages" && agent !== "") {
    return Option.some("subagent");
  }
  if (request.protocol === "chatgpt-codex" && subagent !== "") {
    return Option.some("subagent");
  }
  const table: Record<string, Record<string, RequestRole>> = {
    "anthropic-messages": {
      main: "main",
      auxiliary: "utility",
      quota_probe: "utility",
    },
    "chatgpt-codex": { turn: "main" },
  };
  return Option.fromUndefinedOr(table[request.protocol]?.[request.purpose]);
};

/** The thread key as the spec words it: the system digests, else the first input item's. */
const threadOf = (request: SessionRequest): string =>
  Option.match(request.conversation, {
    onNone: () => "none",
    onSome: ({ system, firstInput }) =>
      system.length > 0
        ? JSON.stringify(["system", system])
        : JSON.stringify(["input", Option.getOrNull(firstInput)]),
  });

describe("request roles", () => {
  it.effect.prop(
    "T1: every request of a session has exactly one request role, and it depends on that session's requests only",
    {
      session: Generated.sessionRequests(25),
      keys: Generated.shuffleKeys,
    },
    ({ session, keys }) =>
      Effect.sync(() => {
        const roled = rolesOf(session);

        expect(roled.map(({ request }) => request.id).sort()).toEqual(
          session.map(({ id }) => id).sort(),
        );
        expect(rolesById(Generated.shuffled(session, keys))).toEqual(
          rolesById(session),
        );
      }),
    { arbitrary: { runs: 300 } },
  );

  it("T1: every request of a session has exactly one request role, and it depends on that session's requests only, for two equal threads given latest first", () => {
    const request = (minute: number, system: string): SessionRequest => ({
      id: Generated.idOf(minute, minute),
      startedAt: DateTime.makeUnsafe(Date.UTC(2026, 10, 12, 9, minute)),
      protocol: "anthropic-messages",
      purpose: "",
      outcome: "ok",
      promptSize: Option.some(1_000),
      clientHeaders: {},
      conversation: Option.some({
        system: [Generated.digestOf(system)],
        firstInput: Option.none(),
        tools: 2,
        inputTypes: [],
        params: {},
      }),
    });
    const session = [request(0, "a"), request(1, "b")];

    expect(rolesById([...session].reverse())).toEqual(rolesById(session));
  });

  it.effect.prop(
    "T2: a request that rule 2, 3, 4 or 5 decides has that role whatever the other requests of its session are",
    {
      session: Generated.sessionRequests(15),
      others: Generated.sessionRequests(15, 100),
    },
    ({ session, others }) =>
      Effect.sync(() => {
        const alone = rolesById(session);
        const among = rolesById([...session, ...others]);
        const decided = session.flatMap((request) =>
          Option.match(clientsWordOf(request), {
            onNone: () => [],
            onSome: (role) => [{ id: request.id, role }],
          }),
        );

        expect(decided.map(({ id }) => ({ id, role: alone[id] }))).toEqual(
          decided,
        );
        expect(decided.map(({ id }) => ({ id, role: among[id] }))).toEqual(
          decided,
        );
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "T3: the requests that rule 6 makes main all have the same thread key",
    { session: Generated.sessionRequests(25) },
    ({ session }) =>
      Effect.sync(() => {
        const threads = new Set(
          rolesOf(session)
            .filter(
              ({ request, requestRole }) =>
                requestRole === "main" && Option.isNone(clientsWordOf(request)),
            )
            .map(({ request }) => threadOf(request)),
        );

        expect(threads.size).toBeLessThanOrEqual(1);
      }),
    { arbitrary: { runs: 300 } },
  );
});
