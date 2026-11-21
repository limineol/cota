import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { compareText } from "#shared/03-domain/text.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const pathOf = (kind: string, key: string) =>
  `/api/display-names/${kind}/${encodeURIComponent(key)}`;

const put = (kind: string, key: string, name: string) =>
  Effect.gen(function* () {
    const owner = yield* Harness.signIn();
    const answer = yield* Harness.send(pathOf(kind, key), {
      method: "PUT",
      headers: { ...owner, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return {
      status: answer.status,
      body: JSON.parse(yield* Harness.textOf(answer)),
    };
  });

const remove = (kind: string, key: string) =>
  Effect.gen(function* () {
    const owner = yield* Harness.signIn();
    return yield* Harness.send(pathOf(kind, key), {
      method: "DELETE",
      headers: owner,
    });
  });

const listed = Effect.gen(function* () {
  const client = yield* Harness.api(reader);
  return (yield* client["display-names"].list()).names;
});

const ownersIn = Effect.map(listed, (names) =>
  names.filter(({ source }) => source === "owner"),
);

layer(Harness.layer())("the display-names group", (it) => {
  it.effect(
    "gives a reader key the clients' names and the names models.dev gives the shipped models, by kind, then key",
    () =>
      Effect.gen(function* () {
        const names = yield* listed;
        expect(names.slice(0, 4)).toEqual([
          {
            kind: "client",
            key: "claude-code",
            name: "Claude Code",
            source: "built-in",
          },
          { kind: "client", key: "codex", name: "Codex", source: "built-in" },
          {
            kind: "client",
            key: "opencode",
            name: "OpenCode",
            source: "built-in",
          },
          { kind: "client", key: "pi", name: "Pi", source: "built-in" },
        ]);
        expect(
          names.filter(
            ({ key }) => key === "claude-fable-5" || key === "glm-5",
          ),
        ).toEqual([
          {
            kind: "model",
            key: "claude-fable-5",
            name: "Claude Fable 5",
            source: "built-in",
          },
          { kind: "model", key: "glm-5", name: "GLM-5", source: "built-in" },
        ]);
        expect(names.map(({ kind }) => kind)).toEqual([
          ...Array(4).fill("client"),
          ...Array(names.length - 4).fill("model"),
        ]);
      }),
  );

  it.effect(
    "sets the owner's name, trimmed, in place of a built-in one, replaces it, and shows the built-in name again once it is removed",
    () =>
      Effect.gen(function* () {
        const ofFable = Effect.map(listed, (names) =>
          names.filter(({ key }) => key === "claude-fable-5"),
        );
        expect(yield* put("model", "claude-fable-5", "  Fable  ")).toEqual({
          status: 200,
          body: {
            kind: "model",
            key: "claude-fable-5",
            name: "Fable",
            source: "owner",
          },
        });
        expect(
          (yield* put("model", "claude-fable-5", "Big Fable")).status,
        ).toBe(200);
        expect(yield* ofFable).toEqual([
          {
            kind: "model",
            key: "claude-fable-5",
            name: "Big Fable",
            source: "owner",
          },
        ]);
        expect((yield* remove("model", "claude-fable-5")).status).toBe(204);
        expect(yield* ofFable).toEqual([
          {
            kind: "model",
            key: "claude-fable-5",
            name: "Claude Fable 5",
            source: "built-in",
          },
        ]);
        expect(
          yield* Harness.problemOf(yield* remove("model", "claude-fable-5")),
        ).toEqual({
          status: 404,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:no-such-display-name",
            status: 404,
            title: "The owner has no name for that key.",
            detail: 'The owner has no name for the model "claude-fable-5".',
          },
        });
      }),
  );

  it.effect(
    "keeps a name that holds a lone surrogate with U+FFFD in its place, and the characters around it as they were",
    () =>
      Effect.gen(function* () {
        const kept = {
          kind: "machine",
          key: "halves",
          name: "b�c and �",
          source: "owner",
        };
        expect(yield* put("machine", "halves", "b\udc00c and \ud800")).toEqual({
          status: 200,
          body: kept,
        });
        expect((yield* ownersIn).filter(({ key }) => key === "halves")).toEqual(
          [kept],
        );
        expect((yield* remove("machine", "halves")).status).toBe(204);
      }),
  );

  it.effect(
    "takes a name equal to its key, once trimmed, as removing the owner's name, and answers the built-in name, or the key itself",
    () =>
      Effect.gen(function* () {
        yield* put("pool", "work", "Work");
        yield* put("client", "codex", "Codex CLI");
        expect([
          yield* put("pool", "work", " work "),
          yield* put("client", "codex", "codex"),
        ]).toEqual([
          {
            status: 200,
            body: {
              kind: "pool",
              key: "work",
              name: "work",
              source: "built-in",
            },
          },
          {
            status: 200,
            body: {
              kind: "client",
              key: "codex",
              name: "Codex",
              source: "built-in",
            },
          },
        ]);
        expect(yield* ownersIn).toEqual([]);
        expect((yield* remove("pool", "work")).status).toBe(404);
      }),
  );

  it.effect(
    "takes a key from the path percent-decoded once, with slashes, spaces, non-ASCII characters and SQL in it, up to 255 characters",
    () =>
      Effect.gen(function* () {
        const keys = [
          "acme/cota",
          "my project",
          "100%25",
          "café ☕",
          "x'); DROP TABLE display_names; --",
          "🦀".repeat(255),
        ];
        for (const [index, key] of keys.entries()) {
          expect((yield* put("project", key, `Project ${index}`)).status).toBe(
            200,
          );
        }
        expect((yield* ownersIn).map(({ key, name }) => [key, name])).toEqual(
          keys
            .map((key, index) => [key, `Project ${index}`])
            .sort(([one = ""], [other = ""]) => compareText(one, other)),
        );
        for (const key of keys) {
          expect((yield* remove("project", key)).status).toBe(204);
        }
        expect(yield* ownersIn).toEqual([]);
      }),
  );

  it.effect(
    "refuses with a 400 a name empty once trimmed or over 80 characters, a key over 255 characters, and a kind it does not know",
    () =>
      Effect.gen(function* () {
        const statuses = [];
        for (const [kind, key, name] of [
          ["pool", "work", "   "],
          ["pool", "work", "é".repeat(81)],
          ["project", "🦀".repeat(256), "Crab"],
          ["person", "jane", "Jane"],
        ] as const) {
          statuses.push((yield* put(kind, key, name)).status);
        }
        expect(statuses).toEqual([400, 400, 400, 400]);
        expect((yield* put("pool", "work", "é".repeat(80))).status).toBe(200);
        expect((yield* remove("pool", "work")).status).toBe(204);
      }),
  );
});
