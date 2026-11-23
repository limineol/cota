import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import * as Harness from "@cota/hub/harness";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as CommandLine from "#01-presentation/command-line.ts";
import * as HttpHub from "#04-infrastructure/http-hub.ts";
import * as NodeFiles from "#04-infrastructure/node-files.ts";
import * as Cota from "#05-tests/cota.ts";
import * as ScriptedTerminal from "#05-tests/fakes/scripted-terminal.ts";
import {
  secrets as allSecrets,
  cota,
  joined,
  keyedKey,
  listing,
  type Machine,
  onAMachine,
  readerKey,
  subscriptionKey,
  unusedPort,
} from "#05-tests/machine.ts";
import cli from "#package.json" with { type: "json" };

const modeOf = (path: string) =>
  (statSync(path).mode & 0o777).toString(8).padStart(3, "0");

/** Where doctor's clients check finds each stand-in client. */
const clientsFound = (on: Machine) =>
  ["claude", "codex", "opencode", "pi"]
    .map((client) => `${client} at ${join(on.bin, client)}`)
    .join(", ");

const later = (on: Machine) =>
  [
    "passed   shims\n",
    "passed   path\n",
    `passed   clients   ${clientsFound(on)}\n`,
    "passed   own-pools\n",
    "passed   logins\n",
    "passed   kept-routes\n",
    "passed   configured\n",
    "passed   titles\n",
    "skipped  requests\n",
  ].join("");

const healthy = (on: Machine) =>
  [
    "passed   config\n",
    "passed   hub\n",
    "passed   hub-keys\n",
    "passed   files\n",
    later(on),
  ].join("");

const shimsWritten = (on: { shims: string; profile: string }) =>
  `cota: wrote the shims of claude, codex, opencode and pi in ${on.shims}.\ncota: ${on.profile} now puts ${on.shims} first on PATH, in its last line; a new shell finds the shims.\n`;

/** What a join says of the title reporter: its schedule, and the first run, with no title to send yet. */
const titlesScheduled = (on: Machine, already = false) =>
  `${
    already
      ? `cota: the title reporter is scheduled every 30 seconds already, by ${on.launchAgent}; nothing changed.\n`
      : `cota: scheduled the title reporter every 30 seconds, by ${on.launchAgent}.\n`
  }cota: there was no new title to send.\n`;

const goneUnlisted =
  "cota: the models of gone could not be listed (the hub answered 502); its provider keeps the models cota last wrote for it, or is given those the hub has prices for.\n";

const keyedProviders = "cota's providers cota-gone, cota-open and cota-work";

/** What a join with both keys says of the clients' files it writes. */
const clientsWritten = (on: Machine) =>
  [
    goneUnlisted,
    `cota: wrote ${on.clientFile.codex}, with cota's provider cota-codex.\n`,
    `cota: wrote ${on.clientFile.opencode}, with ${keyedProviders}.\n`,
    `cota: wrote ${on.clientFile.pi}, with ${keyedProviders}.\n`,
  ].join("");

const afterConfig = [
  "hub",
  "hub-keys",
  "files",
  "shims",
  "path",
  "clients",
  "own-pools",
  "logins",
  "kept-routes",
  "configured",
  "titles",
  "requests",
];

layer(Layer.effectDiscard(listing).pipe(Layer.provideMerge(Harness.layer())))(
  "cota against a whole hub",
  (it) => {
    it.effect(
      "joins with a subscription hub key: writes the configuration and the key, 0700 and 0600, installs the shims, and doctor warns it has no keyed key",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* Harness.hubUrl;
            const { status, out, err } = yield* cota(on, ["join", hub], {
              input: [subscriptionKey],
            });
            expect(status).toBe(0);
            expect(err).toBe("");
            expect(readFileSync(on.configurationFile, "utf8")).toBe(
              `hub = "${hub}"\nmachine = "studio"\n`,
            );
            expect(readFileSync(on.hubKey("subscription"), "utf8")).toBe(
              `${subscriptionKey}\n`,
            );
            expect(existsSync(on.hubKey("keyed"))).toBe(false);
            expect([
              modeOf(on.configuration),
              modeOf(join(on.configuration, "hub-keys")),
              modeOf(on.configurationFile),
              modeOf(on.hubKey("subscription")),
              modeOf(join(on.shims, "claude")),
            ]).toEqual(["700", "700", "600", "600", "755"]);
            expect(out).toBe(
              [
                `cota: joined ${hub} as studio, keeping its subscription hub key.\n`,
                shimsWritten(on),
                `cota: wrote ${on.clientFile.codex}, with cota's provider cota-codex.\n`,
                `cota: ${on.clientFile.opencode} needs no provider of cota's; nothing changed.\n`,
                `cota: ${on.clientFile.pi} needs no provider of cota's; nothing changed.\n`,
                titlesScheduled(on),
                "passed   config\n",
                "passed   hub\n",
                "warned   hub-keys  this machine has no keyed hub key, so OpenCode and Pi reach no pool through the hub\n",
                `                   fix: cota join ${hub}, with a keyed hub key among the keys\n`,
                "passed   files\n",
                later(on),
              ].join(""),
            );
          }),
        ),
    );

    it.effect(
      "joins with a subscription and a keyed hub key, in either order, and doctor passes every check",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* Harness.hubUrl;
            const { status, out } = yield* cota(
              on,
              ["join", hub, "--machine", "Build Box"],
              { input: ["", `  ${keyedKey}  `, subscriptionKey, ""] },
            );
            expect(status).toBe(0);
            expect(out).toBe(
              `cota: joined ${hub} as Build Box, keeping its subscription and keyed hub keys.\n${shimsWritten(on)}${clientsWritten(on)}${titlesScheduled(on)}${healthy(on)}`,
            );
            expect(readFileSync(on.hubKey("keyed"), "utf8")).toBe(
              `${keyedKey}\n`,
            );
            expect(readFileSync(on.hubKey("subscription"), "utf8")).toBe(
              `${subscriptionKey}\n`,
            );
            expect(readFileSync(on.configurationFile, "utf8")).toBe(
              `hub = "${hub}"\nmachine = "Build Box"\n`,
            );
          }),
        ),
    );

    it.effect(
      "joins without the shims when asked, recording it, so that doctor skips the shims and path checks, and cota shims takes the record back",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* Harness.hubUrl;
            const { status, out } = yield* cota(
              on,
              ["join", hub, "--no-shims"],
              {
                input: [subscriptionKey, keyedKey],
              },
            );
            expect(status).toBe(0);
            expect(existsSync(on.shims)).toBe(false);
            expect(existsSync(on.profile)).toBe(false);
            expect(readFileSync(on.configurationFile, "utf8")).toBe(
              `hub = "${hub}"\nmachine = "studio"\nshims = false\n`,
            );
            expect(out).toContain(
              `passed   files\nskipped  shims\nskipped  path\npassed   clients   ${clientsFound(on)}\n`,
            );
            const shims = yield* cota(on, ["shims"]);
            expect(shims.status).toBe(0);
            expect(shims.out).toBe(
              [
                `cota: wrote the shims of claude, codex, opencode and pi in ${on.shims}.\n`,
                `cota: ${on.configurationFile} no longer says this machine has no shims.\n`,
                `cota: ${on.profile} now puts ${on.shims} first on PATH, in its last line; a new shell finds the shims.\n`,
              ].join(""),
            );
            expect(readFileSync(on.configurationFile, "utf8")).toBe(
              `hub = "${hub}"\nmachine = "studio"\n`,
            );
            expect((yield* cota(on, ["doctor"])).out).toBe(healthy(on));
          }),
        ),
    );

    it.effect(
      "stops a join with three keys, since a machine keeps one of each scope, and writes nothing",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* Harness.hubUrl;
            const { status, out, err } = yield* cota(on, ["join", hub], {
              input: [subscriptionKey, keyedKey, readerKey],
            });
            expect(status).toBe(1);
            expect(out).toBe("");
            expect(err).toBe(
              "cota: key 3 is a reader key, which opens no pool\ncota: the join stopped, and nothing was written.\n",
            );
            expect(existsSync(join(on.home, ".config"))).toBe(false);
            expect(existsSync(on.shims)).toBe(false);
          }),
        ),
    );

    it.effect(
      "stops a join, writing nothing, for each reason the spec gives, and names a key only by its place",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* Harness.hubUrl;
            const stopped = (
              argv: ReadonlyArray<string>,
              keys: ReadonlyArray<string>,
            ) =>
              Effect.map(
                cota(on, argv, { input: keys }),
                ({ status, out, err }) => {
                  expect(status).toBe(1);
                  expect(out).toBe("");
                  expect(existsSync(join(on.home, ".config"))).toBe(false);
                  return err;
                },
              );
            const unreachable = `http://127.0.0.1:${unusedPort()}`;
            expect(
              yield* stopped(
                ["join", hub],
                [subscriptionKey, "not-a-key-of-the-hub"],
              ),
            ).toBe(
              "cota: the hub does not know key 2\ncota: the join stopped, and nothing was written.\n",
            );
            expect(yield* stopped(["join", hub], [readerKey])).toBe(
              "cota: key 1 is a reader key, which opens no pool\ncota: the join stopped, and nothing was written.\n",
            );
            expect(
              yield* stopped(
                ["join", hub],
                [keyedKey, subscriptionKey, keyedKey],
              ),
            ).toBe(
              "cota: keys 1 and 3 are both keyed keys, and a machine keeps one of each\ncota: the join stopped, and nothing was written.\n",
            );
            expect(yield* stopped(["join", unreachable], [keyedKey])).toBe(
              `cota: ${unreachable} cannot be reached\ncota: the join stopped, and nothing was written.\n`,
            );
            expect(yield* stopped(["join", hub], [])).toBe(
              "cota: no hub key was given: give one a line on standard input\ncota: the join stopped, and nothing was written.\n",
            );
            expect(
              yield* stopped(["join", "http://cota.internal:8080"], [keyedKey]),
            ).toBe(
              "cota: http://cota.internal:8080 is plain http to another machine, which sends every hub key in the clear: use https, or allow it with --allow-plain-http\ncota: the join stopped, and nothing was written.\n",
            );
            expect(yield* stopped(["join", `${hub}/api`], [keyedKey])).toBe(
              `cota: the hub's address has a path, a query or a fragment: give ${hub} alone\ncota: the join stopped, and nothing was written.\n`,
            );
          }),
        ),
    );

    it.effect(
      "joining again with the same answers writes nothing, and with others replaces them, keeping the machine's launch settings in their fixed form",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* joined(on, [subscriptionKey, keyedKey]);
            const mtimes = () =>
              [
                on.configurationFile,
                on.hubKey("subscription"),
                on.hubKey("keyed"),
                on.profile,
                join(on.shims, "claude"),
                ...Object.values(on.clientFile),
              ].map((path) => statSync(path).mtimeMs);
            const written = mtimes();
            const again = yield* cota(on, ["join", hub], {
              input: [keyedKey, subscriptionKey],
            });
            expect(again.status).toBe(0);
            expect(again.out).toBe(
              [
                `cota: this machine had joined ${hub} as studio with these keys already; nothing changed.\n`,
                "cota: the shims and their PATH line were in place already.\n",
                goneUnlisted,
                `cota: ${on.clientFile.codex} has cota's provider cota-codex already; nothing changed.\n`,
                `cota: ${on.clientFile.opencode} has ${keyedProviders} already; nothing changed.\n`,
                `cota: ${on.clientFile.pi} has ${keyedProviders} already; nothing changed.\n`,
                titlesScheduled(on, true),
                healthy(on),
              ].join(""),
            );
            expect(mtimes()).toEqual(written);

            writeFileSync(
              on.configurationFile,
              `${readFileSync(on.configurationFile, "utf8")}\n[launch]\nwait = "7000 millis"\n\n[clients.claude-code]\nown_pool = "personal"\n`,
            );
            const other = yield* cota(
              on,
              ["join", hub, "--machine", "laptop"],
              {
                input: [subscriptionKey],
              },
            );
            expect(other.status).toBe(0);
            expect(other.out).toContain(
              [
                `cota: wrote ${on.clientFile.codex}, with cota's provider cota-codex.\n`,
                `cota: removed cota's providers from ${on.clientFile.opencode}.\n`,
                `cota: removed cota's providers from ${on.clientFile.pi}.\n`,
              ].join(""),
            );
            expect(readFileSync(on.clientFile.codex, "utf8")).toContain(
              '"x-cota-machine" = "laptop"',
            );
            expect(readFileSync(on.clientFile.opencode, "utf8")).toBe("{}\n");
            expect(readFileSync(on.configurationFile, "utf8")).toBe(
              `hub = "${hub}"\nmachine = "laptop"\n\n[launch]\nwait = "7 seconds"\n\n[clients.claude-code]\nown_pool = "personal"\n`,
            );
            expect(existsSync(on.hubKey("keyed"))).toBe(false);
          }),
        ),
    );

    it.effect(
      "leaves: removes cota's providers from the clients' files and nothing else, the shims and their PATH line, the state and the configuration with its keys, and a second leave has nothing to remove",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            writeFileSync(
              on.profile,
              `${readFileSync(on.profile, "utf8")}export EDITOR=vi\n`,
            );
            writeFileSync(
              on.clientFile.codex,
              `model = "gpt-5.5" # the owner's\n\n${readFileSync(on.clientFile.codex, "utf8")}\n[model_providers.mine]\nname = "Mine"\n`,
            );
            const opencode = JSON.parse(
              readFileSync(on.clientFile.opencode, "utf8"),
            );
            writeFileSync(
              on.clientFile.opencode,
              JSON.stringify({
                $schema: "https://opencode.ai/config.json",
                provider: { mine: { name: "Mine" }, ...opencode.provider },
              }),
            );
            const left = yield* cota(on, ["leave"]);
            expect(left).toEqual({
              status: 0,
              out: [
                `cota: removed the title reporter's schedule, ${on.launchAgent}.\n`,
                `cota: removed cota's providers from ${on.clientFile.codex}.\n`,
                `cota: removed cota's providers from ${on.clientFile.opencode}.\n`,
                `cota: removed cota's providers from ${on.clientFile.pi}.\n`,
                `cota: removed the shims from ${on.shims}.\n`,
                `cota: removed cota's PATH line from ${on.profile}.\n`,
                `cota: removed ${on.state}\n`,
                `cota: removed ${on.configuration}\n`,
              ].join(""),
              err: "",
            });
            expect(readFileSync(on.profile, "utf8")).toBe("export EDITOR=vi\n");
            expect(readFileSync(on.clientFile.codex, "utf8")).toBe(
              'model = "gpt-5.5" # the owner\'s\n\n[model_providers.mine]\nname = "Mine"\n',
            );
            expect(readFileSync(on.clientFile.opencode, "utf8")).toBe(
              '{\n  "$schema": "https://opencode.ai/config.json",\n  "provider": {\n    "mine": {\n      "name": "Mine"\n    }\n  }\n}\n',
            );
            expect(readFileSync(on.clientFile.pi, "utf8")).toBe("{}\n");
            expect(existsSync(on.shims)).toBe(false);
            expect(existsSync(on.configuration)).toBe(false);
            expect(existsSync(on.state)).toBe(false);
            expect(yield* cota(on, ["leave"])).toEqual({
              status: 0,
              out: "cota: this machine had not joined a hub; there was nothing to remove.\n",
              err: "",
            });
          }),
        ),
    );

    it.effect(
      "doctor exits 0 on a healthy machine, and --json prints every check with no problem or fix, and where each client was found",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            expect(yield* cota(on, ["doctor"])).toEqual({
              status: 0,
              out: healthy(on),
              err: "",
            });
            const json = yield* cota(on, ["doctor", "--json"]);
            expect(json.status).toBe(0);
            expect(JSON.parse(json.out)).toEqual({
              ok: true,
              checks: healthy(on)
                .trim()
                .split("\n")
                .map((line) => {
                  const id = line.slice(9).split(" ")[0];
                  return {
                    id,
                    outcome: line.slice(0, 9).trim(),
                    problem: null,
                    fix: null,
                    ...(id === "clients" ? { found: clientsFound(on) } : {}),
                  };
                }),
            });
          }),
        ),
    );

    it.effect(
      "doctor fails the config check on a machine that has not joined, skips the rest, exits 1 and writes nothing",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const { status, out } = yield* cota(on, ["doctor", "--json"]);
            expect(status).toBe(1);
            const skipped = (id: string) => ({
              id,
              outcome: "skipped",
              problem: null,
              fix: null,
            });
            expect(JSON.parse(out)).toEqual({
              ok: false,
              checks: [
                {
                  id: "config",
                  outcome: "failed",
                  problem: `this machine has not joined a hub: ${on.configurationFile} does not exist`,
                  fix: "cota join <hub>",
                },
                ...afterConfig.map(skipped),
              ],
            });
            expect(existsSync(join(on.home, ".config"))).toBe(false);
          }),
        ),
    );

    it.effect(
      "doctor fails the config check on a file that does not read, naming each problem's key, unknown keys among them",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [keyedKey]);
            writeFileSync(
              on.configurationFile,
              'hub = 18080\nmachin = "studio"\n',
            );
            const { status, out } = yield* cota(on, ["doctor"]);
            expect(status).toBe(1);
            expect(out).toBe(
              [
                `failed   config    ${on.configurationFile} does not read:\n`,
                "                   Expected no excess property\n",
                '                     at ["machin"]\n',
                "                   Expected string\n",
                '                     at ["hub"]\n',
                "                   Missing key\n",
                '                     at ["machine"]\n',
                "                   fix: cota join <hub>\n",
                ...afterConfig.map((id) => `skipped  ${id}\n`),
              ].join(""),
            );
          }),
        ),
    );

    it.effect(
      "doctor fails the hub check when the hub does not answer /health, and skips what needs the hub",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* joined(on, [keyedKey]);
            const gone = `http://127.0.0.1:${unusedPort()}`;
            writeFileSync(
              on.configurationFile,
              readFileSync(on.configurationFile, "utf8").replace(hub, gone),
            );
            const { status, out } = yield* cota(on, ["doctor"]);
            expect(status).toBe(1);
            expect(out).toBe(
              [
                "passed   config\n",
                `failed   hub       ${gone} does not answer GET /health within 5 seconds\n`,
                `                   fix: check the address and the network; cota join ${gone} to change it\n`,
                "skipped  hub-keys\n",
                "passed   files\n",
                "passed   shims\n",
                "passed   path\n",
                `passed   clients   ${clientsFound(on)}\n`,
                "skipped  own-pools\n",
                "skipped  logins\n",
                "passed   kept-routes\n",
                "skipped  configured\n",
                "passed   titles\n",
                "skipped  requests\n",
              ].join(""),
            );
          }),
        ),
    );

    it.effect(
      "doctor fails the hub-keys check for a key the hub does not know, one kept under the wrong scope, and none at all",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* joined(on, [subscriptionKey, keyedKey]);
            const hubKeysLine = (out: string) =>
              out.split("\n").slice(2, 4).join("\n");
            writeFileSync(on.hubKey("subscription"), "not-a-key-of-the-hub\n");
            writeFileSync(on.hubKey("keyed"), `${subscriptionKey}\n`);
            const wrong = yield* cota(on, ["doctor"]);
            expect(wrong.status).toBe(1);
            expect(hubKeysLine(wrong.out)).toBe(
              [
                "failed   hub-keys  the hub does not know the subscription hub key; the hub key kept as the keyed one is a subscription key",
                `                   fix: cota join ${hub}`,
              ].join("\n"),
            );
            rmSync(on.hubKey("subscription"));
            rmSync(on.hubKey("keyed"));
            const none = yield* cota(on, ["doctor"]);
            expect(none.status).toBe(1);
            expect(hubKeysLine(none.out)).toBe(
              [
                "failed   hub-keys  this machine keeps no hub key",
                `                   fix: cota join ${hub}`,
              ].join("\n"),
            );
          }),
        ),
    );

    it.effect(
      "doctor fails the files check for a directory or a secret others can read, with the chmod that fixes it",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            chmodSync(on.configuration, 0o755);
            chmodSync(on.hubKey("keyed"), 0o644);
            const { status, out } = yield* cota(on, ["doctor"]);
            expect(status).toBe(1);
            expect(out.split("\n").slice(3, 5).join("\n")).toBe(
              [
                `failed   files     ${on.configuration} is 755, not 700; ${on.hubKey("keyed")} is 644, not 600`,
                `                   fix: chmod 700 '${on.configuration}' && chmod 600 '${on.hubKey("keyed")}'`,
              ].join("\n"),
            );
          }),
        ),
    );

    it.effect(
      "doctor fails the shims and path checks for a shim gone and a PATH line no longer last, warns of a client not installed and of routes.json that does not read, with their fixes",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            rmSync(join(on.shims, "pi"));
            const shimsCheck = yield* cota(on, ["doctor"]);
            expect(shimsCheck.status).toBe(1);
            expect(shimsCheck.out.split("\n").slice(4, 7).join("\n")).toBe(
              [
                `failed   shims     ${join(on.shims, "pi")} is missing`,
                "                   fix: cota shims",
                "skipped  path",
              ].join("\n"),
            );
            expect((yield* cota(on, ["shims"])).out).toBe(
              `cota: wrote the shims of claude, codex, opencode and pi in ${on.shims}.\n`,
            );

            writeFileSync(
              on.profile,
              `${readFileSync(on.profile, "utf8")}export PATH="/opt/installer/bin:$PATH"\n`,
            );
            on.uninstall("opencode");
            mkdirSync(on.state, { recursive: true, mode: 0o700 });
            writeFileSync(on.routes, "{", { mode: 0o600 });
            const { status, out } = yield* cota(on, ["doctor"]);
            expect(status).toBe(1);
            expect(out.split("\n").slice(4).join("\n")).toBe(
              [
                "passed   shims",
                `failed   path      cota's PATH line is not the last line of ${on.profile}`,
                "                   fix: cota shims",
                `warned   clients   no opencode on PATH beyond cota's shims, so it does not launch; ${on.profile} changes PATH after cota's line (export PATH="/opt/installer/bin:$PATH"), so the directories it adds come before cota's shims; found claude at ${join(on.bin, "claude")}, codex at ${join(on.bin, "codex")}, pi at ${join(on.bin, "pi")}`,
                "                   fix: install opencode, then run cota doctor, and cota shims, which moves cota's line back to the end",
                "passed   own-pools",
                "passed   logins",
                `warned   kept-routes ${on.routes} does not read (JSON Parse error: Expected '}'), so a launch whose hub cannot be reached goes direct as if this machine had never launched there`,
                `                   fix: rm '${on.routes}'`,
                "passed   configured",
                "passed   titles",
                "skipped  requests",
                "",
              ].join("\n"),
            );
            expect((yield* cota(on, ["shims"])).out).toBe(
              `cota: ${on.profile} now puts ${on.shims} first on PATH, in its last line; a new shell finds the shims.\n`,
            );
            expect(readFileSync(on.profile, "utf8").split("\n").at(-2)).toBe(
              `export PATH="${on.shims}:$PATH" # cota: keep last`,
            );
          }),
        ),
    );

    it.effect(
      "doctor names where each client was found, and warns of one that is a script, as another gateway's wrapper left on PATH is, with a fix that only shows it, never one that removes it",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            const old = join(on.root, "old-gateway", "bin");
            mkdirSync(old, { recursive: true });
            const wrapper = join(old, "claude");
            writeFileSync(
              wrapper,
              `#!/bin/sh\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:9/old\nexec '${join(on.bin, "claude")}' "$@"\n`,
              { mode: 0o755 },
            );
            const { status, out } = yield* cota(on, ["doctor"], {
              variables: { PATH: `${on.shims}:${old}:${on.bin}` },
            });
            expect(status).toBe(0);
            expect(
              out
                .split("\n")
                .filter((line) =>
                  /^(warned|passed) {3}clients|^ {19}fix/.test(line),
                ),
            ).toEqual([
              `warned   clients   ${wrapper} is a script, not the client itself, and every launch through cota runs it: another gateway's wrapper is such a script (it sets a provider's base URL or key), and then the owner takes that gateway's directory off PATH or removes its setup; a version manager's shim, such as asdf's, is such a script too, and is fine; found claude at ${wrapper}, codex at ${join(on.bin, "codex")}, opencode at ${join(on.bin, "opencode")}, pi at ${join(on.bin, "pi")}`,
              `                   fix: head -n 20 '${wrapper}' to see which it is, then cota doctor`,
            ]);
          }),
        ),
    );

    it.effect(
      "doctor warns when the cota the shims run is inside a Git checkout, where a rebuild or a git clean changes what every launch runs, and still checks PATH",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            mkdirSync(join(on.root, ".git"));
            const { status, out } = yield* cota(on, ["doctor"]);
            expect(status).toBe(0);
            expect(
              out
                .split("\n")
                .filter((line) => /^\w+ +(shims|path)\b|^ {19}fix/.test(line)),
            ).toEqual([
              `warned   shims     the shims run ${on.program}, inside the Git checkout ${on.root}, so a rebuild, a switch of branch or a git clean there changes or removes what every launch runs`,
              `                   fix: install -m 0755 '${on.program}' ~/.local/bin/cota && ~/.local/bin/cota shims`,
              "passed   path",
            ]);
          }),
        ),
    );

    it.effect(
      "doctor does not take a home directory that is a Git repository, as one of dotfiles is, for a checkout the shims' cota is inside",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            const installed = join(on.home, ".local", "bin", "cota");
            mkdirSync(dirname(installed), { recursive: true });
            copyFileSync(on.program, installed);
            yield* cota({ ...on, program: installed }, ["shims"]);
            mkdirSync(join(on.home, ".git"));
            const { status, out } = yield* cota(on, ["doctor"]);
            expect(status).toBe(0);
            expect(
              out.split("\n").filter((line) => /^\w+ +shims\b/.test(line)),
            ).toEqual(["passed   shims"]);
          }),
        ),
    );

    it.effect(
      "doctor fails own-pools and logins for a pool the machine's keys do not open or of another protocol, with their fixes",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey, keyedKey]);
            writeFileSync(
              on.configurationFile,
              `${readFileSync(on.configurationFile, "utf8")}\n[clients.claude-code]\nown_pool = "codex"\n\n[clients.codex]\nown_pool = "nowhere"\n`,
            );
            mkdirSync(join(on.configuration, "logins"), { mode: 0o700 });
            writeFileSync(on.login("work"), "a-login\n", { mode: 0o600 });
            const { status, out } = yield* cota(on, ["doctor"]);
            expect(status).toBe(1);
            expect(out.split("\n").slice(7, 11).join("\n")).toBe(
              [
                "failed   own-pools clients.claude-code.own_pool is codex, a subscription pool of chatgpt-codex, not a subscription pool of anthropic-messages; clients.codex.own_pool is nowhere, which is not a pool this machine's hub keys open",
                `                   fix: edit own_pool in '${on.configurationFile}' to a pool of the client's own login, or remove it`,
                "failed   logins    the machine login of work is not for a subscription pool of anthropic-messages this machine's hub keys open",
                "                   fix: cota logout work",
              ].join("\n"),
            );
          }),
        ),
    );

    it.effect(
      "hub-key keyed prints the keyed hub key and a line break, and exits 1 on a machine without one",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            yield* joined(on, [subscriptionKey]);
            const without = yield* cota(on, ["hub-key", "keyed"]);
            expect(without.status).toBe(1);
            expect(without.err).toBe(
              "cota: this machine has no keyed hub key. Join again with one: cota join <hub>\n",
            );
            yield* joined(on, [subscriptionKey, keyedKey]);
            const terminal = ScriptedTerminal.make();
            const status = yield* Cota.run(["hub-key", "keyed"], {
              files: NodeFiles.layer,
              environment: Cota.environment(on.variables),
              terminal: terminal.layer,
              hub: HttpHub.layer,
            });
            expect(status).toBe(0);
            expect(terminal.printed.out).toEqual([`${keyedKey}\n`]);
          }),
        ),
    );

    it.effect(
      "J9: No launch, shim, schedule or rewrite puts a hub key or a login in any command's arguments, and no command but `cota hub-key keyed` prints one. Against a whole hub.",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            const hub = yield* Harness.hubUrl;
            const runs = [
              yield* cota(on, ["join", hub], {
                input: [readerKey, keyedKey, "not-a-key"],
              }),
              yield* cota(on, ["join", hub], { input: [keyedKey, keyedKey] }),
              yield* cota(on, ["join", hub], {
                input: [keyedKey, subscriptionKey],
              }),
              yield* cota(on, ["doctor"]),
              yield* cota(on, ["doctor", "--json"]),
              yield* cota(on, ["leave"]),
              yield* cota(on, ["doctor"]),
            ];
            expect(runs.map(({ status }) => status)).toEqual([
              1, 1, 0, 0, 0, 0, 1,
            ]);
            const printed = runs.map(({ out, err }) => out + err).join("");
            for (const secret of allSecrets)
              expect(printed).not.toContain(secret);
          }),
        ),
    );

    it.effect(
      "prints its version and how to use it, and how to use it for a command used wrongly",
      () =>
        onAMachine((on) =>
          Effect.gen(function* () {
            expect(yield* cota(on, ["--version"])).toEqual({
              status: 0,
              out: `${cli.version}\n`,
              err: "",
            });
            for (const help of [["--help"], ["help"]]) {
              expect(yield* cota(on, help)).toEqual({
                status: 0,
                out: CommandLine.usage,
                err: "",
              });
            }
            const wrongly = yield* cota(on, ["doctor", "--fix"]);
            expect(wrongly.status).toBe(2);
            expect(wrongly.err).toMatch(
              /^cota: cota doctor has no option --fix\.\n\nUsage:\n {2}cota join <hub>/,
            );
            expect(existsSync(join(on.home, ".config"))).toBe(false);
          }),
        ),
    );
  },
);
