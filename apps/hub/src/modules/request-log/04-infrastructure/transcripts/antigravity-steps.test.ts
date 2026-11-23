import { describe, expect, it } from "@effect/vitest";
import { Option, type Schema } from "effect";
import * as AntigravitySteps from "#modules/request-log/03-domain/antigravity-steps.ts";
import { firstPromptOf } from "#modules/request-log/03-domain/first-prompt.ts";
import * as Rendered from "#modules/request-log/03-domain/transcript.ts";
import * as Steps from "#modules/request-log/05-tests/antigravity-steps.ts";
import * as Transcript from "#modules/request-log/05-tests/traffic.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { renderers } from "./transcripts.ts";

const call = {
  id: "call_9",
  name: "read_file",
  arguments: '{"Path":"notes.txt"}',
};

const command = {
  id: "call_10",
  name: "run_command",
  arguments:
    '{"CommandLine":"sleep 20 && wc -l notes.txt","WaitMsBeforeAsync":10000}',
};

const conversation: ReadonlyArray<Schema.JsonObject> = [
  Steps.userMessage(0, "What does the file say?"),
  Steps.modelOutput(1, {
    thoughts: "I should read it.",
    text: "Reading it.",
    calls: [call],
  }),
  Steps.toolResult(2, call, "Line one.\nLine two."),
  Steps.modelOutput(3, { text: "It says two lines." }),
  Steps.userMessage(4, "/compact"),
  Steps.compaction(5, "<summary>The file has two lines.</summary>"),
  Steps.modelOutput(6, { calls: [command] }),
  Steps.toolResult(7, command, "Running in the background."),
  Steps.taskNotification(
    8,
    command,
    "Command exited with code 0.\n2 notes.txt",
  ),
  Steps.taskNotification(9, command, "Not a task's end.", "other_notification"),
  Steps.step(10, 99, [
    { number: 50, text: "a step of a kind the table does not know" },
  ]),
];

const stored = (item: Schema.Json) => {
  const content = Conversation.canonical(item);
  return {
    digest: Conversation.digestOf(content),
    type: "",
    role: "",
    content,
  };
};

describe("the record form antigravity-steps", () => {
  it("reads a step's text for search by the table, and nothing from a step of a kind it does not know", () => {
    expect(conversation.map(AntigravitySteps.textOf)).toEqual([
      "What does the file say?",
      'Reading it.\n{"Path":"notes.txt"}',
      "Line one.\nLine two.",
      "It says two lines.",
      "/compact",
      "<summary>The file has two lines.</summary>",
      command.arguments,
      "Running in the background.",
      "Command exited with code 0.\n2 notes.txt",
      "",
      "",
    ]);
  });

  it("refuses as a step an item with a key the form does not have, a field of a wire type it does not write, or a value that is not its wire type's", () => {
    const valid = Steps.userMessage(0, "hello");
    expect(Option.isSome(AntigravitySteps.stepOf(valid))).toBe(true);
    expect(
      [
        { ...valid, note: "an extra key" },
        { ...valid, metadata: [[1, 3, "0"]] },
        { ...valid, metadata: [[1, 0, "18446744073709551616"]] },
        { ...valid, metadata: [[0, 0, "1"]] },
        { ...valid, metadata: [[1, 1, "00ff"]] },
        { ...valid, metadata: [[1, 2, { base64: "not base64!" }]] },
        { ...valid, metadata: [[1, 2, { base64: "AA==", text: "x" }]] },
        { ...valid, idx: -1 },
      ].map((item) => Option.isSome(AntigravitySteps.stepOf(item))),
    ).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("reads a nested message given as base64, and shows a step whose message is not a protocol buffer as its JSON", () => {
    const thoughts = "ÿ";
    const asBase64 = Steps.step(1, 15, [
      {
        number: 20,
        message: [
          { number: 1, text: "An answer." },
          { number: 9, bytes: new Uint8Array([0xc3]) },
          { number: 3, text: thoughts },
        ],
      },
    ]);
    const broken = Steps.step(2, 15, [
      { number: 20, bytes: new Uint8Array([0x0a, 0x05, 0x41]) },
    ]);

    expect(JSON.stringify(asBase64)).toContain("base64");
    expect(AntigravitySteps.textOf(asBase64)).toBe("An answer.");
    expect(
      Transcript.plain(
        Rendered.entriesOf(
          renderers["antigravity-steps"],
          { system: [], input: [stored(asBase64), stored(broken)], output: [] },
          Rendered.longest.session,
        ).map(({ item: _, ...entry }) => entry),
      ),
    ).toEqual([
      { kind: "reasoning", text: thoughts, cut: 0, part: "input" },
      {
        kind: "message",
        role: "assistant",
        parts: [{ type: "text", text: "An answer.", cut: 0 }],
        part: "input",
      },
      {
        kind: "other",
        json: Conversation.canonical(broken),
        cut: 0,
        part: "input",
      },
    ]);
  });

  it("renders a user's message, the model's thoughts, text and calls, a tool's result named by its call, a compaction's summary, and a task's notification as a later result of the call that started it", () => {
    const [first, ...rest] = conversation;
    expect(
      Transcript.plain(
        Rendered.entriesOf(
          renderers["antigravity-steps"],
          {
            system: [],
            input: [first, ...rest.slice(0, -1)].flatMap((item) =>
              item === undefined ? [] : [stored(item)],
            ),
            output: rest.slice(-1).map(stored),
          },
          Rendered.longest.session,
        ).map(({ item: _, ...entry }) => entry),
      ),
    ).toEqual([
      {
        kind: "message",
        role: "user",
        parts: [{ type: "text", text: "What does the file say?", cut: 0 }],
        part: "input",
      },
      { kind: "reasoning", text: "I should read it.", cut: 0, part: "input" },
      {
        kind: "message",
        role: "assistant",
        parts: [{ type: "text", text: "Reading it.", cut: 0 }],
        part: "input",
      },
      {
        kind: "tool-call",
        callId: "call_9",
        name: "read_file",
        input: '{"Path":"notes.txt"}',
        cut: 0,
        part: "input",
      },
      {
        kind: "tool-result",
        callId: "call_9",
        name: "read_file",
        output: "Line one.\nLine two.",
        error: false,
        cut: 0,
        part: "input",
      },
      {
        kind: "message",
        role: "assistant",
        parts: [{ type: "text", text: "It says two lines.", cut: 0 }],
        part: "input",
      },
      {
        kind: "message",
        role: "user",
        parts: [{ type: "text", text: "/compact", cut: 0 }],
        part: "input",
      },
      {
        kind: "message",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "<summary>The file has two lines.</summary>",
            cut: 0,
          },
        ],
        part: "input",
      },
      {
        kind: "tool-call",
        callId: "call_10",
        name: "run_command",
        input: command.arguments,
        cut: 0,
        part: "input",
      },
      {
        kind: "tool-result",
        callId: "call_10",
        name: "run_command",
        output: "Running in the background.",
        error: false,
        cut: 0,
        part: "input",
      },
      {
        kind: "tool-result",
        callId: "call_10",
        name: "run_command",
        output: "Command exited with code 0.\n2 notes.txt",
        error: false,
        cut: 0,
        part: "input",
      },
      {
        kind: "other",
        json: Conversation.canonical(conversation[9] ?? null),
        cut: 0,
        part: "input",
      },
      {
        kind: "other",
        json: Conversation.canonical(conversation[10] ?? null),
        cut: 0,
        part: "output",
      },
    ]);
  });

  it("gives as the first prompt the text of the last user's message step of the input", () => {
    const input = conversation.slice(0, 4).map(stored);
    expect(Option.getOrNull(firstPromptOf("antigravity-steps", input))).toBe(
      "What does the file say?",
    );
    expect(
      Option.getOrNull(
        firstPromptOf(
          "antigravity-steps",
          conversation.slice(1, 4).map(stored),
        ),
      ),
    ).toBeNull();
  });
});
