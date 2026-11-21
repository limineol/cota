import { describe, expect, it } from "@effect/vitest";
import type { Schema } from "effect";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import { plain } from "#modules/request-log/05-tests/traffic.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import { renderers } from "./transcripts.ts";

const stored = (item: Schema.Json) => {
  const content = Conversation.canonical(item);
  return {
    digest: Conversation.digestOf(content),
    type: Conversation.stringOf(item, "type"),
    role: Conversation.stringOf(item, "role"),
    content,
  };
};

/** The entries of a request's items, without the digests. */
const read = (
  protocol: ProtocolName,
  items: Partial<Record<Transcript.TranscriptPart, ReadonlyArray<Schema.Json>>>,
  length: number = Transcript.longest.session,
) =>
  plain(
    Transcript.entriesOf(
      renderers[protocol],
      {
        system: (items.system ?? []).map(stored),
        input: (items.input ?? []).map(stored),
        output: (items.output ?? []).map(stored),
      },
      length,
    ).map(({ item: _, ...entry }) => entry),
  );

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

describe("rendering stored items", () => {
  it("reads Anthropic Messages blocks in order, naming a result by its call, an image by its size, and an unknown block as its JSON", () => {
    expect(
      read("anthropic-messages", {
        system: [{ type: "text", text: "You are Claude Code." }],
        input: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in it?" },
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: png },
              },
              { type: "tool_addition", tools: [{ name: "Read" }] },
            ],
          },
        ],
        output: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Look first.", signature: "c2ln" },
              { type: "redacted_thinking", data: "ZW5jcnlwdGVk" },
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Read",
                input: { path: "a.png" },
              },
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: [{ type: "text", text: "A dot." }],
                is_error: true,
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        kind: "message",
        part: "system",
        role: "system",
        parts: [{ type: "text", text: "You are Claude Code.", cut: 0 }],
      },
      {
        kind: "message",
        part: "input",
        role: "user",
        parts: [
          { type: "text", text: "What is in it?", cut: 0 },
          { type: "image", mediaType: "image/png", bytes: 70 },
          {
            type: "other",
            json: '{"tools":[{"name":"Read"}],"type":"tool_addition"}',
            cut: 0,
          },
        ],
      },
      { kind: "reasoning", part: "output", text: "Look first.", cut: 0 },
      { kind: "reasoning", part: "output", text: null, cut: 0 },
      {
        kind: "tool-call",
        part: "output",
        callId: "toolu_1",
        name: "Read",
        input: '{"path":"a.png"}',
        cut: 0,
      },
      {
        kind: "tool-result",
        part: "output",
        callId: "toolu_1",
        name: "Read",
        output: "A dot.",
        error: true,
        cut: 0,
      },
    ]);
  });

  it("reads Codex items, hiding reasoning with no summary, and withholding encrypted content and image data from an item it does not know", () => {
    expect(
      read("chatgpt-codex", {
        system: ["Be brief."],
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "Fix it." },
              {
                type: "input_image",
                image_url: `data:image/png;base64,${png}`,
              },
            ],
          },
          { type: "reasoning", summary: [], encrypted_content: "ZW5j" },
          {
            type: "custom_tool_call",
            call_id: "call_2",
            name: "apply_patch",
            input: "*** Begin Patch",
          },
          {
            type: "custom_tool_call_output",
            call_id: "call_2",
            output: [{ type: "input_text", text: "Done." }],
          },
          {
            type: "compaction",
            encrypted_content: "ZW5jcnlwdGVk",
            image: `data:image/png;base64,${png}`,
          },
        ],
        output: [
          {
            type: "reasoning",
            summary: [
              { type: "summary_text", text: "One." },
              { type: "summary_text", text: "Two." },
            ],
          },
          {
            type: "web_search_call",
            id: "ws_1",
            action: { type: "search", query: "zstd" },
          },
        ],
      }),
    ).toEqual([
      {
        kind: "message",
        part: "system",
        role: "system",
        parts: [{ type: "text", text: "Be brief.", cut: 0 }],
      },
      {
        kind: "message",
        part: "input",
        role: "user",
        parts: [
          { type: "text", text: "Fix it.", cut: 0 },
          { type: "image", mediaType: "image/png", bytes: 70 },
        ],
      },
      { kind: "reasoning", part: "input", text: null, cut: 0 },
      {
        kind: "tool-call",
        part: "input",
        callId: "call_2",
        name: "apply_patch",
        input: "*** Begin Patch",
        cut: 0,
      },
      {
        kind: "tool-result",
        part: "input",
        callId: "call_2",
        name: "apply_patch",
        output: "Done.",
        error: false,
        cut: 0,
      },
      {
        kind: "other",
        part: "input",
        json: '{"encrypted_content":"[withheld: 12 characters]","image":"[withheld: 118 characters]","type":"compaction"}',
        cut: 0,
      },
      { kind: "reasoning", part: "output", text: "One.\n\nTwo.", cut: 0 },
      {
        kind: "tool-call",
        part: "output",
        callId: "ws_1",
        name: "web_search_call",
        input: '{"query":"zstd","type":"search"}',
        cut: 0,
      },
    ]);
  });

  it("reads an OpenAI Chat message as its reasoning, its content and its calls, a tool's message as a result, and cuts each text by code points", () => {
    expect(
      read(
        "openai-chat",
        {
          input: [
            { role: "user", content: "😀😀😀😀 and more" },
            {
              role: "assistant",
              content: "",
              reasoning_content: "Read the file.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"a"}' },
                },
              ],
            },
            { role: "tool", tool_call_id: "call_1", content: "contents" },
            { role: "assistant", content: null },
          ],
        },
        4,
      ),
    ).toEqual([
      {
        kind: "message",
        part: "input",
        role: "user",
        parts: [{ type: "text", text: "😀😀😀😀", cut: 9 }],
      },
      { kind: "reasoning", part: "input", text: "Read", cut: 10 },
      {
        kind: "tool-call",
        part: "input",
        callId: "call_1",
        name: "read",
        input: '{"pa',
        cut: 8,
      },
      {
        kind: "tool-result",
        part: "input",
        callId: "call_1",
        name: "read",
        output: "cont",
        error: false,
        cut: 4,
      },
      { kind: "message", part: "input", role: "assistant", parts: [] },
    ]);
  });
});
