import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, layer } from "@effect/vitest";
import {
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import type * as ExchangeFile from "#modules/recording/03-domain/exchange-file.ts";
import * as Generated from "#modules/recording/05-tests/generated.ts";
import * as Recording from "#modules/recording/module.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as Replay from "#shared/05-tests/replay/replay.ts";
import * as RecordExchange from "./record-exchange.command.ts";

const directories: Array<string> = [];
const freshDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "cota-recorder-"));
  directories.push(directory);
  return directory;
};
afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const decodeExchangeFile = Schema.decodeUnknownSync(
  Schema.fromJsonString(Replay.ExchangeFile),
);

const filesIn = (directory: string) => readdirSync(directory).sort();

const exchangeFilesIn = (directory: string) =>
  filesIn(directory).filter((name) => name.endsWith(".json"));

/** Waits for the next `count` exchange files after `seen` to be written, and gives their names. */
const written = (
  directory: string,
  seen: ReadonlyArray<string>,
  count: number,
) =>
  Effect.gen(function* () {
    const fresh = () =>
      exchangeFilesIn(directory).filter((name) => !seen.includes(name));
    yield* Harness.waitUntil(() => fresh().length >= count);
    yield* Effect.promise(() => Bun.sleep(10));
    return fresh();
  });

const withoutHubKey = (
  exchange: ExchangeFile.Exchange,
): ExchangeFile.Exchange => ({
  ...exchange,
  request: {
    ...exchange.request,
    headers: Object.fromEntries(
      Object.entries(exchange.request.headers).filter(
        ([name]) => name !== "x-cota-key",
      ),
    ),
  },
});

const generated = (seed: number, protocol: number) => {
  const each = Generated.exchanges(seed)[protocol];
  if (each === undefined) throw new Error("no such protocol");
  return Generated.loaded(
    each.protocol,
    Generated.asExchangeFile(withoutHubKey(each.exchange)),
  );
};

const recorderOn = (directory: string, limit = RecordExchange.defaults.limit) =>
  Harness.sabotageableRecorder({
    ...RecordExchange.defaults,
    directory,
    limit,
    patience: "1 second",
  });

const madeUpLogin = "sk-ant-oat01-made-up-login-zebra-0042";

/** Checks that no marked string, made-up login or hub secret is in the named files, nor in their names. */
const expectNothingReal = (directory: string, names: ReadonlyArray<string>) => {
  const text = names
    .map((name) => readFileSync(join(directory, name), "utf8"))
    .join("\n");
  const readable = `${names.join("\n")}\n${Generated.readable(text)}`;
  expect(
    readable.match(
      new RegExp(`.{0,40}${Generated.marker.source}.{0,40}`, "is"),
    )?.[0],
  ).toBeUndefined();
  for (const secret of [...Object.values(Harness.secrets), madeUpLogin]) {
    expect(readable).not.toContain(secret);
  }
};

const anthropicAnswer: FakeProvider.Script = {
  headers: [["content-type", "application/json"]],
  chunks: [
    '{"id":"msg_zebra1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":"zebra crossing"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":1}}',
  ],
};

const recordings = freshDirectory();

layer(
  Harness.layer({
    relay: "copy_capacity = 4096",
    recorder: recorderOn(recordings),
  }),
)("the recorder", (it) => {
  it.effect(
    "records an exchange of each protocol as a file that replays, in every chunking, as the exchange did, and holds nothing real",
    () =>
      Effect.gen(function* () {
        Harness.sabotageRecorder("on");
        for (const seed of [11, 12, 13, 14]) {
          for (const { protocol, exchange } of Generated.exchanges(seed)) {
            const seen = exchangeFilesIn(recordings);
            const sent = yield* Replay.replay(
              Generated.loaded(
                protocol,
                Generated.asExchangeFile(withoutHubKey(exchange)),
              ),
              "whole",
            );
            const [name, ...more] = yield* written(recordings, seen, 1);
            const what = `${protocol}, seed ${seed}`;
            expect(more, what).toEqual([]);
            expectNothingReal(recordings, [name ?? ""]);
            expect(name, what).toMatch(
              new RegExp(
                `^20261112T\\d{6}\\.\\d{3}Z-${protocol}-[a-z0-9_-]+-${sent.logged.outcome}-[a-z0-9_-]+\\.json$`,
              ),
            );
            const recorded = decodeExchangeFile(
              readFileSync(join(recordings, name ?? ""), "utf8"),
            );
            expect(recorded.source, what).toMatchObject({ kind: "recorded" });
            expect(recorded.expects, what).toEqual({ logged: null });
            Harness.sabotageRecorder("off");
            const replays = [];
            for (const chunking of Replay.chunkings) {
              replays.push(
                yield* Replay.replay(
                  Generated.loaded(protocol, recorded),
                  chunking,
                ),
              );
            }
            Harness.sabotageRecorder("on");
            for (const replay of replays) {
              expect(
                {
                  body: replay.seen.body,
                  status: replay.status,
                  received: replay.received,
                },
                `${what}, ${replay.chunking}`,
              ).toEqual({
                body:
                  recorded.request.body === undefined
                    ? new Uint8Array()
                    : replay.sent,
                status: recorded.response.status,
                received: replay.served,
              });
              expect(
                Replay.expectationOf(replay.logged),
                `${what}, ${replay.chunking}`,
              ).toEqual(
                Replay.expectationOf(replays[0]?.logged ?? sent.logged),
              );
              expect(
                Generated.shapeOf(replay.logged),
                `${what}, ${replay.chunking}`,
              ).toEqual(Generated.shapeOf(sent.logged));
            }
          }
        }
        expect(
          filesIn(recordings).filter((name) => !name.endsWith(".json")),
        ).toEqual([]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => Harness.sabotageRecorder("off"))),
      ),
    60_000,
  );

  it.effect(
    "records a refusal and the divert that follows it as two exchange files, with nothing real in either",
    () =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        Harness.sabotageRecorder("on");
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer((seen) =>
          Harness.poolOf(seen) === "claude"
            ? Harness.refusal(Option.none())
            : anthropicAnswer,
        );
        const seen = exchangeFilesIn(recordings);
        const response = yield* Harness.send("/pools/claude/v1/messages", {
          method: "POST",
          headers: {
            "x-cota-key": Harness.secrets.clientsHubKey,
            authorization: `Bearer ${madeUpLogin}`,
            "content-type": "application/json",
          },
          body: '{"model":"claude-opus-5-5","max_tokens":1024,"messages":[{"role":"user","content":"zebra"}]}',
        });
        yield* Harness.textOf(response);
        const names = yield* written(recordings, seen, 2);
        expect(names.filter((name) => name.includes("-refused-"))).toHaveLength(
          1,
        );
        expect(names.filter((name) => name.includes("-ok-"))).toHaveLength(1);
        expect(names).toHaveLength(2);
        expectNothingReal(recordings, names);
        yield* Harness.recorded(2);
        Harness.sabotageRecorder("off");
        const outcomes = [];
        for (const name of names) {
          const replayed = yield* Replay.replay(
            Generated.loaded(
              "anthropic-messages",
              decodeExchangeFile(readFileSync(join(recordings, name), "utf8")),
            ),
            "whole",
          );
          outcomes.push(replayed.logged.outcome);
        }
        expect(outcomes.sort()).toEqual(["ok", "refused"]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => Harness.sabotageRecorder("off"))),
      ),
  );

  it.effect(
    "records a hub key sent in x-api-key as a fake, and the held key nowhere",
    () =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        Harness.sabotageRecorder("on");
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer(anthropicAnswer);
        const seen = exchangeFilesIn(recordings);
        const response = yield* Harness.send("/pools/console/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": Harness.secrets.fleetHubKey,
            "content-type": "application/json",
          },
          body: '{"model":"claude-opus-5-5","max_tokens":1024,"messages":[{"role":"user","content":"zebra"}]}',
        });
        yield* Harness.textOf(response);
        expect(Harness.credentialsOf(fake.last())).toEqual([
          ["x-api-key", Harness.secrets.consoleKey],
        ]);
        const names = yield* written(recordings, seen, 1);
        expect(names).toHaveLength(1);
        expectNothingReal(recordings, names);
        const recorded = decodeExchangeFile(
          readFileSync(join(recordings, names[0] ?? ""), "utf8"),
        );
        expect(recorded.request.headers["x-api-key"]).toMatch(
          /^sk-ant-oat01-FAKE-login-for-tests-only-\d+$/,
        );
        yield* Harness.recorded(1);
      }).pipe(
        Effect.ensuring(Effect.sync(() => Harness.sabotageRecorder("off"))),
      ),
  );

  it.effect("writes nothing when it is off", () =>
    Effect.gen(function* () {
      yield* Harness.forgetEverything;
      Harness.sabotageRecorder("off");
      const seen = filesIn(recordings);
      yield* Replay.replay(generated(21, 0), "whole");
      yield* Effect.promise(() => Bun.sleep(50));
      expect(filesIn(recordings)).toEqual(seen);
    }),
  );

  it.effect(
    "leaves the logged request as it is without the recorder, whether the recorder keeps up, falls behind, fails or hangs",
    () =>
      Effect.gen(function* () {
        yield* Harness.forgetEverything;
        const loaded = generated(31, 1);
        Harness.sabotageRecorder("off");
        const alone = yield* Replay.replay(loaded, "by event");
        for (const kind of ["on", "slow", "fail", "hang"] as const) {
          Harness.sabotageRecorder(kind);
          const replayed = yield* Replay.replay(loaded, "by event");
          expect(
            {
              status: replayed.status,
              received: replayed.received,
              logged: Replay.expectationOf(replayed.logged),
            },
            kind,
          ).toEqual({
            status: alone.status,
            received: alone.received,
            logged: Replay.expectationOf(alone.logged),
          });
        }
        for (let step = 0; step < 3; step++) {
          yield* TestClock.adjust("1 second");
          yield* Effect.promise(() => Bun.sleep(5));
        }
        yield* Harness.waitUntil(() =>
          filesIn(recordings).every((name) => name.endsWith(".json")),
        );
      }).pipe(
        Effect.ensuring(Effect.sync(() => Harness.sabotageRecorder("off"))),
      ),
  );
});

const small = freshDirectory();

layer(
  Harness.layer({
    relay: "copy_capacity = 4096",
    recorder: recorderOn(small, 600),
  }),
)("a recorder with a small limit", (it) => {
  it.effect(
    "skips an exchange whose request or response is over its limit, and says so",
    () =>
      Effect.gen(function* () {
        Harness.sabotageRecorder("on");
        const fake = yield* FakeProvider.FakeProvider;
        const logs = yield* Harness.Logs;
        const send = (body: string) =>
          Effect.gen(function* () {
            yield* Harness.forgetEverything;
            const response = yield* Harness.send(
              "/pools/work/chat/completions",
              {
                method: "POST",
                headers: {
                  "x-cota-key": Harness.secrets.fleetHubKey,
                  "content-type": "application/json",
                },
                body,
              },
            );
            yield* Harness.textOf(response);
            yield* Harness.recorded(1);
            yield* Harness.waitUntil(() =>
              logs
                .lines()
                .some((line) => line.includes("exchange not recorded")),
            );
            return logs
              .lines()
              .filter((line) => line.includes("exchange not recorded"));
          });
        const answer = (content: string): FakeProvider.Script => ({
          headers: [["content-type", "application/json"]],
          chunks: [
            JSON.stringify({
              id: "chatcmpl-1",
              object: "chat.completion",
              model: "glm-5.2",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content },
                  finish_reason: "stop",
                },
              ],
            }),
          ],
        });
        fake.answer(answer("zebra ".repeat(200)));
        const overResponse = yield* send(
          '{"model":"glm-5.2","messages":[{"role":"user","content":"hi"}]}',
        );
        fake.answer(answer("hi"));
        const overRequest = yield* send(
          JSON.stringify({
            model: "glm-5.2",
            messages: [{ role: "user", content: "zebra ".repeat(200) }],
          }),
        );
        expect(overResponse).toHaveLength(1);
        expect(overResponse[0]).toContain(
          "the response is over the recorder's limit of 600 bytes",
        );
        expect(overRequest).toHaveLength(1);
        expect(overRequest[0]).toContain(
          "the request body is over the recorder's limit of 600 bytes",
        );
        expect(overResponse[0]).not.toMatch(Generated.marker);
        expect(filesIn(small)).toEqual([]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => Harness.sabotageRecorder("off"))),
      ),
  );
});

describe("the recorder's switch", () => {
  const request: RecordExchange.Request = {
    id: Request.RequestId.make("0193a8b0-0000-7000-8000-000000000001"),
    startedAt: Harness.start,
    protocol: "openai-chat",
    operation: "chat",
    method: "POST",
    target: "/chat/completions",
    headers: {},
    body: Option.none(),
    decodedBody: Option.none(),
    requestBytes: 0,
  };
  const begun = (environment: Record<string, string>) => {
    const lines: Array<string> = [];
    return Effect.gen(function* () {
      const recordExchange = yield* RecordExchange.RecordExchange;
      const recording = yield* recordExchange.execute(request);
      return { on: Option.isSome(recording), lines };
    }).pipe(
      Effect.provide(
        Recording.fromEnvironment.pipe(
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromEnvRecord(environment)),
          ),
          Layer.provide(
            Logger.layer([
              Logger.map(Logger.formatJson, (line) => {
                lines.push(line);
              }),
            ]),
          ),
        ),
      ),
    );
  };

  it.effect(
    "is off unless COTA_RECORD_TO names a directory, and warns once when it is on",
    () =>
      Effect.gen(function* () {
        expect(yield* begun({})).toEqual({ on: false, lines: [] });
        expect(yield* begun({ COTA_RECORD_TO: "  " })).toEqual({
          on: false,
          lines: [],
        });
        const directory = join(freshDirectory(), "made");
        const on = yield* begun({ COTA_RECORD_TO: directory });
        expect(on.on).toBe(true);
        expect(on.lines).toHaveLength(1);
        expect(on.lines[0]).toContain("recording every exchange");
        expect(on.lines[0]).toContain('"level":"WARN"');
        expect(filesIn(directory)).toEqual([]);
      }),
  );
});

describe("the hub's shutdown", () => {
  it.effect("waits for a recording that is still being written", () =>
    Effect.gen(function* () {
      const directory = freshDirectory();
      const hub = Harness.layer({
        relay: "copy_capacity = 4096",
        recorder: recorderOn(directory),
      });
      Harness.sabotageRecorder("slow");
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(hub, scope);
      yield* Replay.replay(generated(41, 0), "every 7 bytes").pipe(
        Effect.provide(context),
      );
      expect(exchangeFilesIn(directory)).toEqual([]);
      yield* Scope.close(scope, Exit.void);
      expect(exchangeFilesIn(directory)).toHaveLength(1);
    }).pipe(
      Effect.ensuring(Effect.sync(() => Harness.sabotageRecorder("off"))),
    ),
  );
});
