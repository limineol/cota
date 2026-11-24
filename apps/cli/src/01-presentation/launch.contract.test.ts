import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Harness from "@cota/hub/harness";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import type { Variables } from "#03-domain/system.ts";
import {
  cota,
  joined,
  keyedKey,
  type Machine,
  machineLogin,
  onAMachine,
  routesOf,
  secrets,
  subscriptionKey,
  unusedPort,
} from "#05-tests/machine.ts";

const claudeHeaders = (
  project: string,
  key: "subscription" | "keyed",
  owners: ReadonlyArray<string> = [],
) =>
  [
    ...owners,
    ...(key === "subscription" ? [`x-cota-key: ${subscriptionKey}`] : []),
    `x-cota-project: ${project}`,
    "x-cota-machine: studio",
    "x-cota-client: claude-code",
  ].join("\n");

/** The routes every launch here is asked against: `acme/*` bills claude, `keyed/*` console, and the rest personal; Codex bills codex. */
const storedRoutes = Effect.gen(function* () {
  yield* routesOf(
    "claude-code",
    [
      { pattern: "acme/*", pool: "claude" },
      { pattern: "keyed/*", pool: "console" },
    ],
    "personal",
  );
  yield* routesOf("codex", [], "codex");
});

/** A machine joined with both keys and a machine login for claude. */
const ready = (on: Machine) =>
  Effect.gen(function* () {
    yield* storedRoutes;
    const hub = yield* joined(on, [subscriptionKey, keyedKey]);
    const login = yield* cota(on, ["login", "claude"], {
      input: [machineLogin],
    });
    expect(login).toEqual({
      status: 0,
      out: "cota: kept the machine login for claude.\n",
      err: "",
    });
    return hub;
  });

/** Points the machine at a hub that is not there. */
const hubStopped = (on: Machine, hub: string) => {
  const gone = `http://127.0.0.1:${unusedPort()}`;
  writeFileSync(
    on.configurationFile,
    readFileSync(on.configurationFile, "utf8").replace(hub, gone),
  );
  return gone;
};

const launched = (
  on: Machine,
  argv: ReadonlyArray<string>,
  variables: Variables = {},
) =>
  Effect.gen(function* () {
    const client = argv.find((arg) =>
      ["claude", "codex", "opencode", "pi"].includes(arg),
    );
    if (client !== undefined) on.forget(client);
    return yield* cota(on, argv, { variables });
  });

layer(Harness.layer())("launching against a whole hub", (it) => {
  it.effect(
    "launches claude by a route with the machine login of its pool, keeps the owner's own headers, and keeps the answer",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          const run = yield* launched(on, ["claude", "--print", "a b"], {
            ANTHROPIC_API_KEY: "the owner's key",
            ANTHROPIC_AUTH_TOKEN: "the owner's token",
            ANTHROPIC_CUSTOM_HEADERS: "X-Owner: one\nx-cota-project: stale",
            EDITOR: "vi",
          });
          expect(run).toEqual({ status: 0, out: "", err: "" });
          const { args, env } = on.seen("claude");
          expect(args).toEqual(["--print", "a b"]);
          expect(env).toEqual({
            HOME: on.home,
            PATH: on.variables.PATH,
            SHELL: "/bin/sh",
            EDITOR: "vi",
            COTA_PROJECT: "acme/api",
            CLAUDE_CODE_OAUTH_TOKEN: machineLogin,
            ANTHROPIC_BASE_URL: `${hub}/pools/claude`,
            ANTHROPIC_CUSTOM_HEADERS: claudeHeaders(
              "acme/api",
              "subscription",
              ["X-Owner: one"],
            ),
            CLAUDE_CODE_GATEWAY_HINT_HEADERS: "1",
          });
          expect(JSON.parse(readFileSync(on.routes, "utf8"))).toEqual({
            answers: [
              {
                client: "claude-code",
                project: "acme/api",
                pool: {
                  id: "claude",
                  kind: "subscription",
                  protocol: "anthropic-messages",
                  provider: "anthropic",
                },
                defaultPool: "personal",
              },
            ],
          });
        }),
      ),
  );

  it.effect(
    "launches claude by the default pool with its own login, and by an override to a keyed pool with the keyed hub key",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          expect(
            yield* launched(on, ["claude"], {
              COTA_PROJECT: "solo/thing",
              CLAUDE_CODE_OAUTH_TOKEN: "the owner's own token",
            }),
          ).toEqual({ status: 0, out: "", err: "" });
          const own = on.seen("claude").env;
          expect(own.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
          expect(own.ANTHROPIC_BASE_URL).toBe(`${hub}/pools/personal`);
          expect(own.ANTHROPIC_CUSTOM_HEADERS).toBe(
            claudeHeaders("solo/thing", "subscription"),
          );

          for (const argv of [
            ["--pool", "console", "claude"],
            ["--pool=console", "claude"],
          ]) {
            expect(yield* launched(on, [...argv, "-p"])).toEqual({
              status: 0,
              out: "",
              err: "",
            });
            const { args, env } = on.seen("claude");
            expect(args).toEqual(["-p"]);
            expect(env.ANTHROPIC_BASE_URL).toBe(`${hub}/pools/console`);
            expect(env.ANTHROPIC_API_KEY).toBe(keyedKey);
            expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
            expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
            expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe(
              claudeHeaders("acme/api", "keyed"),
            );
          }
          yield* launched(on, ["claude"], { COTA_POOL: "console" });
          expect(on.seen("claude").env.ANTHROPIC_BASE_URL).toBe(
            `${hub}/pools/console`,
          );
        }),
      ),
  );

  it.effect(
    "stops, starting nothing, for each refusal of the hub and each login the machine lacks, with the spec's line",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          const stopped = (
            argv: ReadonlyArray<string>,
            variables: Variables = {},
          ) =>
            Effect.gen(function* () {
              const run = yield* launched(on, argv, variables);
              expect(run.status).toBe(1);
              expect(run.out).toBe("");
              expect(on.wasStarted("claude")).toBe(false);
              expect(on.wasStarted("codex")).toBe(false);
              return run.err;
            });
          expect(yield* stopped(["--pool", "solo", "claude"])).toBe(
            "cota: acme/api bills solo, and this machine has no login for it. Sign in to solo's subscription with claude setup-token, then run cota login solo.\n",
          );
          expect(yield* stopped(["--pool", "nowhere", "claude"])).toBe(
            'cota: The hub has no pool "nowhere". Name another pool.\n',
          );
          expect(yield* stopped(["claude"], { COTA_POOL: "codex" })).toBe(
            "cota: The pool codex speaks chatgpt-codex, and claude-code speaks anthropic-messages. Name another pool.\n",
          );
          writeFileSync(
            on.configurationFile,
            `${readFileSync(on.configurationFile, "utf8")}\n[clients.codex]\nown_pool = "another"\n`,
          );
          expect(yield* stopped(["codex"])).toBe(
            "cota: acme/api bills codex, and Codex on this machine spends another; cota cannot give Codex another ChatGPT login.\n",
          );
          yield* joined(on, [subscriptionKey]);
          expect(yield* stopped(["claude"], { COTA_PROJECT: "keyed/x" })).toBe(
            `cota: keyed/x bills console, whose key the hub holds, and this machine has no keyed hub key. Join again with one: cota join ${hub}.\n`,
          );
          yield* routesOf(
            "claude-code",
            [{ pattern: "acme/*", pool: "claude" }],
            null,
          );
          expect(
            yield* stopped(["claude"], { COTA_PROJECT: "solo/thing" }),
          ).toBe(
            "cota: no route of claude-code matches solo/thing, and it has no default pool. Add one in Settings → Routes.\n",
          );
          writeFileSync(on.hubKey("subscription"), "not-a-key-of-the-hub\n");
          expect(yield* stopped(["claude"])).toBe(
            `cota: ${hub} does not know this machine's hub key; claude did not start. Join again: cota join ${hub}.\n`,
          );
        }),
      ),
  );

  it.effect(
    "launches codex through the hub with its provider before its arguments, writing its provider's table first when it is missing",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* ready(on);
          const written = readFileSync(on.clientFile.codex, "utf8");
          writeFileSync(on.clientFile.codex, "[features]\nx = true\n");
          expect(yield* launched(on, ["codex", "exec", "-c", "x=1"])).toEqual({
            status: 0,
            out: "",
            err: `cota: wrote ${on.clientFile.codex}, with cota's provider cota-codex.\n`,
          });
          expect(readFileSync(on.clientFile.codex, "utf8")).toBe(
            `[features]\nx = true\n\n${written}`,
          );
          const { args, env } = on.seen("codex");
          expect(args).toEqual([
            "-c",
            'model_provider="cota-codex"',
            "exec",
            "-c",
            "x=1",
          ]);
          expect(env).toEqual({
            HOME: on.home,
            PATH: on.variables.PATH,
            SHELL: "/bin/sh",
            COTA_PROJECT: "acme/api",
          });
          expect(yield* launched(on, ["codex"])).toEqual({
            status: 0,
            out: "",
            err: "",
          });
        }),
      ),
  );

  it.effect(
    "launches opencode and pi at once with the project and the PATH they were given, and passes the client's exit status and the signal that ended it",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          hubStopped(on, hub);
          for (const client of ["opencode", "pi"]) {
            expect(yield* launched(on, [client, "--model", "x"])).toEqual({
              status: 0,
              out: "",
              err: "",
            });
            expect(on.seen(client)).toEqual({
              args: ["--model", "x"],
              env: {
                HOME: on.home,
                PATH: on.variables.PATH,
                SHELL: "/bin/sh",
                COTA_PROJECT: "acme/api",
              },
            });
          }
          expect((yield* launched(on, ["pi", "--exit=3"])).status).toBe(3);
          expect((yield* launched(on, ["pi", "--kill=SIGTERM"])).status).toBe(
            143,
          );
        }),
      ),
  );

  it.effect(
    "the bypass and a machine that has not joined start the client with exactly what they were given; a client not installed stops with 127",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const given = {
            ANTHROPIC_API_KEY: "the owner's key",
            COTA_POOL: "solo",
          };
          expect(yield* launched(on, ["claude", "a", "--b"], given)).toEqual({
            status: 0,
            out: "",
            err: "",
          });
          expect(on.seen("claude")).toEqual({
            args: ["a", "--b"],
            env: { ...on.variables, ...given },
          });
          yield* ready(on);
          yield* launched(on, ["--pool", "claude", "claude", "-x"], {
            COTA: "off",
          });
          expect(on.seen("claude")).toEqual({
            args: ["-x"],
            env: { ...on.variables, COTA: "off" },
          });
          on.uninstall("claude");
          expect(yield* launched(on, ["claude"])).toEqual({
            status: 127,
            out: "",
            err: "cota: claude is not installed: no claude on PATH beyond cota's shims.\n",
          });
        }),
      ),
  );

  it.effect(
    "goes direct when the hub cannot be reached, on the answer kept for the project, in each row of the spec's table",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          const keep = (argv: ReadonlyArray<string>, variables: Variables) =>
            Effect.map(launched(on, argv, variables), ({ status }) =>
              expect(status).toBe(0),
            );
          yield* keep(["claude"], {});
          yield* keep(["claude"], { COTA_PROJECT: "solo/thing" });
          yield* keep(["claude"], { COTA_PROJECT: "keyed/x" });
          yield* keep(["codex"], {});
          const gone = hubStopped(on, hub);
          const direct = (argv: ReadonlyArray<string>, variables: Variables) =>
            Harness.withTheClockRunning(launched(on, argv, variables));
          const tags = {
            ANTHROPIC_BASE_URL: `${hub}/pools/claude`,
            ANTHROPIC_CUSTOM_HEADERS: "X-Owner: one\nx-cota-key: stale",
          };

          expect(
            yield* direct(["claude"], { COTA_PROJECT: "new/one", ...tags }),
          ).toEqual({
            status: 0,
            out: "",
            err: `cota: ${gone} cannot be reached, and claude has not been launched in new/one on this machine before; it goes direct with its own login, unlogged.\n`,
          });
          expect(on.seen("claude").env).toEqual({
            HOME: on.home,
            PATH: on.variables.PATH,
            SHELL: "/bin/sh",
            COTA_PROJECT: "new/one",
            ANTHROPIC_BASE_URL: `${hub}/pools/claude`,
            ANTHROPIC_CUSTOM_HEADERS: "X-Owner: one",
          });

          expect(
            yield* direct(["claude"], { COTA_PROJECT: "solo/thing" }),
          ).toEqual({
            status: 0,
            out: "",
            err: `cota: ${gone} cannot be reached; claude goes direct with personal's login, unlogged and with no fallback.\n`,
          });
          expect(on.seen("claude").env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();

          expect(yield* direct(["claude"], {})).toEqual({
            status: 0,
            out: "",
            err: `cota: ${gone} cannot be reached; claude goes direct with claude's login, unlogged and with no fallback.\n`,
          });
          expect(on.seen("claude").env).toEqual({
            HOME: on.home,
            PATH: on.variables.PATH,
            SHELL: "/bin/sh",
            COTA_PROJECT: "acme/api",
            CLAUDE_CODE_OAUTH_TOKEN: machineLogin,
          });

          expect(yield* direct(["codex", "resume"], {})).toEqual({
            status: 0,
            out: "",
            err: `cota: ${gone} cannot be reached; codex goes direct with codex's login, unlogged and with no fallback.\n`,
          });
          expect(on.seen("codex").args).toEqual(["resume"]);

          on.forget("claude");
          expect(
            yield* direct(["claude"], { COTA_PROJECT: "keyed/x" }),
          ).toEqual({
            status: 1,
            out: "",
            err: `cota: ${gone} cannot be reached, and keyed/x bills console, whose key only the hub holds; claude did not start.\n`,
          });
          expect(yield* cota(on, ["logout", "claude"])).toEqual({
            status: 0,
            out: "cota: removed the machine login for claude.\n",
            err: "",
          });
          expect(yield* direct(["claude"], {})).toEqual({
            status: 1,
            out: "",
            err: "cota: acme/api bills claude, and this machine has no login for it. Sign in to claude's subscription with claude setup-token, then run cota login claude.\n",
          });
          expect(on.wasStarted("claude")).toBe(false);
        }),
      ),
  );

  it.effect(
    "a hub that answers but cannot say the route is not unreachable: the launch goes through it on the kept answer, and stops without one",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          yield* launched(on, ["claude"], {});
          const failing = Bun.serve({
            port: 0,
            fetch: () =>
              Response.json(
                {
                  type: "urn:cota:hub-store-unavailable",
                  status: 503,
                  title: "x",
                },
                {
                  status: 503,
                  headers: { "content-type": "application/problem+json" },
                },
              ),
          });
          try {
            const unsure = `http://127.0.0.1:${failing.port}`;
            writeFileSync(
              on.configurationFile,
              readFileSync(on.configurationFile, "utf8").replace(hub, unsure),
            );
            expect(yield* launched(on, ["claude"])).toEqual({
              status: 0,
              out: "",
              err: "",
            });
            expect(on.seen("claude").env.ANTHROPIC_BASE_URL).toBe(
              `${unsure}/pools/claude`,
            );
            expect(
              yield* launched(on, ["claude"], { COTA_PROJECT: "new/one" }),
            ).toEqual({
              status: 1,
              out: "",
              err: `cota: ${unsure} could not say which pool new/one bills, and no answer is kept for it; claude did not start.\n`,
            });
          } finally {
            failing.stop(true);
          }
        }),
      ),
  );

  it.effect(
    "a shim launches its client through cota, replacing the process, without looping, and passes its status and signal",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* ready(on);
          const shim = (args: ReadonlyArray<string>) =>
            Effect.promise(async () => {
              on.forget("claude");
              const child = Bun.spawn([join(on.shims, "claude"), ...args], {
                cwd: on.work,
                env: on.variables,
                stdout: "pipe",
                stderr: "pipe",
              });
              const err = await new Response(child.stderr).text();
              const status = await child.exited;
              return { status, signal: child.signalCode, err, pid: child.pid };
            });
          const ran = yield* shim(["--exit=5", "x"]);
          expect(ran).toMatchObject({ status: 5, err: "" });
          const { args, env } = on.seen("claude");
          expect(args).toEqual(["--exit=5", "x"]);
          expect(env.PATH).toBe(on.variables.PATH);
          expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(machineLogin);
          expect((yield* shim(["--kill=SIGTERM"])).signal).toBe("SIGTERM");
        }),
      ),
  );

  it.effect(
    "J28: Every launch that starts its client gives it `PATH` as the launch was given it, the shims' directory included, and `COTA_POOL` naming the launch's override where it had one, so that a client it starts by name is launched again. Launches against a whole hub.",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          const startsClaude = (argv: ReadonlyArray<string>) =>
            Effect.gen(function* () {
              expect(
                yield* launched(on, [...argv, "claude", "--start=claude"]),
              ).toEqual({ status: 0, out: "", err: "" });
              return on.starts("claude");
            });

          expect(yield* startsClaude([])).toMatchObject([
            {
              args: ["--start=claude"],
              env: { PATH: on.variables.PATH },
            },
            {
              args: [],
              env: {
                PATH: on.variables.PATH,
                COTA_PROJECT: "acme/api",
                CLAUDE_CODE_OAUTH_TOKEN: machineLogin,
                ANTHROPIC_BASE_URL: `${hub}/pools/claude`,
                ANTHROPIC_CUSTOM_HEADERS: claudeHeaders(
                  "acme/api",
                  "subscription",
                ),
              },
            },
          ]);

          const [, inner] = yield* startsClaude(["--pool", "console"]);
          expect(inner?.args).toEqual([]);
          expect(inner?.env).toMatchObject({
            COTA_POOL: "console",
            ANTHROPIC_BASE_URL: `${hub}/pools/console`,
            ANTHROPIC_API_KEY: keyedKey,
            ANTHROPIC_CUSTOM_HEADERS: claudeHeaders("acme/api", "keyed"),
          });
          expect(inner?.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        }),
      ),
  );

  it.effect(
    "cota route says which pool a launch here bills and why, and launches nothing",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          expect(yield* cota(on, ["route"])).toEqual({
            status: 0,
            out: "project  acme/api\npool     claude, a subscription pool of anthropic-messages\nby       route 1 of claude-code, acme/*\n",
            err: "",
          });
          expect(
            (yield* cota(on, ["route", "codex"], {
              variables: { COTA_PROJECT: "x" },
            })).out,
          ).toBe(
            "project  x\npool     codex, a subscription pool of chatgpt-codex\nby       the default pool of codex\n",
          );
          expect((yield* cota(on, ["route", "--pool", "console"])).out).toBe(
            "project  acme/api\npool     console, a keyed pool of anthropic-messages\nby       the override\n",
          );
          expect(yield* cota(on, ["route", "--pool", "nowhere"])).toEqual({
            status: 1,
            out: "",
            err: 'cota: The hub has no pool "nowhere". Name another pool.\n',
          });
          expect(on.wasStarted("claude")).toBe(false);
          const gone = hubStopped(on, hub);
          expect(
            yield* Harness.withTheClockRunning(cota(on, ["route"])),
          ).toEqual({
            status: 1,
            out: "",
            err: `cota: ${gone} cannot be reached.\n`,
          });
        }),
      ),
  );

  it.effect(
    "cota login keeps a login only for a subscription pool of anthropic-messages the hub has, 0600, and cota logout removes it",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* storedRoutes;
          yield* joined(on, [subscriptionKey, keyedKey]);
          const login = (pool: string) =>
            cota(on, ["login", pool], { input: [machineLogin] });
          expect(yield* login("codex")).toEqual({
            status: 1,
            out: "",
            err: "cota: codex is a subscription pool of chatgpt-codex; a machine login is for a subscription pool of anthropic-messages\n",
          });
          expect(yield* login("console")).toEqual({
            status: 1,
            out: "",
            err: "cota: console is a keyed pool of anthropic-messages; a machine login is for a subscription pool of anthropic-messages\n",
          });
          expect(yield* login("nowhere")).toEqual({
            status: 1,
            out: "",
            err: "cota: nowhere is not a pool this machine's hub keys open\n",
          });
          expect(
            yield* cota(on, ["login", "solo"], { input: ["", "  "] }),
          ).toEqual({
            status: 1,
            out: "",
            err: "cota: no login was given: give the one claude setup-token printed, on standard input\n",
          });
          expect((yield* login("solo")).status).toBe(0);
          expect(readFileSync(on.login("solo"), "utf8")).toBe(
            `${machineLogin}\n`,
          );
          expect((statSync(on.login("solo")).mode & 0o777).toString(8)).toBe(
            "600",
          );
          expect(yield* cota(on, ["logout", "solo"])).toEqual({
            status: 0,
            out: "cota: removed the machine login for solo.\n",
            err: "",
          });
          expect(yield* cota(on, ["logout", "solo"])).toEqual({
            status: 0,
            out: "cota: this machine has no login for solo; nothing was removed.\n",
            err: "",
          });
          expect(
            (yield* cota(on, ["logout", "../hub-keys/keyed"])).status,
          ).toBe(1);
        }),
      ),
  );

  it.effect(
    "J9: No launch, shim, schedule or rewrite puts a hub key or a login in any command's arguments, and no command but `cota hub-key keyed` prints one. Launches against a whole hub.",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          const hub = yield* ready(on);
          const runs = [
            yield* cota(on, ["claude", "--print"]),
            yield* cota(on, ["--pool", "console", "claude"]),
            yield* cota(on, ["--pool", "solo", "claude"]),
            yield* cota(on, ["codex"]),
            yield* cota(on, ["opencode"]),
            yield* cota(on, ["route"]),
          ];
          hubStopped(on, hub);
          runs.push(yield* Harness.withTheClockRunning(cota(on, ["claude"])));
          const printed = runs.map(({ out, err }) => out + err).join("");
          const argv = ["claude", "codex", "opencode"].flatMap(
            (client) => on.seen(client).args,
          );
          const shims = ["claude", "codex", "opencode", "pi"].map((client) =>
            readFileSync(join(on.shims, client), "utf8"),
          );
          for (const secret of secrets) {
            expect(printed).not.toContain(secret);
            for (const each of [...argv, ...shims]) {
              expect(each).not.toContain(secret);
            }
          }
        }),
      ),
  );
});
