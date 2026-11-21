import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, layer } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Option, Schema } from "effect";
import { HttpApi } from "effect/http-api";
import { Api } from "#api.ts";
import { RemoveDisplayName } from "#modules/display-names/02-application/commands/remove-display-name.command.ts";
import { SetDisplayName } from "#modules/display-names/02-application/commands/set-display-name.command.ts";
import { ListDisplayNames } from "#modules/display-names/02-application/queries/list-display-names.query.ts";
import * as BuiltInNames from "#modules/display-names/03-domain/built-in-names.ts";
import {
  type DisplayName,
  Kind,
} from "#modules/display-names/03-domain/display-name.ts";
import * as SqliteDisplayNames from "#modules/display-names/04-infrastructure/persistence/sqlite/sqlite-display-names.repository.ts";
import * as InMemoryDisplayNames from "#modules/display-names/05-tests/fakes/in-memory-display-names.repository.ts";
import * as DisplayNamesModule from "#modules/display-names/module.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-display-names-laws-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let stores = 0;
const freshPath = () => {
  stores += 1;
  return join(scratch, `${stores}.sqlite`);
};

const models = new Map([
  ["claude-fable-5", "Claude Fable 5"],
  ["glm-5", "GLM-5"],
]);

/** Keys the built-in names have, of a client and of models, beside keys none has; `codex` is both a client and a project. */
const keys = [
  "work",
  "codex",
  "claude-code",
  "claude-fable-5",
  "glm-5",
  "acme/cota",
  "café ☕",
] as const;

const Op = Schema.Union([
  Schema.TaggedStruct("Set", {
    kind: Kind,
    key: Schema.Literals(keys),
    /** `itsKey` names the key itself, which removes the owner's name. */
    name: Schema.Literals(["Work", "Fable", "x", "itsKey"]),
  }),
  Schema.TaggedStruct("Remove", { kind: Kind, key: Schema.Literals(keys) }),
]);
type Op = typeof Op.Type;

const sequences = Arbitrary.array(Arbitrary.schema(Op), { maxLength: 30 });

const idOf = (kind: string, key: string) => JSON.stringify([kind, key]);

const apply = (op: Op) =>
  Effect.gen(function* () {
    if (op._tag === "Remove") {
      yield* (yield* RemoveDisplayName)
        .execute(op.kind, op.key)
        .pipe(Effect.catchTag("NoSuchDisplayName", () => Effect.void));
      return;
    }
    yield* (yield* SetDisplayName).execute({
      kind: op.kind,
      key: op.key,
      name: op.name === "itsKey" ? op.key : op.name,
    });
  });

/** What the owner's names should be after the ops: the last set of each key, or none when it was last removed. */
const expectedOwnerNames = (ops: ReadonlyArray<Op>) => {
  const names = new Map<string, readonly [string, string, string]>();
  for (const op of ops) {
    const id = idOf(op.kind, op.key);
    if (op._tag === "Remove" || op.name === "itsKey") names.delete(id);
    else names.set(id, [op.kind, op.key, op.name]);
  }
  return [...names.values()].sort();
};

const run = (ops: ReadonlyArray<Op>) =>
  Effect.gen(function* () {
    for (const op of ops) yield* apply(op);
    return yield* (yield* ListDisplayNames).execute.pipe(Effect.orDie);
  });

const ownerNamesIn = (names: ReadonlyArray<DisplayName>) =>
  names
    .filter(({ source }) => source === "owner")
    .map(({ kind, key, name }) => [kind, key, name] as const)
    .sort();

const inMemory = DisplayNamesModule.overRepository({ models }).pipe(
  Layer.provideMerge(BuiltInNames.layer(models)),
  Layer.provide(InMemoryDisplayNames.layer),
);

const inSqlite = (path: string) =>
  DisplayNamesModule.overRepository({ models }).pipe(
    Layer.provide(SqliteDisplayNames.layer),
    Layer.provide(HubStore.layer({ path, steps: SqliteDisplayNames.steps })),
    Layer.orDie,
  );

const runs = { arbitrary: { runs: 200 } };

describe("display names laws", () => {
  it.effect.prop(
    "D1: after any sequence of sets and removals, a key's owner name is the one last set, or none when it was last removed, in memory and in SQLite",
    { ops: sequences },
    ({ ops }) =>
      Effect.gen(function* () {
        const expected = expectedOwnerNames(ops);
        const memory = yield* run(ops).pipe(Effect.provide(inMemory));
        const sqlite = yield* run(ops).pipe(
          Effect.provide(inSqlite(freshPath())),
        );
        expect([ownerNamesIn(memory), ownerNamesIn(sqlite)]).toEqual([
          expected,
          expected,
        ]);
      }),
    runs,
  );

  it.effect(
    "D1: a key's owner name is the one last set, for a key named twice, in memory and in SQLite",
    () =>
      Effect.gen(function* () {
        const ops: ReadonlyArray<Op> = [
          { _tag: "Set", kind: "pool", key: "work", name: "Work" },
          { _tag: "Set", kind: "pool", key: "work", name: "x" },
        ];
        const memory = yield* run(ops).pipe(Effect.provide(inMemory));
        const sqlite = yield* run(ops).pipe(
          Effect.provide(inSqlite(freshPath())),
        );
        expect([ownerNamesIn(memory), ownerNamesIn(sqlite)]).toEqual([
          [["pool", "work", "x"]],
          [["pool", "work", "x"]],
        ]);
      }),
  );

  it.effect(
    "D1: removing a key's owner name leaves the other names of its kind, and a name equal to its key removes the owner's, in memory and in SQLite",
    () =>
      Effect.gen(function* () {
        const ops: ReadonlyArray<Op> = [
          { _tag: "Set", kind: "pool", key: "work", name: "Work" },
          { _tag: "Set", kind: "pool", key: "codex", name: "x" },
          { _tag: "Set", kind: "pool", key: "glm-5", name: "Fable" },
          { _tag: "Remove", kind: "pool", key: "codex" },
          { _tag: "Set", kind: "pool", key: "glm-5", name: "itsKey" },
        ];
        const memory = yield* run(ops).pipe(Effect.provide(inMemory));
        const sqlite = yield* run(ops).pipe(
          Effect.provide(inSqlite(freshPath())),
        );
        expect([ownerNamesIn(memory), ownerNamesIn(sqlite)]).toEqual([
          [["pool", "work", "Work"]],
          [["pool", "work", "Work"]],
        ]);
      }),
  );

  it.effect(
    "D2: a model keeps its built-in name while another model has an owner name",
    () =>
      Effect.gen(function* () {
        const names = yield* run([
          { _tag: "Set", kind: "model", key: "claude-fable-5", name: "Fable" },
        ]);
        expect(
          names
            .filter(({ kind }) => kind === "model")
            .map(({ key, name, source }) => [key, name, source])
            .sort(),
        ).toEqual([
          ["claude-fable-5", "Fable", "owner"],
          ["glm-5", "GLM-5", "built-in"],
        ]);
      }).pipe(Effect.provide(inMemory)),
  );

  it.effect.prop(
    "D2: removing an owner name makes the key show its built-in name again, or none",
    {
      ops: sequences,
      removed: Arbitrary.schema(Op),
    },
    ({ ops, removed }) =>
      Effect.gen(function* () {
        const removal: Op =
          removed._tag === "Remove" ? removed : { ...removed, name: "itsKey" };
        const names = yield* run([...ops, removal]);
        const builtIn = yield* BuiltInNames.BuiltInNames;
        expect(
          names.filter(
            ({ kind, key }) => kind === removal.kind && key === removal.key,
          ),
        ).toEqual(Option.toArray(builtIn.of(removal.kind, removal.key)));
      }).pipe(Effect.provide(inMemory)),
    runs,
  );

  it.effect(
    "D4: a model with an owner name is listed once, under that name",
    () =>
      Effect.gen(function* () {
        const names = yield* run([
          { _tag: "Set", kind: "model", key: "glm-5", name: "x" },
        ]);
        expect(
          names
            .filter(({ kind, key }) => kind === "model" && key === "glm-5")
            .map(({ name, source }) => [name, source]),
        ).toEqual([["x", "owner"]]);
      }).pipe(Effect.provide(inMemory)),
  );

  it.effect.prop(
    "D4: the list never holds two names for the same kind and key",
    { ops: sequences },
    ({ ops }) =>
      Effect.gen(function* () {
        const names = yield* run(ops);
        const ids = names.map(({ kind, key }) => idOf(kind, key));
        expect(ids.length).toBe(new Set(ids).size);
      }).pipe(Effect.provide(inMemory)),
    runs,
  );
});

const readingPaths: ReadonlyArray<string> = (() => {
  const paths: Array<string> = [];
  HttpApi.reflect(Api, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      if (
        endpoint.method === "GET" &&
        endpoint.path !== "/api/display-names" &&
        endpoint.path !== "/api/machine"
      ) {
        paths.push(endpoint.path);
      }
    },
  });
  return paths;
})();

/** Each reading endpoint's query, so that it reads the request the test sends. */
const window = "from=2026-11-11T00:00:00Z&to=2026-11-13T00:00:00Z";
const queries: Readonly<Record<string, string>> = {
  "/api/overview": `?${window}`,
  "/api/series": `?${window}`,
  "/api/breakdown": `?${window}&by=model`,
  "/api/facets": `?${window}`,
  "/api/errors": `?${window}`,
  "/api/sessions": `?${window}`,
  "/api/search": `?${window}&q=pools`,
};

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };

const chat = Effect.gen(function* () {
  const fake = yield* FakeProvider.FakeProvider;
  fake.answer({
    headers: [["content-type", "application/json"]],
    chunks: [
      JSON.stringify({
        id: "chatcmpl-1",
        model: "glm-5",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Done." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    ],
  });
  yield* Harness.send("/pools/work/chat/completions", {
    method: "POST",
    headers: {
      ...fleet,
      "content-type": "application/json",
      "x-session-affinity": "session-1",
      "x-cota-machine": "workstation",
      "x-cota-project": "acme/cota",
      "user-agent": "opencode/1.2.3",
    },
    body: JSON.stringify({
      model: "glm-5",
      messages: [{ role: "user", content: "Rename the pools." }],
    }),
  }).pipe(Effect.andThen(Harness.textOf));
  yield* Harness.recorded(1);
});

let chatted = false;

layer(Harness.layer())("display names laws through the hub", (it) => {
  it.effect.prop(
    "D3: setting or removing display names changes no answer of any reading endpoint but GET /api/display-names and GET /api/machine",
    {
      ops: Arbitrary.array(Arbitrary.schema(Op), {
        minLength: 1,
        maxLength: 8,
      }),
    },
    ({ ops }) =>
      Effect.gen(function* () {
        if (!chatted) {
          yield* chat;
          chatted = true;
        }
        const owner = yield* Harness.signIn();
        const detail: {
          readonly requests: ReadonlyArray<{ readonly id: string }>;
        } = JSON.parse(
          yield* Harness.textOf(
            yield* Harness.send("/api/sessions/session-1", { headers: owner }),
          ),
        );
        const request = detail.requests[0]?.id ?? "";
        expect(request).not.toBe("");
        const paths = readingPaths.map(
          (path) =>
            path
              .replace(":session", "session-1")
              .replace(":id", request)
              .replaceAll(/:\w+/g, "unknown") + (queries[path] ?? ""),
        );
        const answers = Effect.gen(function* () {
          const all: Array<readonly [string, number, string]> = [];
          for (const path of paths) {
            const answer = yield* Harness.send(path, { headers: owner });
            all.push([path, answer.status, yield* Harness.textOf(answer)]);
          }
          return all;
        });
        const before = yield* answers;
        for (const op of ops) {
          const path = `/api/display-names/${op.kind}/${encodeURIComponent(op.key)}`;
          yield* Harness.send(
            path,
            op._tag === "Remove"
              ? { method: "DELETE", headers: owner }
              : {
                  method: "PUT",
                  headers: { ...owner, "content-type": "application/json" },
                  body: JSON.stringify({
                    name: op.name === "itsKey" ? op.key : op.name,
                  }),
                },
          ).pipe(Effect.andThen(Harness.textOf));
        }
        expect(yield* answers).toEqual(before);
      }),
    { timeout: 60_000, arbitrary: { runs: 20 } },
  );
});
