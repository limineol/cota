import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option } from "effect";
import { idOf } from "#modules/request-log/05-tests/sessions.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { rolesOf } from "./request-role.ts";
import type { SessionRequest, Shape } from "./session.ts";

const main = Conversation.Digest.make("a".repeat(32));
const explorer = Conversation.Digest.make("b".repeat(32));

const shape = (fields: Partial<Shape> = {}): Shape => ({
  system: [main],
  firstInput: Option.none(),
  tools: 2,
  inputTypes: [],
  params: {},
  ...fields,
});

const request = (
  minute: number,
  fields: Partial<SessionRequest> = {},
): SessionRequest => ({
  id: idOf(minute, minute),
  startedAt: DateTime.makeUnsafe(Date.UTC(2026, 10, 12, 9, minute)),
  protocol: "anthropic-messages",
  purpose: "",
  outcome: "ok",
  promptSize: Option.some(1_000),
  clientHeaders: {},
  conversation: Option.some(shape()),
  ...fields,
});

const rolesIn = (requests: ReadonlyArray<SessionRequest>) =>
  rolesOf(requests).map(({ requestRole }) => requestRole);

describe("request roles", () => {
  it("makes main the thread whose prompt sizes add up to the most, and its others subagents", () => {
    expect(
      rolesIn([
        request(0),
        request(1, {
          conversation: Option.some(shape({ system: [explorer] })),
        }),
        request(2, {
          conversation: Option.some(shape({ system: [explorer] })),
          promptSize: Option.none(),
        }),
        request(3, { promptSize: Option.some(1_500) }),
        request(4, {
          conversation: Option.some(shape({ system: [explorer] })),
          promptSize: Option.some(1_400),
        }),
      ]),
    ).toEqual(["main", "subagent", "subagent", "main", "subagent"]);
  });

  it("gives equal threads' main to the one holding the latest request", () => {
    expect(
      rolesIn([
        request(0),
        request(1, {
          conversation: Option.some(shape({ system: [explorer] })),
        }),
      ]),
    ).toEqual(["subagent", "main"]);
  });

  it("takes the client's word over structure, a title request's shape first", () => {
    const titled = shape({
      tools: 0,
      params: {
        output_config: {
          format: {
            type: "json_schema",
            schema: { type: "object", required: ["title"] },
          },
        },
      },
    });
    expect(
      rolesIn([
        request(0, { purpose: "auxiliary", conversation: Option.some(titled) }),
        request(1, { clientHeaders: { "x-claude-code-agent-id": "a1" } }),
        request(2, {
          purpose: "main",
          conversation: Option.some(shape({ system: [explorer] })),
        }),
        request(3, { promptSize: Option.some(90_000) }),
        request(4, { conversation: Option.none() }),
        request(5, { conversation: Option.some(shape({ tools: 0 })) }),
      ]),
    ).toEqual(["title", "subagent", "main", "main", "utility", "utility"]);
  });

  it("counts Codex's tools sent as an additional_tools input item, and reads Codex's own word", () => {
    const codex = (minute: number, fields: Partial<SessionRequest>) =>
      request(minute, {
        protocol: "chatgpt-codex",
        conversation: Option.some(
          shape({
            system: [],
            firstInput: Option.some(main),
            tools: 0,
            inputTypes: ["additional_tools"],
          }),
        ),
        ...fields,
      });
    expect(
      rolesIn([
        codex(0, {}),
        codex(1, { purpose: "turn" }),
        codex(2, {
          clientHeaders: { "x-openai-subagent": "review" },
          purpose: "review",
        }),
        codex(3, {
          conversation: Option.some(shape({ system: [], tools: 0 })),
        }),
      ]),
    ).toEqual(["main", "main", "subagent", "utility"]);
  });
});
