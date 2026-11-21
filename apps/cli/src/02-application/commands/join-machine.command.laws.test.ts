import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import * as Cota from "#05-tests/cota.ts";
import * as InMemoryFiles from "#05-tests/fakes/in-memory-files.ts";
import * as ScriptedHub from "#05-tests/fakes/scripted-hub.ts";
import * as ScriptedTerminal from "#05-tests/fakes/scripted-terminal.ts";

const home = "/home/me";
const configuration = `${home}/.config/cota`;

const answer = Arbitrary.schema(
  Schema.Literals([
    "subscription",
    "keyed",
    "reader",
    "unknown",
    "failed",
    "unreachable",
  ]),
);

const keys = Arbitrary.array(answer, { minLength: 1, maxLength: 3 });

const joinedBefore = [
  [`${home}/.config`, { kind: "directory", mode: 0o700 }],
  [configuration, { kind: "directory", mode: 0o700 }],
  [
    `${configuration}/config.toml`,
    {
      kind: "file",
      text: 'hub = "http://127.0.0.1:9000"\nmachine = "old"\n\n[launch]\nwait = "7 seconds"\n',
      mode: 0o600,
    },
  ],
  [`${configuration}/hub-keys`, { kind: "directory", mode: 0o700 }],
  [
    `${configuration}/hub-keys/keyed`,
    { kind: "file", text: "an-old-keyed-key\n", mode: 0o600 },
  ],
] as const;

/** Whether the spec's rule accepts a join with these answers, read directly: every key known, none a reader, no scope twice, the hub reached. */
const acceptedBySpec = (answers: ReadonlyArray<ScriptedHub.Answer>) =>
  answers.every((each) => each === "subscription" || each === "keyed") &&
  new Set(answers).size === answers.length;

describe("join laws", () => {
  it.effect.prop(
    "J17: For every set of keys and every answer of the hub to each, a join writes the configuration and keys only when the hub was reached and every key is known, none is a reader key and no two are of one scope; otherwise the machine's files are as they were.",
    {
      answers: keys,
      before: Arbitrary.schema(Schema.Boolean),
      address: Arbitrary.schema(
        Schema.Literals([
          "http://127.0.0.1:18080",
          "http://127.0.0.1:18080",
          "http://cota.internal:8080",
        ]),
      ),
    },
    ({ answers, before, address }) =>
      Effect.gen(function* () {
        const given = answers.map((_, place) => `generated-key-${place}-4d1e`);
        const { files, layer: filesLayer } = InMemoryFiles.make(
          before ? joinedBefore : [],
        );
        const hub = ScriptedHub.make({
          keys: new Map(
            given.map((key, place) => [key, answers[place] ?? "unknown"]),
          ),
        });
        const terminal = ScriptedTerminal.make({ input: given.join("\n") });
        const was = files.snapshot();

        const status = yield* Cota.run(["join", address], {
          files: filesLayer,
          environment: Cota.environment({ HOME: home }),
          terminal: terminal.layer,
          hub: hub.layer,
        });

        const accepted =
          address !== "http://cota.internal:8080" && acceptedBySpec(answers);
        if (!accepted) {
          expect(status).toBe(1);
          expect(files.snapshot()).toEqual(was);
          return;
        }
        expect(status).toBe(0);
        const text = (path: string) => {
          const entry = files.entries.get(path);
          return entry?.kind === "file" ? entry.text : undefined;
        };
        expect(text(`${configuration}/config.toml`)).toContain(
          `hub = "${address}"`,
        );
        for (const scope of ["subscription", "keyed"] as const) {
          const place = answers.indexOf(scope);
          expect(text(`${configuration}/hub-keys/${scope}`)).toBe(
            place === -1 ? undefined : `${given[place]}\n`,
          );
        }
      }),
    { arbitrary: { runs: 300 } },
  );
});
