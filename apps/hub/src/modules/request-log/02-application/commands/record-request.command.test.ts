import { describe, expect, it } from "@effect/vitest";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Metric,
  Option,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import { RequestsRepository } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as RebuildConversation from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as InMemoryRequests from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as RecordRequest from "./record-request.command.ts";

type Fault = InMemoryRequests.Fault;

const reach = (counted: () => number, count: number) =>
  Effect.gen(function* () {
    const reached = yield* Harness.waitUntil(() => counted() >= count);
    yield* Effect.promise(() => Bun.sleep(2));
    expect(reached && counted() === count, `${counted()} of ${count}`).toBe(
      true,
    );
  });

/** The in-memory repository, closed until the test opens it. */
const fakeRepository = Effect.gen(function* () {
  const { memory, repository } = yield* InMemoryRequests.make(false);
  return {
    state: memory,
    repository,
    open: memory.open,
    requestsReach: (count: number) =>
      reach(() => memory.requests.length, count),
    attemptsReach: (count: number) =>
      reach(() => memory.attempts.length, count),
  };
});

const pricedPool = Layer.succeed(
  Prices,
  Prices.of({
    of: (asked) =>
      PriceLists.priceOf(
        { prices: Option.some("anthropic"), ownPrices: {} },
        asked,
      ),
  }),
);

const recorderOf = (
  repository: RequestsRepository["Service"],
  options: Partial<RecordRequest.Options> = {},
  prices: Layer.Layer<Prices> = pricedPool,
) =>
  RecordRequest.layer({ ...RecordRequest.defaults, ...options }).pipe(
    Layer.provide(Layer.succeed(RequestsRepository, repository)),
    Layer.provide(prices),
  );

const started = (
  repository: RequestsRepository["Service"],
  options: Partial<RecordRequest.Options> = {},
  prices?: Layer.Layer<Prices>,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      recorderOf(repository, options, prices),
      scope,
    );
    return {
      recordRequest: Context.get(context, RecordRequest.RecordRequest),
      close: Scope.close(scope, Exit.void),
    };
  });

const bodyOf = (said: ReadonlyArray<string>) => ({
  model: "claude-opus-5-5",
  system: "Be brief.",
  messages: said.map((content, at) => ({
    role: at % 2 === 0 ? "user" : "assistant",
    content,
  })),
});

const turn = (session: string, said: ReadonlyArray<string>) =>
  Harness.requestOf({
    session,
    conversation: Harness.anthropicConversation(bodyOf(said)),
  });

const usage = (input: number, output: number) =>
  Option.some({
    tokens: {
      input,
      cacheRead: 0,
      cacheWriteShort: 0,
      cacheWriteLong: 0,
      output,
    },
    reasoning: 0,
    reported: `{"input_tokens":${input},"output_tokens":${output}}`,
  });

const droppedSoFar = Effect.map(
  Metric.value(RecordRequest.dropped),
  ({ count }) => Number(count),
);

describe("recording a request", () => {
  it.effect(
    "stores an item once per session across batches and writers, and asks the store about a session once",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        yield* fake.open;
        const first = yield* started(fake.repository);
        yield* first.recordRequest.execute(turn("one", ["hello"]));
        yield* fake.requestsReach(1);
        yield* first.recordRequest.execute(
          turn("one", ["hello", "hi", "again"]),
        );
        yield* first.recordRequest.execute(turn("two", ["hello"]));
        yield* first.close;

        const second = yield* started(fake.repository);
        yield* second.recordRequest.execute(
          turn("one", ["hello", "hi", "again", "x"]),
        );
        yield* fake.requestsReach(4);
        yield* second.recordRequest.execute(
          turn("one", ["hello", "hi", "again", "y"]),
        );
        yield* second.close;

        expect(fake.state.asked).toEqual([["one"], ["two"], ["one"]]);
        expect(
          fake.state.items.map(({ session, content }) => [session, content]),
        ).toEqual([
          ["one", '"Be brief."'],
          ["one", '{"content":"hello","role":"user"}'],
          ["one", '{"content":"hi","role":"assistant"}'],
          ["one", '{"content":"again","role":"user"}'],
          ["two", '"Be brief."'],
          ["two", '{"content":"hello","role":"user"}'],
          ["one", '{"content":"x","role":"assistant"}'],
          ["one", '{"content":"y","role":"assistant"}'],
        ]);
      }),
  );

  it.effect(
    "writes every item of a session it could not ask about, and asks again with the next batch",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        yield* fake.open;
        const first = yield* started(fake.repository);
        yield* first.recordRequest.execute(turn("s", ["hello"]));
        yield* first.close;

        fake.state.questionFails = true;
        const { recordRequest, close } = yield* started(fake.repository);
        yield* recordRequest.execute(turn("s", ["hello", "hi"]));
        yield* fake.requestsReach(2);
        fake.state.questionFails = false;
        yield* recordRequest.execute(turn("s", ["hello", "hi", "again"]));
        yield* close;

        expect(fake.state.asked).toEqual([["s"], ["s"], ["s"]]);
        expect(fake.state.items.map(({ content }) => content)).toEqual([
          '"Be brief."',
          '{"content":"hello","role":"user"}',
          '"Be brief."',
          '{"content":"hello","role":"user"}',
          '{"content":"hi","role":"assistant"}',
          '{"content":"again","role":"user"}',
        ]);
      }),
  );

  it.effect(
    "stores a batch's requests once when their insert was stored but answered with a failure",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.faults.push("lost");
        yield* fake.open;
        const { recordRequest, close } = yield* started(fake.repository);
        yield* recordRequest.execute(Harness.requestOf());
        yield* fake.attemptsReach(1);
        yield* TestClock.adjust("1 second");
        yield* fake.attemptsReach(2);
        yield* close;

        expect(fake.state.attempts.map(({ stored }) => stored)).toEqual([
          true,
          false,
        ]);
        expect(fake.state.requests).toHaveLength(1);
      }),
  );

  it.effect(
    "waits a second before trying a failed batch again, twice as long each time after, and never more than a minute",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.faults.push(...Array<Fault>(9).fill("unreached"));
        yield* fake.open;
        const { recordRequest, close } = yield* started(fake.repository);
        yield* recordRequest.execute(Harness.requestOf());
        for (const [tried, seconds] of [
          1, 2, 4, 8, 16, 32, 60, 60, 60,
        ].entries()) {
          yield* fake.attemptsReach(tried + 1);
          yield* TestClock.adjust(`${seconds - 1} seconds`);
          yield* fake.attemptsReach(tried + 1);
          yield* TestClock.adjust("1 second");
        }
        yield* fake.requestsReach(1);
        yield* close;
        expect(fake.state.attempts).toHaveLength(10);
      }),
  );

  it.effect(
    "writes the cost of a request with usage exactly, and none without usage or without a price",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        yield* fake.open;
        const { recordRequest, close } = yield* started(fake.repository);
        const opus = { model: "claude-opus-5-5" };
        yield* recordRequest.execute(
          Harness.requestOf({ ...opus, usage: usage(1_000_003, 7) }),
        );
        yield* recordRequest.execute(Harness.requestOf(opus));
        yield* recordRequest.execute(
          Harness.requestOf({ model: "claude-unknown-9", usage: usage(1, 1) }),
        );
        yield* close;

        expect(
          fake.state.requests.map(({ request, cost }) => [
            cost,
            Option.map(request.usage, ({ tokens }) => tokens.input),
          ]),
        ).toEqual([
          [Option.some(4_000_152_000_000n), Option.some(1_000_003)],
          [Option.none(), Option.none()],
          [Option.none(), Option.some(1)],
        ]);
      }),
  );

  it.effect(
    "loses only the request whose values it could not make, counts it, and writes the ones around it",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        yield* fake.open;
        const before = yield* droppedSoFar;
        const { recordRequest, close } = yield* started(
          fake.repository,
          {},
          Layer.succeed(
            Prices,
            Prices.of({
              of: ({ model }) => {
                if (model === "unpriceable") throw new TypeError("no price");
                return Option.none();
              },
            }),
          ),
        );
        for (const model of ["before", "unpriceable", "after"]) {
          yield* recordRequest.execute(
            Harness.requestOf({ model, usage: usage(1, 1) }),
          );
        }
        yield* fake.requestsReach(2);
        yield* recordRequest.execute(
          Harness.requestOf({ model: "next batch" }),
        );
        yield* close;

        expect(fake.state.requests.map(({ request }) => request.model)).toEqual(
          ["before", "after", "next batch"],
        );
        expect((yield* droppedSoFar) - before).toBe(1);
      }),
  );

  it.effect(
    "loses a request its repository cannot hold, counts it, and stores the ones around it",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.holds = ({ request }) => request.model !== "too big";
        yield* fake.open;
        const before = yield* droppedSoFar;
        const { recordRequest, close } = yield* started(fake.repository);
        for (const model of ["before", "too big", "after"]) {
          yield* recordRequest.execute(Harness.requestOf({ model }));
        }
        yield* close;

        expect(fake.state.requests.map(({ request }) => request.model)).toEqual(
          ["before", "after"],
        );
        expect((yield* droppedSoFar) - before).toBe(1);
      }),
  );

  it.effect(
    "drops the oldest request when its queue is full, and counts it",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        const { recordRequest, close } = yield* started(fake.repository, {
          capacity: 3,
        });
        const before = yield* droppedSoFar;
        for (const at of [1, 2, 3, 4, 5]) {
          yield* recordRequest.execute(Harness.requestOf({ model: `m${at}` }));
        }
        yield* fake.open;
        yield* close;

        expect(fake.state.requests.map(({ request }) => request.model)).toEqual(
          ["m3", "m4", "m5"],
        );
        expect((yield* droppedSoFar) - before).toBe(2);
      }),
  );

  it.effect(
    "writes what it was given before it closes, and drops what it is given after",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        const { recordRequest, close } = yield* started(fake.repository, {
          batchSize: 2,
        });
        for (const at of [1, 2, 3, 4, 5]) {
          yield* recordRequest.execute(Harness.requestOf({ model: `m${at}` }));
        }
        yield* fake.open;
        const before = yield* droppedSoFar;
        yield* close;
        yield* recordRequest.execute(Harness.requestOf({ model: "late" }));

        expect(fake.state.requests.map(({ request }) => request.model)).toEqual(
          ["m1", "m2", "m3", "m4", "m5"],
        );
        expect(fake.state.attempts).toHaveLength(3);
        expect((yield* droppedSoFar) - before).toBe(1);
      }),
  );

  it.effect(
    "gives up ten seconds into shutdown when the repository keeps failing, and counts what it lost",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.faults.push(...Array<Fault>(100).fill("unreached"));
        yield* fake.open;
        const { recordRequest, close } = yield* started(fake.repository, {
          batchSize: 2,
        });
        for (const at of [1, 2, 3]) {
          yield* recordRequest.execute(Harness.requestOf({ model: `m${at}` }));
        }
        yield* fake.attemptsReach(1);
        const before = yield* droppedSoFar;
        const closing = yield* Effect.forkChild(close);
        yield* TestClock.adjust("9 seconds");
        expect(closing.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(closing);

        expect(fake.state.requests).toEqual([]);
        expect((yield* droppedSoFar) - before).toBe(3);
      }),
  );
  it.effect(
    "stores a declined batch in parts, and drops nothing, when only the whole batch was declined",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.faults.push("declined");
        const before = yield* droppedSoFar;
        const { recordRequest, close } = yield* started(fake.repository);
        for (const at of [1, 2, 3, 4]) {
          yield* recordRequest.execute(Harness.requestOf({ model: `m${at}` }));
        }
        yield* fake.open;
        yield* close;

        expect(fake.state.requests.map(({ request }) => request.model)).toEqual(
          ["m1", "m2", "m3", "m4"],
        );
        expect(fake.state.attempts.map(({ stored }) => stored)).toEqual([
          false,
          true,
          true,
        ]);
        expect((yield* droppedSoFar) - before).toBe(0);
      }),
  );

  it.effect(
    "drops the one request its repository will not keep, once, and stores the ones around it once",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.declines = ({ request }) => request.model === "bad";
        const before = yield* droppedSoFar;
        const { recordRequest, close } = yield* started(fake.repository);
        for (const model of ["m1", "bad", "m3", "m4", "m5"]) {
          yield* recordRequest.execute(Harness.requestOf({ model }));
        }
        yield* fake.open;
        yield* close;

        expect(fake.state.requests.map(({ request }) => request.model)).toEqual(
          ["m1", "m3", "m4", "m5"],
        );
        expect((yield* droppedSoFar) - before).toBe(1);
      }),
  );

  it.effect(
    "keeps a request declined alone while nothing else is stored, and drops it once another request is stored",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.declines = ({ request }) => request.model === "bad";
        yield* fake.open;
        const before = yield* droppedSoFar;
        const { recordRequest, close } = yield* started(fake.repository);
        yield* recordRequest.execute(Harness.requestOf({ model: "bad" }));
        yield* fake.attemptsReach(1);
        for (const [tried, seconds] of [1, 2, 4, 8].entries()) {
          yield* TestClock.adjust(`${seconds} seconds`);
          yield* fake.attemptsReach(tried + 2);
        }
        expect((yield* droppedSoFar) - before).toBe(0);

        yield* recordRequest.execute(Harness.requestOf({ model: "good" }));
        yield* TestClock.adjust("16 seconds");
        yield* fake.requestsReach(1);
        yield* fake.attemptsReach(7);
        expect((yield* droppedSoFar) - before).toBe(1);
        yield* close;

        expect(fake.state.requests.map(({ request }) => request.model)).toEqual(
          ["good"],
        );
        expect((yield* droppedSoFar) - before).toBe(1);
      }),
  );

  it.effect(
    "drops nothing when its repository declines every batch for a while, and then stores each request once",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.faults.push(...Array<Fault>(6).fill("declined"));
        const before = yield* droppedSoFar;
        const { recordRequest, close } = yield* started(fake.repository);
        for (const at of [1, 2, 3]) {
          yield* recordRequest.execute(Harness.requestOf({ model: `m${at}` }));
        }
        yield* fake.open;
        yield* fake.attemptsReach(5);
        yield* TestClock.adjust("1 second");
        yield* fake.attemptsReach(6);
        yield* TestClock.adjust("2 seconds");
        yield* fake.requestsReach(3);
        yield* close;

        expect(
          fake.state.requests.map(({ request }) => request.model).sort(),
        ).toEqual(["m1", "m2", "m3"]);
        expect((yield* droppedSoFar) - before).toBe(0);
      }),
  );

  it.effect(
    "gives back the body of a request stored after one of its session that was set aside",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        const earlier = turn("s", ["hello"]);
        const later = turn("s", ["hello", "hi", "again"]);
        fake.state.declines = ({ request }) => request.id === earlier.id;
        const { recordRequest, close } = yield* started(fake.repository);
        yield* recordRequest.execute(earlier);
        yield* recordRequest.execute(later);
        yield* fake.open;
        yield* close;

        const rebuilt = yield* Effect.gen(function* () {
          const rebuild = yield* RebuildConversation.RebuildConversation;
          return yield* rebuild.execute(later.id);
        }).pipe(
          Effect.provide(RebuildConversation.layer),
          Effect.provideService(RequestsRepository, fake.repository),
        );
        expect(fake.state.requests.map(({ request }) => request.id)).toEqual([
          later.id,
        ]);
        expect(
          Option.isSome(rebuilt) &&
            Harness.sameJson(rebuilt.value, bodyOf(["hello", "hi", "again"])),
        ).toBe(true);
      }),
  );

  it.effect(
    "drops and counts a request still set aside when it shuts down",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeRepository;
        fake.state.declines = ({ request }) => request.model === "bad";
        yield* fake.open;
        const { recordRequest, close } = yield* started(fake.repository);
        yield* recordRequest.execute(Harness.requestOf({ model: "bad" }));
        yield* fake.attemptsReach(1);
        const before = yield* droppedSoFar;
        const closing = yield* Effect.forkChild(close);
        yield* TestClock.adjust("10 seconds");
        yield* Fiber.join(closing);

        expect(fake.state.requests).toEqual([]);
        expect((yield* droppedSoFar) - before).toBe(1);
      }),
  );
});
