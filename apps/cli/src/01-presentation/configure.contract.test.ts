import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import * as Harness from "@cota/hub/harness";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  cota,
  joined,
  keyedKey,
  listing,
  type Machine,
  onAMachine,
  subscriptionKey,
} from "#05-tests/machine.ts";

const modeOf = (path: string) =>
  (statSync(path).mode & 0o777).toString(8).padStart(3, "0");

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const goneUnlisted =
  "cota: the models of gone could not be listed (the hub answered 502); its provider keeps the models cota last wrote for it, or is given those the hub has prices for.\n";

const keyedProviders = "cota's providers cota-gone, cota-open and cota-work";

/** A machine joined with both keys, whose clients' files are gone again. */
const unconfigured = (on: Machine) =>
  Effect.gen(function* () {
    const hub = yield* joined(on, [subscriptionKey, keyedKey]);
    for (const file of Object.values(on.clientFile)) rmSync(file);
    return hub;
  });

const writeOwn = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const ownCodex = [
  "# the owner's own settings",
  'model = "gpt-5.5"   # pinned',
  "",
  "[model_providers.cota]",
  'name = "a provider of the owner whose name starts like cota\'s"',
  "",
  "[model_providers.mine]",
  'name = "Mine"',
  'base_url = "https://models.example/v1"',
  "",
  "# the owner's last comment",
  "",
].join("\n");

const ownOpencode = `{
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "provider": {
    "cotabulary": { "name": "Not cota's" },
    "mine": { "npm": "@ai-sdk/openai-compatible", "name": "Mine" }
  }
}
`;

const ownPi = `{"providers":{"mine":{"baseUrl":"https://models.example/v1","api":"openai-completions","models":[{"id":"m"}]}}}`;

layer(Layer.effectDiscard(listing).pipe(Layer.provideMerge(Harness.layer())))(
  "configuring the clients against a whole hub",
  (it) => {
    it.effect(
      "writes each installed client's file afresh: Codex's table with the subscription hub key, OpenCode's and Pi's providers with the keyed one and each pool's listed models, Codex's 0600 and the others 0644",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* unconfigured(on);
            expect(yield* cota(on, ["configure"])).toEqual({
              status: 0,
              out: [
                goneUnlisted,
                `cota: wrote ${on.clientFile.codex}, with cota's provider cota-codex.\n`,
                `cota: wrote ${on.clientFile.opencode}, with ${keyedProviders}.\n`,
                `cota: wrote ${on.clientFile.pi}, with ${keyedProviders}.\n`,
              ].join(""),
              err: "",
            });
            expect(readFileSync(on.clientFile.codex, "utf8")).toBe(
              [
                "# cota: this table is rewritten by cota configure.",
                "[model_providers.cota-codex]",
                'name = "OpenAI"',
                `base_url = "${hub}/pools/codex/backend-api/codex"`,
                'wire_api = "responses"',
                "requires_openai_auth = true",
                `http_headers = { "x-cota-key" = "${subscriptionKey}", "x-cota-machine" = "studio", "x-cota-client" = "codex" }`,
                'env_http_headers = { "x-cota-project" = "COTA_PROJECT" }',
                "",
              ].join("\n"),
            );
            const opencode = JSON.parse(
              readFileSync(on.clientFile.opencode, "utf8"),
            );
            expect(Object.keys(opencode.provider)).toEqual([
              "cota-gone",
              "cota-open",
              "cota-work",
            ]);
            expect(opencode.provider["cota-work"]).toEqual({
              npm: "@ai-sdk/openai-compatible",
              name: "work · Cota",
              options: {
                baseURL: `${hub}/pools/work`,
                apiKey: `{file:${on.hubKey("keyed")}}`,
                headers: {
                  "x-cota-machine": "studio",
                  "x-cota-client": "opencode",
                  "x-cota-project": "{env:COTA_PROJECT}",
                },
              },
              models: {
                "glm-4.6": { name: "glm-4.6" },
                "glm-made-up": { name: "glm-made-up" },
              },
            });
            const pi = JSON.parse(readFileSync(on.clientFile.pi, "utf8"));
            expect(pi.providers["cota-open"]).toEqual({
              name: "open · Cota",
              baseUrl: `${hub}/pools/open`,
              api: "openai-completions",
              apiKey: `!'${on.program}' hub-key keyed`,
              headers: {
                "x-cota-machine": "studio",
                "x-cota-client": "pi",
                "x-cota-project": "$COTA_PROJECT",
              },
              compat: {
                sendSessionAffinityHeaders: true,
                sessionAffinityFormat: "openai",
              },
              models: [
                { id: "glm-4.6", name: "glm-4.6", input: ["text"] },
                { id: "glm-made-up", name: "glm-made-up", input: ["text"] },
              ],
            });
            expect(
              Object.values(on.clientFile).map((file) => modeOf(file)),
            ).toEqual(["600", "644", "644"]);
            expect(modeOf(dirname(on.clientFile.codex))).toBe("700");
          }),
        ),
    );

    it.effect(
      "adds cota's part to files holding the owner's own providers and comments, changing nothing of theirs, keeps a file's mode, and a second run writes nothing",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* unconfigured(on);
            writeOwn(on.clientFile.codex, ownCodex);
            writeOwn(on.clientFile.opencode, ownOpencode);
            writeOwn(on.clientFile.pi, ownPi);
            chmodSync(on.clientFile.opencode, 0o600);
            const first = yield* cota(on, ["configure"]);
            expect(first.status).toBe(0);
            const codex = readFileSync(on.clientFile.codex, "utf8");
            expect(codex.startsWith(ownCodex)).toBe(true);
            expect(codex.slice(ownCodex.length)).toMatch(
              /^\n# cota: this table is rewritten by cota configure\.\n\[model_providers\.cota-codex\]\n/,
            );
            const opencode = JSON.parse(
              readFileSync(on.clientFile.opencode, "utf8"),
            );
            expect(Object.keys(opencode)).toEqual([
              "$schema",
              "theme",
              "provider",
            ]);
            expect(Object.keys(opencode.provider)).toEqual([
              "cotabulary",
              "mine",
              "cota-gone",
              "cota-open",
              "cota-work",
            ]);
            expect(opencode.provider.mine).toEqual({
              npm: "@ai-sdk/openai-compatible",
              name: "Mine",
            });
            expect(
              JSON.parse(readFileSync(on.clientFile.pi, "utf8")).providers.mine,
            ).toEqual(JSON.parse(ownPi).providers.mine);
            expect(modeOf(on.clientFile.opencode)).toBe("600");

            const written = Object.values(on.clientFile).map(
              (file) => statSync(file).mtimeMs,
            );
            expect(yield* cota(on, ["configure"])).toEqual({
              status: 0,
              out: [
                goneUnlisted,
                `cota: ${on.clientFile.codex} has cota's provider cota-codex already; nothing changed.\n`,
                `cota: ${on.clientFile.opencode} has ${keyedProviders} already; nothing changed.\n`,
                `cota: ${on.clientFile.pi} has ${keyedProviders} already; nothing changed.\n`,
              ].join(""),
              err: "",
            });
            expect(
              Object.values(on.clientFile).map(
                (file) => statSync(file).mtimeMs,
              ),
            ).toEqual(written);
          }),
        ),
    );

    it.effect(
      "leaves a file that does not parse as it was, says why, writes the others, exits 1, and doctor's configured check names the file to edit",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* unconfigured(on);
            writeOwn(on.clientFile.codex, "[model_providers.mine\n");
            writeOwn(on.clientFile.opencode, '{ "provider": ');
            const { status, out, err } = yield* cota(on, ["configure"]);
            expect(status).toBe(1);
            expect(out).toBe(
              `${goneUnlisted}cota: wrote ${on.clientFile.pi}, with ${keyedProviders}.\n`,
            );
            expect(err).toMatch(
              new RegExp(
                `^cota: left ${escaped(on.clientFile.codex)} as it was: it does not read as TOML: .+\\.\ncota: left ${escaped(on.clientFile.opencode)} as it was: it does not read as JSON: .+\\.\n$`,
              ),
            );
            expect(readFileSync(on.clientFile.codex, "utf8")).toBe(
              "[model_providers.mine\n",
            );
            expect(readFileSync(on.clientFile.opencode, "utf8")).toBe(
              '{ "provider": ',
            );
            const doctor = yield* cota(on, ["doctor", "--json"]);
            expect(doctor.status).toBe(1);
            const configured = JSON.parse(doctor.out).checks.at(-4);
            expect(configured.id).toBe("configured");
            expect(configured.outcome).toBe("failed");
            expect(configured.problem).toContain(
              `cota configure cannot rewrite ${on.clientFile.codex}: it does not read as TOML`,
            );
            expect(configured.fix).toBe(
              `edit '${on.clientFile.codex}' and '${on.clientFile.opencode}' as the problem says, then cota configure`,
            );
          }),
        ),
    );

    it.effect(
      "doctor fails configured for a file that is not what cota configure would write now, with cota configure as its fix, and skips a client that is not installed",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            writeFileSync(
              on.clientFile.opencode,
              readFileSync(on.clientFile.opencode, "utf8").replace(
                '"work · Cota"',
                '"work, renamed by hand"',
              ),
            );
            const behind = yield* cota(on, ["doctor"]);
            expect(behind.status).toBe(1);
            expect(behind.out.split("\n").slice(-7).join("\n")).toBe(
              [
                `failed   configured ${on.clientFile.opencode} is not what cota configure would write now`,
                "                   fix: cota configure",
                "passed   titles",
                "skipped  requests",
                "warned   memory    this machine keeps no reader key, so coding agents on it cannot read the request log with cota memory",
                "                   fix: cota memory key, if the owner wants this machine's agents to read the request log",
                "",
              ].join("\n"),
            );
            expect((yield* cota(on, ["configure"])).out).toContain(
              `cota: wrote ${on.clientFile.opencode}, with ${keyedProviders}.\n`,
            );
            expect((yield* cota(on, ["doctor"])).status).toBe(0);

            for (const client of ["codex", "opencode", "pi"]) {
              on.uninstall(client);
            }
            rmSync(dirname(on.clientFile.codex), { recursive: true });
            rmSync(dirname(on.clientFile.opencode), { recursive: true });
            rmSync(dirname(on.clientFile.pi), { recursive: true });
            const none = yield* cota(on, ["doctor"]);
            expect(none.out.split("\n").at(-6)).toBe("skipped  configured");
            expect(yield* cota(on, ["configure"])).toEqual({
              status: 0,
              out: "cota: none of codex, opencode and pi is installed; there was nothing to configure.\n",
              err: "",
            });
          }),
        ),
    );
  },
);
