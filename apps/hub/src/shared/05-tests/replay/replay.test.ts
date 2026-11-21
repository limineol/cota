import { expect, layer } from "@effect/vitest";
import { Array as Arr, Effect, Option, Schema, Stream } from "effect";
import * as Copy from "#lib/copy.ts";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as ShippedProtocols from "#modules/relay/04-infrastructure/protocols/protocols.ts";
import { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import { RebuildConversation } from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import { InMemoryRequests } from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import { Recorded } from "#modules/request-log/05-tests/fakes/record-request.fake.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as Replay from "./replay.ts";

const exchanges = Replay.load();

let played: ReadonlyArray<Replay.Replay> | undefined;

const replays = Effect.gen(function* () {
  if (played !== undefined) return played;
  const all: Array<Replay.Replay> = [];
  for (const loaded of exchanges) {
    for (const chunking of Replay.chunkings) {
      all.push(yield* Replay.replay(loaded, chunking));
    }
  }
  played = all;
  return all;
});

/**
 * The item types, and the types of an item's blocks, that a transcript shows
 * as their JSON on purpose (`docs/specs/sessions/spec.md`, Transcripts).
 */
const shownAsJson: Readonly<
  Record<
    ProtocolName,
    {
      readonly items: ReadonlyArray<string>;
      readonly blocks: ReadonlyArray<string>;
    }
  >
> = {
  "anthropic-messages": { items: [], blocks: ["tool_addition"] },
  "chatgpt-codex": {
    items: ["additional_tools", "configuration_update"],
    blocks: [],
  },
  "openai-chat": { items: [], blocks: [] },
};

/** A list with each run of equal neighbours taken as one. */
const runs = (values: ReadonlyArray<string>) =>
  values.filter((value, index) => value !== values[index - 1]);

const named = (replay: Replay.Replay) =>
  `exchanges/${replay.file}, ${replay.chunking}`;

const protocolOf = (name: ProtocolName) => ShippedProtocols.shipped[name];

const pathOf = (replay: Replay.Replay) =>
  (replay.exchange.request.path.split("?")[0] ?? "").slice(
    protocolOf(replay.protocol).clientPrefix.length,
  );

const conversationPath: Readonly<Record<ProtocolName, string>> = {
  "anthropic-messages": "/v1/messages",
  "chatgpt-codex": "/responses",
  "openai-chat": "/chat/completions",
};

const rulesOf = (name: ProtocolName) => {
  const protocol = protocolOf(name);
  return Option.getOrThrow(
    protocol.conversation(
      protocol.describe({
        method: "POST",
        path: conversationPath[name],
        headers: {},
        body: Option.none(),
      }),
    ),
  );
};

const asJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));
const asObject = Schema.decodeUnknownOption(Schema.JsonObject);
const encodeRequest = Schema.encodeSync(Schema.toCodecJson(Request.Request));
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const bodyOf = (bytes: Uint8Array, contentEncoding: string | undefined) =>
  Copy.decodedBody(bytes, contentEncoding, Number.MAX_SAFE_INTEGER).pipe(
    Effect.map(textOf),
    Effect.orDie,
  );

const credentialsOf = (headers: Readonly<Record<string, string>>) =>
  Object.entries(headers)
    .filter(([name]) =>
      ["authorization", "x-api-key", "chatgpt-account-id"].includes(name),
    )
    .map(([, value]) => value.replace(/^bearer\s+/i, ""));

const outputOf = (replay: Replay.Replay, askedForStream: boolean) =>
  Effect.gen(function* () {
    const protocol = protocolOf(replay.protocol);
    const reader = protocol.reader(
      protocol.describe({
        method: replay.exchange.request.method,
        path: pathOf(replay),
        headers: replay.exchange.request.headers,
        body: Option.none(),
      }),
    );
    if (Option.isNone(reader)) return [];
    const headers = Object.fromEntries(replay.answerHeaders);
    const text = yield* bodyOf(replay.received, headers["content-encoding"]);
    const type = replay.exchange.response.headers["content-type"];
    const eventStream =
      type === undefined
        ? askedForStream
        : type.startsWith("text/event-stream");
    const parts = eventStream
      ? Copy.sseEvents(Stream.succeed(new TextEncoder().encode(text))).pipe(
          Stream.map((event): Protocol.Part => ({ _tag: "Event", ...event })),
        )
      : Stream.succeed<Protocol.Part>({ _tag: "Body", text });
    const readings = yield* Stream.runCollect(reader.value(parts)).pipe(
      Effect.orDie,
    );
    return Option.match(Arr.last(readings), {
      onNone: () => [],
      onSome: ({ output }) => output,
    });
  });

layer(Replay.layer)("replay", (it) => {
  it.effect(
    "replays every exchange, and the request it logs is the one it expects",
    () =>
      Effect.gen(function* () {
        for (const replay of yield* replays) {
          expect(Replay.expectationOf(replay.logged), named(replay)).toEqual(
            replay.exchange.expects.logged,
          );
        }
        expect(exchanges.length).toBeGreaterThan(0);
      }),
  );

  it.effect(
    "R1: For every forwarded request, the provider receives exactly the body the client sent, and the client receives exactly the body the provider sent. Replayed from every exchange.",
    () =>
      Effect.gen(function* () {
        for (const replay of yield* replays) {
          const { request, response } = replay.exchange;
          expect(
            {
              method: replay.seen.method,
              target: replay.seen.target.endsWith(
                request.path.slice(
                  protocolOf(replay.protocol).clientPrefix.length,
                ),
              ),
              body: replay.seen.body,
            },
            named(replay),
          ).toEqual({
            method: request.method,
            target: true,
            body: request.body === undefined ? new Uint8Array() : replay.sent,
          });
          expect(
            { status: replay.status, body: replay.received },
            named(replay),
          ).toEqual({ status: response.status, body: replay.served });
        }
      }),
  );

  it.effect(
    "R2: A hub key and a tag never reach a provider. A held key and a kept login never reach a client. No hub key, held key, kept login or login reaches the request log or a log line. Replayed from every exchange.",
    () =>
      Effect.gen(function* () {
        const logs = yield* Harness.Logs;
        const all = yield* replays;
        const logged = logs.lines().join("\n");
        for (const replay of all) {
          const toProvider =
            JSON.stringify(replay.seen.headers) + textOf(replay.seen.body);
          const toClient =
            JSON.stringify(replay.answerHeaders) + textOf(replay.received);
          const toRequestLog = JSON.stringify(encodeRequest(replay.logged));
          for (const hubKey of [
            Harness.secrets.fleetHubKey,
            Harness.secrets.clientsHubKey,
          ]) {
            expect(toProvider, named(replay)).not.toContain(hubKey);
          }
          for (const held of [
            Harness.secrets.heldKey,
            Harness.secrets.keptLogin,
          ]) {
            expect(toClient, named(replay)).not.toContain(held);
          }
          for (const secret of [
            Harness.secrets.fleetHubKey,
            Harness.secrets.clientsHubKey,
            Harness.secrets.heldKey,
            Harness.secrets.keptLogin,
            ...credentialsOf(replay.exchange.request.headers),
          ]) {
            expect(toRequestLog, named(replay)).not.toContain(secret);
            expect(logged, named(replay)).not.toContain(secret);
          }
        }
      }),
  );

  it.effect(
    "R6: Every request the hub sends to a provider is recorded in the request log exactly once, whatever the outcome; a rejected request is not recorded. Replayed from every exchange.",
    () =>
      Effect.gen(function* () {
        const recorded = yield* Recorded;
        for (const replay of yield* replays) {
          expect(
            { reached: replay.reached, logged: replay.logged.id },
            named(replay),
          ).toEqual({ reached: 1, logged: replay.answeredAs });
        }
        yield* Effect.promise(() => Bun.sleep(50));
        expect(yield* recorded.drain).toEqual([]);
      }),
  );

  it.effect(
    "L1: For every JSON object a protocol can split, joining what it was split into gives the same JSON value. Replayed from every exchange.",
    () =>
      Effect.gen(function* () {
        const rebuildConversation = yield* RebuildConversation;
        for (const replay of yield* replays) {
          const body = Option.flatMap(
            asJson(
              yield* bodyOf(
                replay.sent,
                replay.exchange.request.headers["content-encoding"],
              ),
            ),
            asObject,
          );
          if (Option.isNone(body)) continue;
          const joined = Conversation.join(
            Conversation.split(rulesOf(replay.protocol), body.value),
          );
          expect(
            Option.exists(joined, (each) => Harness.sameJson(each, body.value)),
            named(replay),
          ).toBe(true);
          if (Option.isNone(replay.logged.conversation)) continue;
          const rebuilt = yield* rebuildConversation
            .execute(replay.logged.id)
            .pipe(Effect.orDie);
          expect(
            Option.exists(rebuilt, (each) =>
              Harness.sameJson(each, body.value),
            ),
            named(replay),
          ).toBe(true);
        }
      }),
  );

  it.effect(
    "L3: Every item stored is an element of a body the hub forwarded or was built from a response it relayed; a request whose body could not be read has no items, and says so by having no `request_items` row. Replayed from every exchange.",
    () =>
      Effect.gen(function* () {
        const memory = yield* InMemoryRequests;
        for (const replay of yield* replays) {
          const protocol = protocolOf(replay.protocol);
          const rules = protocol.conversation(
            protocol.describe({
              method: replay.exchange.request.method,
              path: pathOf(replay),
              headers: {},
              body: Option.none(),
            }),
          );
          const forwarded = Option.flatMap(
            asJson(
              yield* bodyOf(
                replay.seen.body,
                replay.exchange.request.headers["content-encoding"],
              ),
            ),
            asObject,
          );
          const readable = Option.isSome(rules) && Option.isSome(forwarded);
          expect(
            {
              conversation: Option.isSome(replay.logged.conversation),
              row: memory.requestItems.some(
                ({ requestId }) => requestId === replay.logged.id,
              ),
            },
            named(replay),
          ).toEqual({ conversation: readable, row: readable });
          if (Option.isNone(rules) || Option.isNone(forwarded)) continue;

          const output = yield* outputOf(
            replay,
            forwarded.value.stream === true,
          );
          const stored = memory.items.filter(
            ({ session, requestId }) =>
              session === replay.logged.session &&
              requestId === replay.logged.id,
          );
          for (const item of stored) {
            const content = Option.getOrThrow(asJson(item.content));
            const field = rules.value.parts.find(
              ({ part }) => part === item.part,
            )?.field;
            const value =
              field === undefined ? undefined : forwarded.value[field];
            const elements =
              item.part === "output"
                ? output
                : (Array.isArray(value) ? value : [value ?? null]).map(
                    (element) => Harness.without(element, rules.value.takenOut),
                  );
            expect(
              elements.some((element) => Harness.sameJson(element, content)),
              `${named(replay)}, ${item.part} ${item.position}`,
            ).toBe(true);
          }
        }
      }),
  );

  it.effect(
    "T10: For every request, the items its transcript's entries come from are, in order, exactly the items of its system, input and output parts, a run of one item repeated taken as one on either side, and no entry shows an item as its JSON but those the spec names. Replayed from every exchange.",
    () =>
      Effect.gen(function* () {
        const transcripts = yield* Transcripts;
        let rendered = 0;
        for (const replay of yield* replays) {
          if (Option.isNone(replay.logged.conversation)) continue;
          const conversation = replay.logged.conversation.value;
          const items = {
            system: conversation.system,
            input: conversation.input,
            output: conversation.output,
          };
          const entries = transcripts.entriesOf(
            replay.protocol,
            items,
            Number.MAX_SAFE_INTEGER,
          );
          const typeOf = (digest: Conversation.Digest) =>
            [...items.system, ...items.input, ...items.output].find(
              (item) => item.digest === digest,
            )?.type;
          const shownJson = entries.flatMap((entry) => {
            if (entry.kind === "other") return [`item ${typeOf(entry.item)}`];
            if (entry.kind !== "message") return [];
            return entry.parts.flatMap((part) =>
              part.type === "other"
                ? [
                    `block ${Option.getOrElse(
                      Option.flatMap(asJson(part.json), (json) =>
                        Transcript.stringAt(json, "type"),
                      ),
                      () => "",
                    )}`,
                  ]
                : [],
            );
          });
          const known = shownAsJson[replay.protocol];

          expect(
            runs(entries.map(({ part, item }) => `${part} ${item}`)),
            named(replay),
          ).toEqual(
            runs(
              Transcript.parts.flatMap((part) =>
                items[part].map(({ digest }) => `${part} ${digest}`),
              ),
            ),
          );
          expect(
            shownJson.filter(
              (each) =>
                !known.items.map((type) => `item ${type}`).includes(each) &&
                !known.blocks.map((type) => `block ${type}`).includes(each),
            ),
            named(replay),
          ).toEqual([]);
          for (const secret of [
            ...Object.values(Harness.secrets),
            ...credentialsOf(replay.exchange.request.headers),
          ]) {
            expect(JSON.stringify(entries), named(replay)).not.toContain(
              secret,
            );
          }
          rendered++;
        }
        expect(rendered).toBeGreaterThan(30);
      }),
  );
});
