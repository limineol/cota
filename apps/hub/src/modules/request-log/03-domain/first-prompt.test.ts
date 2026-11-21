import { describe, expect, it } from "@effect/vitest";
import { Option, type Schema } from "effect";
import { rulesOf } from "#modules/request-log/05-tests/sessions.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Replay from "#shared/05-tests/replay/replay.ts";
import { firstPromptOf } from "./first-prompt.ts";

const itemsOf = (protocol: ProtocolName, items: ReadonlyArray<Schema.Json>) =>
  items.map((item) => Conversation.itemOf(rulesOf(protocol), item));

/** The input items of a recorded exchange's request, as the request log stores them. */
const recordedInput = (file: string) => {
  const loaded = Replay.load().find((each) => each.file === file);
  if (loaded?.exchange.request.body === undefined) throw new Error(file);
  const body = loaded.exchange.request.body;
  if (!("json" in body)) throw new Error(`${file} has no JSON body`);
  const conversation = Option.getOrThrow(
    Conversation.read(rulesOf(loaded.protocol), body.json, []),
  );
  return { protocol: loaded.protocol, input: conversation.input };
};

describe("the first prompt", () => {
  it.each([
    ["anthropic-messages/recorded-thinking-tool-use.json", "scrubbed:l"],
    ["chatgpt-codex/recorded-turn-custom-tool-call.json", "scrubbed:m"],
    ["openai-chat/recorded-opencode-provider-unavailable.json", "scrubbed:m"],
  ])(
    "is the text of the last user message of a recorded first request, %s",
    (file, prompt) => {
      const { protocol, input } = recordedInput(file);

      expect(Option.getOrNull(firstPromptOf(protocol, input))).toBe(prompt);
    },
  );

  it("passes over Codex's AGENTS.md and environment, which come as an earlier user message", () => {
    const input = itemsOf("chatgpt-codex", [
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "Be terse." }],
      },
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "# AGENTS.md instructions" },
          { type: "input_text", text: "<environment_context>" },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Fix the build." }],
      },
      { type: "additional_tools", role: "developer", tools: [] },
    ]);

    expect(Option.getOrNull(firstPromptOf("chatgpt-codex", input))).toBe(
      "Fix the build.",
    );
  });

  it("takes the last text block of an Anthropic user message, and passes over one that holds only tool results", () => {
    const input = itemsOf("anthropic-messages", [
      {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>…</system-reminder>" },
          { type: "text", text: "Why does the hub drop requests?" },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "…" }],
      },
    ]);

    expect(Option.getOrNull(firstPromptOf("anthropic-messages", input))).toBe(
      "Why does the hub drop requests?",
    );
  });

  it("is cut to 500 characters, counted in code points, and is none without a user message", () => {
    const long = "😀".repeat(600);

    expect([
      Option.getOrNull(
        firstPromptOf(
          "openai-chat",
          itemsOf("openai-chat", [{ role: "user", content: long }]),
        ),
      ),
      Option.getOrNull(
        firstPromptOf(
          "chatgpt-codex",
          itemsOf("chatgpt-codex", [
            { type: "message", role: "user", content: "a string" },
          ]),
        ),
      ),
    ]).toEqual(["😀".repeat(500), null]);
  });
});
