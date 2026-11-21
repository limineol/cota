import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { generatedOf } from "./title.ts";

const answer = (...content: ReadonlyArray<unknown>) => {
  const text = Conversation.canonical(
    JSON.parse(JSON.stringify({ role: "assistant", content })),
  );
  return [
    {
      digest: Conversation.digestOf(text),
      type: "",
      role: "assistant",
      content: text,
    },
  ];
};

describe("a generated title", () => {
  it("is the title in the JSON of the answer's first text block, trimmed and cut to 200 characters", () => {
    expect(
      [
        answer(
          { type: "thinking", thinking: "…" },
          { type: "text", text: '{"title":"  Fix the relay\'s hang-up  "}' },
          { type: "text", text: '{"title":"Not this one"}' },
        ),
        answer({
          type: "text",
          text: JSON.stringify({ title: "é".repeat(250) }),
        }),
      ].map((output) => Option.getOrNull(generatedOf(output))),
    ).toEqual(["Fix the relay's hang-up", "é".repeat(200)]);
  });

  it("is none when the answer is not such JSON, or its title is empty", () => {
    expect(
      [
        answer({ type: "text", text: "Fix the relay" }),
        answer({ type: "text", text: '{"title":42}' }),
        answer({ type: "text", text: '["title"]' }),
        answer({ type: "text", text: '{"title":"   "}' }),
        answer({ type: "tool_use", id: "t1", name: "x", input: {} }),
        [],
      ].map((output) => Option.getOrNull(generatedOf(output))),
    ).toEqual([null, null, null, null, null, null]);
  });
});
