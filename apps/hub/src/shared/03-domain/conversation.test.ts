import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as Conversation from "./conversation.ts";

const rules: Conversation.Rules = {
  parts: [
    { part: "system", field: "system" },
    { part: "tools", field: "tools" },
    { part: "input", field: "messages" },
  ],
  takenOut: ["cache_control"],
  textOf: (item) => Conversation.stringOf(item, "text"),
};

const json = (text: string): Schema.Json =>
  Schema.decodeSync(Schema.fromJsonString(Schema.Json))(text);

describe("Conversation", () => {
  it("writes keys in UTF-16 order without whitespace, and numbers as a double prints them", () => {
    expect(
      Conversation.canonical(
        json(
          '{ "ｚ": 1, "😀": 2, "é": 3, "a": 4, "Z": 5, "n": [1.0, 1e2, 0.1, -0, 1e21, 12345678901234567890, "\\u00e9\\ud800\\n"] }',
        ),
      ),
    ).toBe(
      '{"Z":5,"a":4,"n":[1,100,0.1,0,1e+21,12345678901234567000,"é\\ud800\\n"],"é":3,"😀":2,"ｚ":1}',
    );
  });

  it("digests an item as the first 128 bits of the SHA-256 of its canonical form", () => {
    const item = json(
      '{"role": "user", "content": [{"type": "text", "text": "What is 27 * 453?"}]}',
    );

    expect(Conversation.itemOf(rules, item)).toEqual({
      digest: "c0971472ec3c4e4978e861fcac2fe310",
      type: "",
      role: "user",
      content:
        '{"content":[{"text":"What is 27 * 453?","type":"text"}],"role":"user"}',
      text: "",
    });
  });

  it("gives items that are the same JSON value the same digest, whatever their key order and whitespace", () => {
    const one = Conversation.itemOf(
      rules,
      json('{"type":"text","text":"Hi","n":1.0}'),
    );
    const other = Conversation.itemOf(
      rules,
      json('{ "n" : 1 , "text" : "Hi",\n "type" : "text" }'),
    );

    expect(one.digest).toBe(other.digest);
  });

  it("splits a body into its params, its parts and the cache markers taken out of its items, and joins it back", () => {
    const body = json(`{
      "model": "claude-opus-5-5",
      "max_tokens": 64000,
      "system": [
        {"type": "text", "text": "x-anthropic-billing-header: cc_version=2.1.322.a1b; cc_entrypoint=cli;"},
        {"type": "text", "text": "You are Claude Code.", "cache_control": {"type": "ephemeral", "ttl": "1h"}}
      ],
      "messages": [
        {"role": "user", "content": [
          {"type": "text", "text": "Read the file.", "cache_control": {"type": "ephemeral"}}
        ]}
      ]
    }`);

    const split = Conversation.split(
      rules,
      Schema.decodeUnknownSync(Schema.JsonObject)(body),
    );

    expect(split).toEqual({
      params: { model: "claude-opus-5-5", max_tokens: 64000 },
      parts: [
        {
          part: "system",
          field: "system",
          layout: "list",
          items: [
            {
              type: "text",
              text: "x-anthropic-billing-header: cc_version=2.1.322.a1b; cc_entrypoint=cli;",
            },
            { type: "text", text: "You are Claude Code." },
          ],
        },
        { part: "tools", field: "tools", layout: "absent", items: [] },
        {
          part: "input",
          field: "messages",
          layout: "list",
          items: [
            {
              role: "user",
              content: [{ type: "text", text: "Read the file." }],
            },
          ],
        },
      ],
      overlay: [
        {
          part: "system",
          position: 1,
          path: ["cache_control"],
          value: { type: "ephemeral", ttl: "1h" },
        },
        {
          part: "input",
          position: 0,
          path: ["content", 0, "cache_control"],
          value: { type: "ephemeral" },
        },
      ],
    });
    expect(Conversation.join(split)).toEqual(Option.some(body));
  });

  it("keeps a single value as one item, and an empty list as a list", () => {
    const body = { system: "You are terse.", messages: [], tools: null };

    const split = Conversation.split(rules, body);

    expect(split.parts.map(({ layout, items }) => [layout, items])).toEqual([
      ["single", ["You are terse."]],
      ["single", [null]],
      ["list", []],
    ]);
    expect(Conversation.join(split)).toEqual(Option.some(body));
  });

  it("reads no conversation from a body that is not an object or is nested deeper than it reads", () => {
    const nested = (depth: number): Schema.Json =>
      depth === 0 ? "deep" : [nested(depth - 1)];

    expect(
      [
        [{ role: "user" }],
        "messages",
        { messages: [nested(Conversation.deepest)] },
        { messages: [nested(Conversation.deepest - 2)] },
      ].map((body) => Option.isSome(Conversation.read(rules, body, []))),
    ).toEqual([false, false, false, true]);
  });

  it("gives no body back from pieces that do not fit", () => {
    const parts = (items: ReadonlyArray<Schema.Json>) => [
      {
        part: "input" as const,
        field: "messages",
        layout: "single" as const,
        items,
      },
    ];

    expect([
      Conversation.join({ params: {}, parts: parts([1, 2]), overlay: [] }),
      Conversation.join({
        params: {},
        parts: parts([{ role: "user" }]),
        overlay: [
          {
            part: "input",
            position: 0,
            path: ["content", 0, "cache_control"],
            value: {},
          },
        ],
      }),
    ]).toEqual([Option.none(), Option.none()]);
  });
});
