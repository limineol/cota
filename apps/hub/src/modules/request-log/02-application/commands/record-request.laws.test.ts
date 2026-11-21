import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Context,
  Effect,
  Exit,
  Layer,
  Metric,
  Option,
  Schema,
  Scope,
} from "effect";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import { RequestsRepository } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as RebuildConversation from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as InMemoryRequests from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as RecordRequest from "./record-request.command.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const turns = Arbitrary.array(
  Arbitrary.all({
    session: int(0, 2),
    said: Arbitrary.array(
      Arbitrary.schema(Schema.Literals(["hello", "hi", "again", "more"])),
      { minLength: 1, maxLength: 4 },
    ),
    bad: Arbitrary.schema(Schema.Boolean),
  }),
  { minLength: 1, maxLength: 12 },
);

const bodyOf = (said: ReadonlyArray<string>) => ({
  model: "claude-opus-5-5",
  system: "Be brief.",
  messages: said.map((content, at) => ({
    role: at % 2 === 0 ? "user" : "assistant",
    content,
  })),
});

const sentOf = (
  generated: ReadonlyArray<{
    readonly session: number;
    readonly said: ReadonlyArray<string>;
    readonly bad: boolean;
  }>,
) =>
  generated.map(({ session, said, bad }) => ({
    request: Harness.requestOf({
      session: `s${session}`,
      conversation: Harness.anthropicConversation(bodyOf(said)),
    }),
    body: bodyOf(said),
    bad,
  }));

const unpriced = Layer.succeed(Prices, Prices.of({ of: () => Option.none() }));

/** A writer over a closed in-memory repository, pausing for milliseconds and given a second to drain. */
const started = (batchSize: number) =>
  Effect.gen(function* () {
    const { memory, repository } = yield* InMemoryRequests.make(false);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      Layer.merge(
        RecordRequest.layer({
          ...RecordRequest.defaults,
          batchSize,
          firstPause: "1 millis",
          longestPause: "8 millis",
          drainTimeout: "1 second",
        }),
        RebuildConversation.layer,
      ).pipe(
        Layer.provide(Layer.succeed(RequestsRepository, repository)),
        Layer.provide(unpriced),
      ),
      scope,
    );
    return {
      memory,
      recordRequest: Context.get(context, RecordRequest.RecordRequest),
      rebuildConversation: Context.get(
        context,
        RebuildConversation.RebuildConversation,
      ),
      close: Scope.close(scope, Exit.void),
    };
  });

const droppedSoFar = Effect.map(
  Metric.value(RecordRequest.dropped),
  ({ count }) => Number(count),
);

describe("request log writer laws", () => {
  it.live.prop(
    "L5: When the repository declines every batch that holds certain requests and stores every other batch, each other request is stored once, with a body that comes back, and, once one of them is stored, each of those requests is dropped and counted once.",
    { turns, batchSize: int(1, 5) },
    (generated) =>
      Effect.gen(function* () {
        const sent = sentOf(generated.turns);
        if (sent.every(({ bad }) => bad)) return;
        const bad = new Set(
          sent.filter((each) => each.bad).map(({ request }) => request.id),
        );
        const writer = yield* started(generated.batchSize);
        writer.memory.declines = ({ request }) => bad.has(request.id);
        const before = yield* droppedSoFar;
        for (const { request } of sent) {
          yield* writer.recordRequest.execute(request);
        }
        yield* writer.memory.open;
        yield* writer.close;

        for (const { request, body, bad } of sent) {
          const stored = writer.memory.requests.filter(
            (each) => each.request.id === request.id,
          );
          expect(stored).toHaveLength(bad ? 0 : 1);
          if (bad) continue;
          const rebuilt = yield* writer.rebuildConversation
            .execute(request.id)
            .pipe(Effect.orDie);
          expect(
            Option.isSome(rebuilt) && Harness.sameJson(rebuilt.value, body),
          ).toBe(true);
        }
        expect((yield* droppedSoFar) - before).toBe(bad.size);
      }),
    { timeout: 30_000, arbitrary: { runs: 200 } },
  );

  it.live.prop(
    "L6: While the repository declines every batch, the writer drops no request for it, and once the repository stores batches again every request is stored once.",
    { turns, batchSize: int(1, 5), declined: int(0, 12) },
    (generated) =>
      Effect.gen(function* () {
        const sent = sentOf(generated.turns);
        const writer = yield* started(generated.batchSize);
        writer.memory.faults.push(
          ...Array<InMemoryRequests.Fault>(generated.declined).fill("declined"),
        );
        const before = yield* droppedSoFar;
        for (const { request } of sent) {
          yield* writer.recordRequest.execute(request);
        }
        yield* writer.memory.open;
        yield* Harness.waitUntil(
          () => writer.memory.requests.length >= sent.length,
        );
        yield* writer.close;

        expect(
          writer.memory.requests.map(({ request }) => request.id).sort(),
        ).toEqual(sent.map(({ request }) => request.id).sort());
        expect((yield* droppedSoFar) - before).toBe(0);
      }),
    { timeout: 30_000, arbitrary: { runs: 200 } },
  );
});
