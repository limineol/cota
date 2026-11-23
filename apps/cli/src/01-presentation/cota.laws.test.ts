import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { definitionsOf } from "#03-domain/schedule.ts";
import { System } from "#03-domain/system.ts";
import * as Cota from "#05-tests/cota.ts";
import * as InMemoryClientRecords from "#05-tests/fakes/in-memory-client-records.ts";
import * as InMemoryFiles from "#05-tests/fakes/in-memory-files.ts";
import * as InMemoryScheduler from "#05-tests/fakes/in-memory-scheduler.ts";
import * as ScriptedHub from "#05-tests/fakes/scripted-hub.ts";
import * as ScriptedTerminal from "#05-tests/fakes/scripted-terminal.ts";

const character = Arbitrary.schema(
  Schema.Literals([
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~+/=",
  ]),
);

const secret = Arbitrary.array(character, {
  minLength: 12,
  maxLength: 48,
}).pipe(Arbitrary.map((characters) => characters.join("")));

const given = Arbitrary.array(
  Arbitrary.all({
    key: secret,
    answer: Arbitrary.schema(
      Schema.Literals([
        "subscription",
        "keyed",
        "reader",
        "unknown",
        "failed",
        "unreachable",
      ]),
    ),
  }),
  { minLength: 1, maxLength: 3 },
);

describe("cota laws", () => {
  it.effect.prop(
    "J9: No launch, shim, schedule or rewrite puts a hub key or a login in any command's arguments, and no command but `cota hub-key keyed` prints one.",
    {
      given,
      typed: Arbitrary.schema(Schema.Boolean),
      health: Arbitrary.schema(Schema.Literals(["up", "down", "failing"])),
      plainHttp: Arbitrary.schema(Schema.Boolean),
      system: Arbitrary.schema(System),
    },
    ({ given, typed, health, plainHttp, system }) =>
      Effect.gen(function* () {
        const keys = given.map(({ key }) => key);
        const { layer: files } = InMemoryFiles.make();
        const hub = ScriptedHub.make({
          keys: new Map(given.map(({ key, answer }) => [key, answer])),
          health,
          observedPools: ["gemini"],
        });
        const records = InMemoryClientRecords.make();
        const folder =
          system === "win32" ? "C:\\Users\\me\\agy" : "/home/me/agy";
        records.folders.set(folder, new Map());
        const terminal = ScriptedTerminal.make(
          typed ? { typed: keys } : { input: keys.join("\n") },
        );
        const scheduler = InMemoryScheduler.make();
        const [first = ""] = keys;
        const ports = {
          files,
          environment: Cota.environment(
            {
              HOME: "/home/me",
              XDG_STATE_HOME: "/home/me/state",
              APPDATA: "C:\\Users\\me\\AppData\\Roaming",
              LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
              ANTHROPIC_API_KEY: first,
              COTA_OWNER_PASSWORD: first,
            },
            system,
          ),
          terminal: terminal.layer,
          hub: hub.layer,
          scheduler: scheduler.layer,
          clientRecords: records.layer,
        };
        const address = plainHttp
          ? "http://cota.internal:8080"
          : "http://127.0.0.1:18080";
        const argv = [
          ["join", address, "--machine", "studio"],
          ["requests", "add", "antigravity", folder, "gemini"],
          ["doctor"],
          ["doctor", "--json"],
          ["leave"],
          ["doctor"],
        ];
        const scheduled: Array<string> = [];
        for (const each of argv) {
          yield* Cota.run(each, ports);
          for (const schedule of scheduler.held.values()) {
            scheduled.push(
              ...definitionsOf(schedule).flatMap(({ path, text }) => [
                path,
                text,
              ]),
            );
          }
        }

        const printed = [
          ...argv.flat(),
          ...terminal.printed.out,
          ...terminal.printed.err,
          ...terminal.printed.questions,
          ...scheduled,
        ].join("\n");
        for (const key of keys) expect(printed).not.toContain(key);
      }),
    { arbitrary: { runs: 300 } },
  );
});
