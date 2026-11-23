import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Steps from "#modules/request-log/05-tests/antigravity-steps.ts";
import { InMemoryRequests } from "#modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
import { HubStore } from "#shared/04-infrastructure/hub-store/hub-store.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const keys = {
  fleet: { "x-cota-key": Harness.secrets.fleetHubKey },
  clients: { "x-cota-key": Harness.secrets.clientsHubKey },
  agents: { "x-cota-key": Harness.secrets.readerHubKey },
};

/** Two calls of one conversation, the second after the first, each naming a machine and a key in fields no report has. */
const callsOf = (session: string) => [
  {
    call: `${session}-1`,
    after: null,
    session,
    project: "garden",
    clientVersion: "1.4.0",
    model: "gemini-3-flash-preview",
    startedAt: "2026-11-11T09:00:00.000Z",
    finishedAt: "2026-11-11T09:00:04.000Z",
    outcome: "ok",
    errorType: "",
    errorMessage: "",
    stopReason: "STOP",
    providerRequestId: "",
    usage: {
      input: 1_200,
      cacheRead: 0,
      cacheWriteShort: 0,
      cacheWriteLong: 0,
      output: 80,
      reasoning: 20,
      reported: { promptTokenCount: 1_200 },
    },
    input: [Steps.userMessage(0, "Read the notes")],
    output: [Steps.modelOutput(1, { text: "They say hello." })],
    machine: "someone-elses-machine",
    hubKey: "agents",
  },
  {
    call: `${session}-2`,
    after: { call: `${session}-1`, startedAt: "2026-11-11T09:00:00.000Z" },
    session,
    project: "garden",
    clientVersion: "1.4.0",
    model: "gemini-3-flash-preview",
    startedAt: "2026-11-11T09:01:00.000Z",
    finishedAt: "2026-11-11T09:01:02.000Z",
    outcome: "ok",
    errorType: "",
    errorMessage: "",
    stopReason: "STOP",
    providerRequestId: "",
    usage: null,
    input: [Steps.userMessage(2, "Thanks")],
    output: [Steps.modelOutput(3, { text: "You are welcome." })],
    reportedBy: "owner",
  },
];

const reportOf = (session: string, changes: Record<string, unknown> = {}) => ({
  client: "antigravity",
  pool: "gemini",
  through: "2026-11-11T10:00:00.000Z",
  calls: callsOf(session),
  machine: "someone-elses-machine",
  hubKey: "clients",
  ...changes,
});

const sent = (
  report: unknown,
  caller: Record<string, string>,
  machine: string | null = "studio",
) =>
  Effect.gen(function* () {
    const response = yield* Harness.send("/api/reported-requests", {
      method: "POST",
      headers: {
        ...caller,
        ...(machine === null ? {} : { "x-cota-machine": machine }),
        "content-type": "application/json",
      },
      body: JSON.stringify(report),
    });
    const { status, body } = yield* Harness.problemOf(response);
    return {
      status,
      type:
        typeof body === "object" && body !== null && "type" in body
          ? body.type
          : undefined,
    };
  });

const reportedThroughRows = Effect.gen(function* () {
  const store = yield* HubStore;
  return yield* store.use((database) =>
    database.query("SELECT * FROM reported_through").all(),
  );
});

/** What the log and the hub store hold, as a refused report must leave them. */
const kept = Effect.gen(function* () {
  const memory = yield* InMemoryRequests;
  return {
    requests: memory.requests.map(({ request }) => request.id).sort(),
    requestItems: memory.requestItems.map(({ requestId }) => requestId).sort(),
    items: memory.items.length,
    reportedThrough: yield* reportedThroughRows.pipe(Effect.orDie),
  };
});

layer(Harness.layer())("POST /api/reported-requests", (it) => {
  it.effect(
    "L7: the stored requests' hub key is the caller's hub key's name, empty for the owner, and their machine the caller's x-cota-machine, whatever the body names",
    () =>
      Effect.gen(function* () {
        const { cookie } = yield* Harness.signIn();
        const callers = [
          ["fleet", keys.fleet, "fleet"],
          ["clients", keys.clients, "clients"],
          ["agents", keys.agents, "agents"],
          ["owner", { cookie }, ""],
        ] as const;
        const answers = [];
        for (const [name, caller] of callers) {
          answers.push(
            yield* sent(
              reportOf(`kept-as-${name}`),
              caller,
              `  ${name}-studio `,
            ),
          );
        }
        expect(answers).toEqual(
          callers.map(() => ({ status: 200, type: undefined })),
        );
        const memory = yield* InMemoryRequests;
        const stored = memory.requests
          .map(({ request }) => StoredItems.storedOf(request))
          .filter(({ session }) => session.startsWith("kept-as-"))
          .map(({ session, hubKey, machine }) => ({ session, hubKey, machine }))
          .sort((one, other) => one.session.localeCompare(other.session));
        expect(stored).toEqual(
          callers
            .flatMap(([name, , hubKey]) =>
              [1, 2].map(() => ({
                session: `kept-as-${name}`,
                hubKey,
                machine: `${name}-studio`,
              })),
            )
            .sort((one, other) => one.session.localeCompare(other.session)),
        );
      }),
  );

  it.effect(
    "answers how many calls it stored and how many the log already held",
    () =>
      Effect.gen(function* () {
        const first = yield* sent(reportOf("answered"), keys.fleet);
        const response = yield* Harness.send("/api/reported-requests", {
          method: "POST",
          headers: {
            ...keys.fleet,
            "x-cota-machine": "studio",
            "content-type": "application/json",
          },
          body: JSON.stringify(reportOf("answered")),
        });
        expect(first.status).toBe(200);
        expect(yield* Harness.problemOf(response)).toMatchObject({
          status: 200,
          body: { stored: 0, held: 2 },
        });
      }),
  );

  it.effect(
    "L11: a report answered with any problem but request-log-unavailable and hub-store-unavailable changes nothing in the log or the hub store",
    () =>
      Effect.gen(function* () {
        const before = yield* kept;
        const [first, second] = callsOf("refused");
        const answers = [
          yield* sent(reportOf("refused", { pool: "claude" }), keys.fleet),
          yield* sent(reportOf("refused", { pool: "nowhere" }), keys.fleet),
          yield* sent(reportOf("refused"), keys.fleet, null),
          yield* sent(reportOf("refused"), keys.fleet, " "),
          yield* sent(reportOf("refused", { calls: [second] }), keys.fleet),
          yield* sent(
            reportOf("refused", {
              calls: [
                first,
                { ...second, finishedAt: "2026-11-11T09:00:59.000Z" },
              ],
            }),
            keys.fleet,
          ),
          yield* sent(
            reportOf("refused", {
              calls: [first, { ...second, output: [] }],
            }),
            keys.fleet,
          ),
          yield* sent(
            reportOf("refused", { through: "2030-01-01T00:00:00.000Z" }),
            keys.fleet,
          ),
        ];
        expect(answers).toEqual([
          { status: 400, type: "urn:cota:pool-not-observed" },
          { status: 404, type: "urn:cota:no-such-pool" },
          { status: 400, type: "urn:cota:report-refused" },
          { status: 400, type: "urn:cota:report-refused" },
          { status: 409, type: "urn:cota:report-out-of-order" },
          { status: 400, type: "urn:cota:report-refused" },
          { status: 400, type: "urn:cota:report-refused" },
          { status: 400, type: "urn:cota:report-refused" },
        ]);
        expect(yield* kept).toEqual(before);
      }),
  );

  it.effect(
    "L15: a report naming a pool that is not observed stores nothing, whichever hub key sends it",
    () =>
      Effect.gen(function* () {
        const before = yield* kept;
        const pools = [
          "work",
          "open",
          "gone",
          "claude",
          "personal",
          "solo",
          "codex",
          "console",
        ];
        const answers = [];
        for (const pool of pools) {
          for (const caller of Object.values(keys)) {
            answers.push(
              yield* sent(reportOf(`not-observed-${pool}`, { pool }), caller),
            );
          }
        }
        expect(answers).toEqual(
          pools.flatMap(() =>
            Object.values(keys).map(() => ({
              status: 400,
              type: "urn:cota:pool-not-observed",
            })),
          ),
        );
        expect(yield* kept).toEqual(before);
      }),
  );

  it.effect(
    "keeps the greatest through a machine reported for a client and pool, with the latest report's time and reporter",
    () =>
      Effect.gen(function* () {
        for (const [through, caller] of [
          ["2026-11-11T10:00:00.000Z", keys.fleet],
          ["2026-11-11T09:00:00.000Z", keys.clients],
        ] as const) {
          expect(
            (yield* sent(
              { ...reportOf("through"), calls: [], through },
              caller,
              "through-machine",
            )).status,
          ).toBe(200);
        }
        const rows = yield* reportedThroughRows.pipe(Effect.orDie);
        expect(
          rows.filter(
            (row) =>
              typeof row === "object" &&
              row !== null &&
              "machine" in row &&
              row.machine === "through-machine",
          ),
        ).toEqual([
          {
            machine: "through-machine",
            client: "antigravity",
            pool: "gemini",
            through: "2026-11-11T10:00:00.000Z",
            reported_at: expect.any(String),
            reported_by: "clients",
          },
        ]);
      }),
  );

  it.effect("refuses a body over 64 MiB, and takes one over 1 MiB", () =>
    Effect.gen(function* () {
      const large = reportOf("large", {
        calls: [
          {
            ...callsOf("large")[0],
            input: [Steps.userMessage(0, "x".repeat(2 * 1024 * 1024))],
          },
        ],
      });
      expect(yield* sent(large, keys.fleet)).toEqual({
        status: 200,
        type: undefined,
      });
      const answer = yield* Harness.sendRaw(
        `POST /api/reported-requests HTTP/1.1\r\nhost: hub\r\nconnection: close\r\nx-cota-key: ${Harness.secrets.fleetHubKey}\r\nx-cota-machine: studio\r\ncontent-type: application/json\r\ncontent-length: ${64 * 1024 * 1024 + 1}\r\n\r\n{}`,
      );
      expect(answer.split(" ")[1]).toBe("413");
      expect(answer).toContain("urn:cota:body-too-large");
    }),
  );
});
