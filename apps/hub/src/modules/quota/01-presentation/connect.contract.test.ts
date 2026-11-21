import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, layer } from "@effect/vitest";
import { DateTime, Effect, Fiber, Option } from "effect";
import * as Clients from "#modules/quota/05-tests/fakes/connect-clients.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import { shimMarker } from "#shared/03-domain/shim.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as Connect from "./connect.ts";

const script = fileURLToPath(new URL("./connect.ts", import.meta.url));
const fakes = fileURLToPath(
  new URL("../05-tests/fakes/connect-clients.ts", import.meta.url),
);

const reader = { "x-cota-key": Harness.secrets.readerHubKey };
const email = "owner@example.com";
const later = (hours: number) =>
  DateTime.add(Harness.start, { hours }).pipe(DateTime.toEpochMillis);

const claude = {
  access: "claude-access-c0n1",
  refresh: "claude-refresh-c0n1",
};

const claudeItem = (
  oauth: Record<string, unknown> = {
    accessToken: claude.access,
    refreshToken: claude.refresh,
    expiresAt: later(8),
    scopes: ["user:inference", "user:profile"],
    subscriptionType: "max",
    rateLimitTier: "default_claude_max_20x",
  },
) => JSON.stringify({ claudeAiOauth: oauth });

const chatgpt = {
  access: Harness.accessToken({ exp: later(24 * 8) / 1000, sub: "c0n1" }),
  refresh: "chatgpt-refresh-c0n1",
  accountId: "account-c0n1",
  idToken: Harness.accessToken({
    email,
    "https://api.openai.com/auth": { chatgpt_account_id: "account-c0n1" },
  }),
};

const codexAuth = (tokens: Record<string, unknown>) =>
  JSON.stringify({
    OPENAI_API_KEY: null,
    tokens,
    last_refresh: "2026-11-12T00:00:00Z",
  });

const chatgptTokens = {
  id_token: chatgpt.idToken,
  access_token: chatgpt.access,
  refresh_token: chatgpt.refresh,
  account_id: chatgpt.accountId,
};

const secrets = [
  claude.access,
  claude.refresh,
  chatgpt.access,
  chatgpt.refresh,
  chatgpt.accountId,
  chatgpt.idToken,
  Harness.secrets.ownerPassword,
];

const commands = ["claude", "codex", "security"];

interface Setup {
  readonly root: string;
  readonly home: string;
  readonly bin: string;
  readonly keychain: string;
  readonly log: string;
  readonly wait: string;
  readonly settings: string;
}

/** A home directory, a fake keychain, and a `PATH` that holds the fakes given and nothing else. */
const setUp = (fakesOnPath: ReadonlyArray<string> = commands): Setup => {
  const root = mkdtempSync(join(tmpdir(), "cota-connect-test-"));
  const setup = {
    root,
    home: join(root, "home"),
    bin: join(root, "bin"),
    keychain: join(root, "keychain"),
    log: join(root, "runs.jsonl"),
    wait: join(root, "wait"),
    settings: join(root, "fake.json"),
  };
  for (const directory of [setup.home, setup.bin, setup.keychain]) {
    mkdirSync(directory);
  }
  for (const name of fakesOnPath) {
    const wrapper = join(setup.bin, name);
    writeFileSync(
      wrapper,
      `#!/bin/sh\nexec '${process.execPath}' '${fakes}' '${setup.settings}' ${name} "$@"\n`,
    );
    chmodSync(wrapper, 0o755);
  }
  for (const name of commands) {
    expect(Bun.which(name, { PATH: setup.bin })).toBe(
      fakesOnPath.includes(name) ? join(setup.bin, name) : null,
    );
  }
  return setup;
};

const runsOf = (setup: Setup): ReadonlyArray<Clients.Run> =>
  existsSync(setup.log)
    ? readFileSync(setup.log, "utf8")
        .trim()
        .split("\n")
        .map((line): Clients.Run => JSON.parse(line))
    : [];

/** What the script leaves of a login on this machine: throwaway directories, and keychain items. */
const copiesLeft = (setup: Setup) => [
  ...readdirSync(setup.home).filter((name) =>
    name.startsWith(".cota-connect-"),
  ),
  ...readdirSync(setup.keychain),
];

/** How the fakes behave beside leaving the login given: whether the sign-in waits to be told to go on, how it ends, and who `claude auth status` says signed in. */
interface Fake {
  readonly waits?: boolean;
  readonly loginExit?: number;
  readonly statusEmail?: string;
  readonly ownersItem?: boolean;
  readonly foreignItems?: string;
}

const started = (
  setup: Setup,
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined> = {},
  login?: string,
  fake: Fake = {},
) =>
  Effect.gen(function* () {
    const url = yield* Harness.hubUrl;
    if (login !== undefined) writeFileSync(join(setup.root, "login"), login);
    const settings: Clients.Settings = {
      log: setup.log,
      keychain: setup.keychain,
      ...(login === undefined ? {} : { login: join(setup.root, "login") }),
      ...(fake.waits === true ? { wait: setup.wait } : {}),
      ...(fake.loginExit === undefined ? {} : { loginExit: fake.loginExit }),
      ...(fake.statusEmail === undefined
        ? {}
        : { statusEmail: fake.statusEmail }),
      ...(fake.ownersItem === true ? { ownersItem: true } : {}),
      ...(fake.foreignItems === undefined
        ? {}
        : { foreignItems: fake.foreignItems }),
    };
    writeFileSync(setup.settings, JSON.stringify(settings));
    return Bun.spawn([process.execPath, script, ...args], {
      cwd: setup.root,
      env: {
        PATH: setup.bin,
        HOME: setup.home,
        COTA_HUB_URL: url,
        COTA_OWNER_PASSWORD: Harness.secrets.ownerPassword,
        ...env,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  });

type Started = Effect.Success<ReturnType<typeof started>>;

const ended = (setup: Setup, child: Started) =>
  Harness.withTheClockRunning(
    Effect.promise(async () => {
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      await child.exited;
      return {
        code: child.exitCode,
        stdout,
        stderr,
        runs: runsOf(setup),
      };
    }),
  );

const connected = (
  setup: Setup,
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined> = {},
  login?: string,
  fake: Fake = {},
) =>
  Effect.gen(function* () {
    const child = yield* started(setup, args, env, login, fake);
    return yield* ended(setup, child);
  });

const leaked = (ran: { readonly stdout: string; readonly stderr: string }) =>
  Effect.gen(function* () {
    const logs = (yield* Harness.Logs).lines().join("\n");
    return secrets.filter((secret) =>
      `${ran.stdout}\n${ran.stderr}\n${logs}`.includes(secret),
    );
  });

const commandLines = (runs: ReadonlyArray<Clients.Run>) =>
  runs.map(({ name, args }) => [name, ...args].join(" "));

/** The names of every variable any client was given. */
const environmentOf = (runs: ReadonlyArray<Clients.Run>) =>
  [...new Set(runs.flatMap(({ environment }) => environment))].sort();

const quotaLoginOf = (pool: string) =>
  Effect.gen(function* () {
    const answer = yield* Harness.send("/api/pools", { headers: reader });
    const pools: ReadonlyArray<{ id: string; quotaLogin: unknown }> =
      JSON.parse(yield* Harness.textOf(answer)).pools;
    return pools.find(({ id }) => id === pool)?.quotaLogin;
  });

/** Forgets the pool's quota login, so that a test starts with none, and the script's sign-ins that are left. */
const fresh = (pool: string) =>
  Effect.gen(function* () {
    const owner = yield* Harness.signIn();
    yield* Harness.send(`/api/pools/${pool}/quota-login`, {
      method: "DELETE",
      headers: owner,
    });
    yield* Harness.send("/api/sign-ins", { method: "DELETE", headers: owner });
    yield* Harness.forgetEverything;
  });

const scriptSignIns = Effect.gen(function* () {
  const owner = yield* Harness.signIn();
  const answer = yield* Harness.send("/api/sign-ins", { headers: owner });
  const { signIns }: { signIns: ReadonlyArray<{ userAgent: string }> } =
    JSON.parse(yield* Harness.textOf(answer));
  return signIns.filter(({ userAgent }) => userAgent === "cota quota:connect")
    .length;
});

const json = (value: unknown): FakeProvider.Script => ({
  headers: [["content-type", "application/json"]],
  chunks: [JSON.stringify(value)],
});

const readyPid = (setup: Setup) =>
  Effect.promise(async () => {
    for (let step = 0; step < 1500; step++) {
      if (existsSync(`${setup.wait}.ready`)) {
        return Number(readFileSync(`${setup.wait}.ready`, "utf8"));
      }
      await Bun.sleep(10);
    }
    throw new Error("the fake client never got to sign in");
  });

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Whether a process is gone within two seconds: a client the script killed may still be reaped when the script has exited, on a loaded machine. */
const isGone = (pid: number) =>
  Effect.promise(async () => {
    for (let step = 0; step < 200; step++) {
      if (!isRunning(pid)) return true;
      await Bun.sleep(10);
    }
    return false;
  });

const nothingKept = { state: "none", givenAt: null, endsAt: null };

describe("the connect script's rule for plain http", () => {
  const refused = (url: string, allowPlainHttp = false) =>
    Option.isSome(Connect.refusalOf(new URL(url), allowPlainHttp));

  it("sends over https to any host, and over plain http only to this machine as written", () => {
    expect(
      [
        "https://cota.example",
        "https://203.0.113.9:8443",
        "https://192.168.1.20",
        "http://localhost:18080",
        "http://127.0.0.1:18080",
        "http://127.200.0.1",
        "http://[::1]:18080",
      ].filter((url) => refused(url)),
    ).toEqual([]);
    expect(
      [
        "http://10.0.0.7",
        "http://172.16.0.1",
        "http://172.31.255.254",
        "http://192.168.1.20:8080",
        "http://[fd7a:115c:a1e0::1]",
        "http://[fc00::1]",
        "http://127.0.0.1.nip.io",
        "http://cota.example",
        "http://cota.local",
        "http://localhost.example",
        "http://203.0.113.9",
        "http://172.15.255.254",
        "http://172.32.0.1",
        "http://192.169.0.1",
        "http://11.0.0.1",
        "http://100.64.0.1",
        "http://169.254.0.1",
        "http://0.0.0.0",
        "http://[fe80::1]",
        "http://[2001:db8::1]",
        "http://[::ffff:7f00:1]",
        "ftp://127.0.0.1",
      ].filter((url) => !refused(url)),
    ).toEqual([]);
  });

  it("sends over plain http to any host when the owner says so, and never over anything but http and https", () => {
    expect(refused("http://cota.example", true)).toBe(false);
    expect(refused("http://203.0.113.9", true)).toBe(false);
    expect(refused("ftp://cota.example", true)).toBe(true);
  });
});

layer(Harness.layer())("the connect script, against a whole hub", (it) => {
  it.effect(
    "connects a Claude login: the hub keeps it and reads with it, the client never sees the owner password or a key, and the script prints no token and leaves no copy",
    () =>
      Effect.gen(function* () {
        yield* fresh("claude");
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer((seen) =>
          seen.target === Harness.quotaPaths.anthropicUsage
            ? json(UsageAnswers.anthropicConstructed)
            : json({}),
        );
        const setup = setUp();
        const ran = yield* connected(
          setup,
          ["claude", "--email", email],
          {
            ANTHROPIC_API_KEY: "an-api-key-the-client-must-not-see",
            ANTHROPIC_BASE_URL: "http://127.0.0.1:1/pools/claude",
            CLAUDE_CODE_OAUTH_TOKEN: "a-token-the-client-must-not-see",
            COTA_DEV_OWNER_PASSWORD: Harness.secrets.ownerPassword,
            COTA_HUB_KEY_PERSONAL: "a-hub-key-the-client-must-not-see",
            LANG: "en_GB.UTF-8",
            LC_ALL: "en_GB.UTF-8",
            TERM: "xterm-256color",
            NO_PROXY: "cota.example",
          },
          claudeItem(),
        );
        const service = Clients.serviceOf(
          ran.runs.find(({ name }) => name === "claude")?.configDir ?? "",
        );
        expect(ran.code).toBe(0);
        expect(ran.stdout).toBe(
          `The hub now reads claude's quota windows with ${email}'s login.\n`,
        );
        expect(commandLines(ran.runs)).toEqual([
          `security find-generic-password -s ${service}`,
          `security find-generic-password -s ${Clients.ownersItem}`,
          `claude auth login --claudeai --email ${email}`,
          `security find-generic-password -s ${Clients.ownersItem}`,
          "claude auth status --json",
          `security find-generic-password -s ${service} -w`,
          `security delete-generic-password -s ${service}`,
          `security delete-generic-password -s ${service}`,
        ]);
        expect(environmentOf(ran.runs)).toEqual([
          "CLAUDE_CONFIG_DIR",
          "HOME",
          "LANG",
          "LC_ALL",
          "NO_PROXY",
          "PATH",
          "TERM",
        ]);
        expect(
          ran.runs.find(({ name }) => name === "claude")?.configDir,
        ).toMatch(/\/\.cota-connect-[^/]+$/);
        expect(copiesLeft(setup)).toEqual([]);
        expect(yield* leaked(ran)).toEqual([]);
        expect(yield* quotaLoginOf("claude")).toEqual({
          provider: "anthropic",
          state: "active",
          givenAt: expect.any(String),
          refreshedAt: null,
          endsAt: "2026-11-12T08:00:00.000Z",
          expiredAt: null,
        });
        expect(
          fake
            .seen()
            .filter(
              ({ target }) => target === Harness.quotaPaths.anthropicUsage,
            )
            .map(
              ({ headers }) =>
                headers.find(([name]) => name === "authorization")?.[1],
            ),
        ).toEqual([`Bearer ${claude.access}`]);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  it.effect(
    "connects a ChatGPT login: the hub keeps it and reads with its account, and the script prints no token and leaves no copy",
    () =>
      Effect.gen(function* () {
        yield* fresh("codex");
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer((seen) =>
          seen.target === Harness.quotaPaths.chatgptUsage
            ? json(UsageAnswers.chatGptConstructed)
            : json({}),
        );
        const setup = setUp();
        const { account_id: _, ...withoutAccountId } = chatgptTokens;
        const ran = yield* connected(
          setup,
          ["codex"],
          {
            OPENAI_API_KEY: "an-api-key-the-client-must-not-see",
            CODEX_API_KEY: "a-key-the-client-must-not-see",
            COTA_DEV_OWNER_PASSWORD: Harness.secrets.ownerPassword,
          },
          codexAuth(withoutAccountId),
        );
        expect(ran.code).toBe(0);
        expect(ran.stdout).toBe(
          `The hub now reads codex's quota windows with ${email}'s login.\n`,
        );
        expect(commandLines(ran.runs)).toEqual([
          `codex login -c cli_auth_credentials_store="file"`,
        ]);
        expect(environmentOf(ran.runs)).toEqual(["CODEX_HOME", "HOME", "PATH"]);
        expect(ran.runs[0]?.codexHome).toMatch(/\/\.cota-connect-[^/]+$/);
        expect(copiesLeft(setup)).toEqual([]);
        expect(yield* leaked(ran)).toEqual([]);
        expect(yield* quotaLoginOf("codex")).toMatchObject({
          provider: "chatgpt",
          state: "active",
          endsAt: "2026-11-20T00:00:00.000Z",
        });
        expect(
          fake
            .seen()
            .filter(({ target }) => target === Harness.quotaPaths.chatgptUsage)
            .map(({ headers }) => [
              headers.find(([name]) => name === "authorization")?.[1],
              headers.find(([name]) => name === "chatgpt-account-id")?.[1],
            ]),
        ).toEqual([[`Bearer ${chatgpt.access}`, chatgpt.accountId]]);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  it.effect(
    "runs the real client on a joined machine, never cota's shim of it that comes first on PATH",
    () =>
      Effect.gen(function* () {
        yield* fresh("codex");
        const setup = setUp();
        const shims = join(setup.root, "shims");
        const shimRan = join(setup.root, "shim-ran");
        mkdirSync(shims);
        writeFileSync(
          join(shims, "codex"),
          `#!/bin/sh\n# ${shimMarker}; cota shims rewrites it.\necho ran > '${shimRan}'\nexit 3\n`,
          { mode: 0o755 },
        );
        const ran = yield* connected(
          setup,
          ["codex"],
          { PATH: `${shims}:${setup.bin}` },
          codexAuth(chatgptTokens),
        );
        expect(ran.code).toBe(0);
        expect(commandLines(ran.runs)).toEqual([
          `codex login -c cli_auth_credentials_store="file"`,
        ]);
        expect(existsSync(shimRan)).toBe(false);
        expect(copiesLeft(setup)).toEqual([]);
      }),
  );

  it.effect(
    "names a ChatGPT login whose id token has no address an unnamed account's",
    () =>
      Effect.gen(function* () {
        yield* fresh("codex");
        const setup = setUp();
        const ran = yield* connected(
          setup,
          ["codex"],
          {},
          codexAuth({ ...chatgptTokens, id_token: null }),
        );
        expect(ran.code).toBe(0);
        expect(ran.stdout).toBe(
          "The hub now reads codex's quota windows with an unnamed account's login.\n",
        );
        expect(copiesLeft(setup)).toEqual([]);
      }),
  );

  it.effect(
    "stops before any client runs when the hub has no such pool, or the pool takes no quota login",
    () =>
      Effect.gen(function* () {
        const setup = setUp();
        const nowhere = yield* connected(setup, ["nowhere", "--email", email]);
        const keyed = yield* connected(setup, ["console", "--email", email]);
        const openAi = yield* connected(setup, ["work"]);
        expect(
          [nowhere, keyed, openAi].map(({ code, stderr }) => [code, stderr]),
        ).toEqual([
          [2, 'The hub has no pool "nowhere".\n'],
          [
            2,
            'The pool "console" takes no quota login: only a subscription pool that speaks anthropic-messages or chatgpt-codex takes one.\n',
          ],
          [
            2,
            'The pool "work" takes no quota login: only a subscription pool that speaks anthropic-messages or chatgpt-codex takes one.\n',
          ],
        ]);
        expect(runsOf(setup)).toEqual([]);
        expect(copiesLeft(setup)).toEqual([]);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  it.effect(
    "stops before any client runs when the hub refuses the owner password",
    () =>
      Effect.gen(function* () {
        const setup = setUp();
        const ran = yield* connected(setup, ["claude", "--email", email], {
          COTA_OWNER_PASSWORD: "not-the-owner-password",
        });
        expect([ran.code, ran.stderr]).toEqual([
          1,
          "The hub refused the sign-in: That is not the owner password. Check it and try again: 10 wrong passwords in 10 minutes pause signing in. (401)\n",
        ]);
        expect(runsOf(setup)).toEqual([]);
      }),
  );

  it.effect(
    "stops before signing in without an owner password and a terminal to type it",
    () =>
      Effect.gen(function* () {
        const setup = setUp();
        const ran = yield* connected(setup, ["claude", "--email", email], {
          COTA_OWNER_PASSWORD: undefined,
        });
        expect([ran.code, ran.stderr]).toEqual([
          2,
          "No owner password: set COTA_OWNER_PASSWORD, or run this in a terminal to type it.\n",
        ]);
        expect(runsOf(setup)).toEqual([]);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  it.effect(
    "refuses to send the owner password over plain http to a host that is not this machine",
    () =>
      Effect.gen(function* () {
        const setup = setUp();
        const ran = yield* connected(setup, ["claude", "--email", email], {
          COTA_HUB_URL: "http://cota.example:8080",
        });
        expect([ran.code, ran.stderr]).toEqual([
          2,
          "COTA_HUB_URL is plain http to cota.example, which is not this machine, so the owner password and the login would cross the network unencrypted. Use https, or pass --allow-plain-http if the hub is reached over a private or overlay network that encrypts its traffic, such as a VPN, Tailscale or ZeroTier.\n",
        ]);
        expect(runsOf(setup)).toEqual([]);
      }),
  );

  it.effect(
    "stops with its usage, before anything else, when the pool is missing or an option is unknown",
    () =>
      Effect.gen(function* () {
        const setup = setUp();
        const usage =
          "Usage: bun run quota:connect <pool> [--email <address>] [--allow-plain-http]\n";
        const ran = [
          yield* connected(setup, []),
          yield* connected(setup, ["claude", "codex"]),
          yield* connected(setup, ["claude", "--debug"]),
        ];
        expect(ran.map(({ code, stderr }) => [code, stderr])).toEqual([
          [2, usage],
          [2, usage],
          [2, usage],
        ]);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  it.effect(
    "asks for the Claude account's address, and for macOS's keychain, before any client runs",
    () =>
      Effect.gen(function* () {
        const withKeychain = setUp();
        const withoutEmail = yield* connected(withKeychain, ["claude"]);
        const withoutKeychain = setUp(["claude", "codex"]);
        const elsewhere = yield* connected(withoutKeychain, [
          "claude",
          "--email",
          email,
        ]);
        expect([withoutEmail.code, withoutEmail.stderr]).toEqual([
          2,
          "A Claude login needs its account's address: pass --email <address>, the address you sign in to Claude with.\n",
        ]);
        expect([elsewhere.code, elsewhere.stderr]).toEqual([
          2,
          "A Claude login can be connected from macOS only for now: it is read from the macOS keychain with the security command, which is not on PATH.\n",
        ]);
        expect([...runsOf(withKeychain), ...runsOf(withoutKeychain)]).toEqual(
          [],
        );
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  const failures: ReadonlyArray<{
    readonly title: string;
    readonly pool: "claude" | "codex";
    readonly fake: Fake;
    readonly login?: string;
    readonly says: string;
  }> = [
    {
      title:
        "a Claude sign-in that fails after leaving a login is not kept, and leaves no copy and prints no token",
      pool: "claude",
      fake: { loginExit: 1 },
      login: claudeItem(),
      says: "The login was not kept: Claude Code's sign-in ended with exit code 1.",
    },
    {
      title:
        "a cancelled ChatGPT sign-in is not kept, and leaves no copy and prints no token",
      pool: "codex",
      fake: { loginExit: 130 },
      login: codexAuth(chatgptTokens),
      says: "The login was not kept: Codex's sign-in ended with exit code 130.",
    },
    {
      title:
        "a Claude login of another account is not kept, and leaves no copy and prints no token",
      pool: "claude",
      fake: { statusEmail: "someone@example.com" },
      login: claudeItem(),
      says: `The login was not kept: Claude Code signed in as someone@example.com, not ${email}.`,
    },
    {
      title:
        "a Claude sign-in that leaves nothing in the keychain is not kept, and leaves no copy",
      pool: "claude",
      fake: {},
      says: "The login was not kept: Claude Code left no login in the keychain item",
    },
    {
      title:
        "a keychain item that is not a Claude login is not kept, and leaves no copy and prints none of it",
      pool: "claude",
      fake: {},
      login: claudeItem({
        accessToken: claude.access,
        refresh: claude.refresh,
        expiresAt: later(8),
      }),
      says: "does not hold a Claude login: claudeAiOauth with accessToken, refreshToken and expiresAt.",
    },
    {
      title:
        "a ChatGPT sign-in that writes no auth.json is not kept, and leaves no copy",
      pool: "codex",
      fake: {},
      says: "The login was not kept: Codex wrote no auth.json in the throwaway directory.",
    },
    {
      title:
        "an auth.json that is not a ChatGPT login is not kept, and leaves no copy and prints none of it",
      pool: "codex",
      fake: {},
      login: codexAuth({
        ...chatgptTokens,
        refresh_token: { value: chatgpt.refresh },
      }),
      says: "The login was not kept: Codex's auth.json does not hold a ChatGPT login: tokens with access_token and refresh_token.",
    },
    {
      title:
        "an auth.json that names no account is not kept, and leaves no copy and prints none of it",
      pool: "codex",
      fake: {},
      login: codexAuth({
        access_token: chatgpt.access,
        refresh_token: chatgpt.refresh,
        id_token: Harness.accessToken({ email }),
      }),
      says: "The login was not kept: Codex's auth.json names no account: neither tokens.account_id nor the id token's chatgpt_account_id.",
    },
    {
      title:
        "a login the hub does not decode is not kept, and leaves no copy and prints no token",
      pool: "claude",
      fake: {},
      login: claudeItem({
        accessToken: `${claude.access} with a space`,
        refreshToken: claude.refresh,
        expiresAt: later(8),
      }),
      says: "The login was not kept: it is not one the hub takes: a token is 1 to 16,384 characters with no whitespace or control character, an account id 1 to 255 of them, and a plan fact 1 to 255 characters.",
    },
    {
      title:
        "a login too large for the hub is not kept, and leaves no copy and prints no token",
      pool: "claude",
      fake: {},
      login: claudeItem({
        accessToken: claude.access,
        refreshToken: claude.refresh,
        expiresAt: later(8),
        rateLimitTier: "x".repeat(1_100_000),
      }),
      says: "The login was not kept: it is not one the hub takes: a token is 1 to 16,384 characters with no whitespace or control character, an account id 1 to 255 of them, and a plan fact 1 to 255 characters.",
    },
  ];

  for (const failure of failures) {
    it.effect(failure.title, () =>
      Effect.gen(function* () {
        yield* fresh(failure.pool);
        const setup = setUp();
        const ran = yield* connected(
          setup,
          failure.pool === "claude" ? ["claude", "--email", email] : ["codex"],
          {},
          failure.login,
          failure.fake,
        );
        expect(ran.code).toBe(1);
        expect(ran.stdout).toBe("");
        expect(ran.stderr).toContain(failure.says);
        expect(copiesLeft(setup)).toEqual([]);
        expect(yield* leaked(ran)).toEqual([]);
        expect(yield* quotaLoginOf(failure.pool)).toMatchObject(nothingKept);
        expect(yield* scriptSignIns).toBe(0);
      }),
    );
  }

  it.effect(
    "an interrupt while the client signs in stops the client, keeps nothing, leaves no copy and signs out",
    () =>
      Effect.gen(function* () {
        yield* fresh("claude");
        const setup = setUp();
        const child = yield* started(
          setup,
          ["claude", "--email", email],
          {},
          claudeItem(),
          { waits: true },
        );
        const run = yield* Effect.forkChild(ended(setup, child));
        const client = yield* readyPid(setup);
        expect(copiesLeft(setup)).toHaveLength(2);
        expect(yield* scriptSignIns).toBe(1);
        const interruptedAt = performance.now();
        child.kill("SIGINT");
        const ran = yield* Fiber.join(run);
        expect(performance.now() - interruptedAt).toBeLessThan(10_000);
        expect([ran.code, ran.stderr]).toEqual([
          130,
          `Claude Code signs you in as ${email}, in a throwaway directory; finish in your browser.\nInterrupted: the login was not kept.\n`,
        ]);
        expect(yield* isGone(client)).toBe(true);
        expect(copiesLeft(setup)).toEqual([]);
        expect(yield* leaked(ran)).toEqual([]);
        expect(yield* quotaLoginOf("claude")).toMatchObject(nothingKept);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  it.effect(
    "a Claude sign-in that changes the owner's own keychain item is not kept: the script reads and deletes none of it, and says what to check",
    () =>
      Effect.gen(function* () {
        yield* fresh("claude");
        const setup = setUp();
        const owners = join(
          setup.keychain,
          encodeURIComponent(Clients.ownersItem),
        );
        writeFileSync(owners, "the owner's own login");
        const ran = yield* connected(
          setup,
          ["claude", "--email", email],
          {},
          claudeItem(),
          { ownersItem: true },
        );
        const service = Clients.serviceOf(
          ran.runs.find(({ name }) => name === "claude")?.configDir ?? "",
        );
        expect([ran.code, ran.stdout]).toEqual([1, ""]);
        expect(ran.stderr.split("\n").at(-2)).toBe(
          `The login was not kept: the keychain item "${Clients.ownersItem}", your own Claude Code's login, changed while Claude Code signed in in the throwaway directory. Either this Claude Code keeps its login there whatever its directory, so the sign-in replaced yours, or your own Claude Code wrote it meanwhile: the script cannot tell which, so it read and deleted none of it. Check that claude still works, signed in as you, and sign in to it again if not. If this happens again, this version of Claude Code cannot be connected by this script.`,
        );
        expect(commandLines(ran.runs)).toEqual([
          `security find-generic-password -s ${service}`,
          `security find-generic-password -s ${Clients.ownersItem}`,
          `claude auth login --claudeai --email ${email}`,
          `security find-generic-password -s ${Clients.ownersItem}`,
          `security delete-generic-password -s ${service}`,
        ]);
        expect(copiesLeft(setup)).toEqual([
          encodeURIComponent(Clients.ownersItem),
        ]);
        expect(yield* leaked(ran)).toEqual([]);
        expect(yield* quotaLoginOf("claude")).toMatchObject(nothingKept);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  it.effect(
    "a keychain item of the throwaway directory's name that was there before the sign-in is left alone, and no client runs",
    () =>
      Effect.gen(function* () {
        yield* fresh("claude");
        const setup = setUp();
        const ran = yield* connected(
          setup,
          ["claude", "--email", email],
          {},
          claudeItem(),
          { foreignItems: "Claude Code-credentials-" },
        );
        const [found] = commandLines(ran.runs);
        const service = found?.replace(
          "security find-generic-password -s ",
          "",
        );
        expect([ran.code, ran.stdout]).toEqual([1, ""]);
        expect(ran.stderr.split("\n").at(-2)).toBe(
          `The login was not kept: the keychain item "${service}" was there before Claude Code signed in, so it is not this run's, and the script left it alone. Delete it in Keychain Access if it is not yours, then run this again.`,
        );
        expect(service).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
        expect(commandLines(ran.runs)).toEqual([
          `security find-generic-password -s ${service}`,
        ]);
        expect(copiesLeft(setup)).toEqual([encodeURIComponent(service ?? "")]);
        expect(yield* scriptSignIns).toBe(0);
      }),
  );

  for (const [signal, title] of [
    [
      "SIGHUP",
      "a SIGHUP while the client signs in is an interrupt: it stops the client, keeps nothing, leaves no copy and signs out",
    ],
    [
      "SIGQUIT",
      "a SIGQUIT while the client signs in is an interrupt: it stops the client, keeps nothing, leaves no copy and signs out",
    ],
  ] as const) {
    it.effect(title, () =>
      Effect.gen(function* () {
        yield* fresh("codex");
        const setup = setUp();
        const child = yield* started(
          setup,
          ["codex"],
          {},
          codexAuth(chatgptTokens),
          { waits: true },
        );
        const run = yield* Effect.forkChild(ended(setup, child));
        const client = yield* readyPid(setup);
        expect(copiesLeft(setup)).toHaveLength(1);
        child.kill(signal);
        const ran = yield* Fiber.join(run);
        expect([ran.code, ran.stderr]).toEqual([
          130,
          "Codex signs you in, in a throwaway directory; finish in your browser.\nInterrupted: the login was not kept.\n",
        ]);
        expect(yield* isGone(client)).toBe(true);
        expect(copiesLeft(setup)).toEqual([]);
        expect(yield* leaked(ran)).toEqual([]);
        expect(yield* quotaLoginOf("codex")).toMatchObject(nothingKept);
        expect(yield* scriptSignIns).toBe(0);
      }),
    );
  }

  it.effect(
    "names each throwaway directory an earlier run left, and how to remove it and its keychain item, and removes none of them",
    () =>
      Effect.gen(function* () {
        yield* fresh("codex");
        const setup = setUp();
        mkdirSync(join(setup.home, ".cota-connect-Left01"));
        const left = realpathSync(join(setup.home, ".cota-connect-Left01"));
        writeFileSync(join(left, "auth.json"), codexAuth(chatgptTokens));
        const ran = yield* connected(
          setup,
          ["codex"],
          {},
          codexAuth(chatgptTokens),
        );
        expect(ran.code).toBe(0);
        expect(ran.stderr.split("\n")[0]).toBe(
          `${left} was left by a run of this script that was stopped before it could clean up, and may hold a login. Once no run of this script is running, remove it (rm -rf '${left}') and, if it was a Claude sign-in, its keychain item (security delete-generic-password -s "${Clients.serviceOf(left)}").`,
        );
        expect(copiesLeft(setup)).toEqual([".cota-connect-Left01"]);
        expect(readdirSync(left)).toEqual(["auth.json"]);
        expect(yield* leaked(ran)).toEqual([]);
      }),
  );

  it.effect(
    "a sign-in revoked while the client signs in is answered 401, and the login is not kept and leaves no copy",
    () =>
      Effect.gen(function* () {
        yield* fresh("codex");
        const setup = setUp();
        const child = yield* started(
          setup,
          ["codex"],
          {},
          codexAuth(chatgptTokens),
          { waits: true },
        );
        const run = yield* Effect.forkChild(ended(setup, child));
        yield* readyPid(setup);
        const owner = yield* Harness.signIn();
        yield* Harness.send("/api/sign-ins", {
          method: "DELETE",
          headers: owner,
        });
        writeFileSync(`${setup.wait}.go`, "");
        const ran = yield* Fiber.join(run);
        expect([ran.code, ran.stderr.split("\n").at(-2)]).toEqual([
          1,
          "The hub did not keep the login: Sign in, or send a hub key the hub knows. Sign in with POST /api/sign-in, or send a hub key in x-cota-key or as the bearer token. (401)",
        ]);
        expect(copiesLeft(setup)).toEqual([]);
        expect(yield* leaked(ran)).toEqual([]);
        expect(yield* quotaLoginOf("codex")).toMatchObject(nothingKept);
      }),
  );

  const claudePool = {
    id: "claude",
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
    plan: null,
    windows: [],
    observedAt: null,
    reading: null,
    quotaLogin: {
      provider: "anthropic",
      state: "none",
      givenAt: null,
      refreshedAt: null,
      endsAt: null,
      expiredAt: null,
    },
  };

  const standIn = (
    status: number,
    type: string,
    title: string,
    pools: unknown = { pools: [claudePool] },
  ) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const seen: Array<string> = [];
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: async (request) => {
            const path = new URL(request.url).pathname;
            seen.push(`${request.method} ${path}`);
            await request.text();
            if (path === "/api/sign-in") {
              return new Response(null, {
                status: 204,
                headers: { "set-cookie": "cota_sign_in=stand-in; Path=/" },
              });
            }
            if (path === "/api/pools") return Response.json(pools);
            if (path === "/api/sign-out")
              return new Response(null, { status: 204 });
            return Response.json(
              { type, title, status, detail: "Said by the stand-in." },
              {
                status,
                headers: { "content-type": "application/problem+json" },
              },
            );
          },
        });
        return { server, seen };
      }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    );

  for (const [status, type, title] of [
    [403, "urn:cota:not-allowed", "The caller may not call this endpoint."],
    [404, "urn:cota:no-such-pool", "The hub has no such pool."],
    [
      400,
      "urn:cota:quota-login-not-taken",
      "This pool does not take that quota login.",
    ],
    [
      413,
      "urn:cota:body-too-large",
      "The request body is over the API's limit.",
    ],
    [415, "urn:cota:unsupported-media-type", "The API reads only JSON bodies."],
    [503, "urn:cota:hub-store-unavailable", "The hub store failed."],
  ] as const) {
    it.effect(
      `a hub that answers the login ${status} ${type} keeps nothing, and the script says so, leaves no copy and signs out`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const hub = yield* standIn(status, type, title);
            const setup = setUp();
            const ran = yield* connected(
              setup,
              ["claude", "--email", email],
              { COTA_HUB_URL: `http://127.0.0.1:${hub.server.port}` },
              claudeItem(),
            );
            expect([ran.code, ran.stderr.split("\n").at(-2)]).toEqual([
              1,
              `The hub did not keep the login: ${title} Said by the stand-in. (${status})`,
            ]);
            expect(hub.seen).toEqual([
              "POST /api/sign-in",
              "GET /api/pools",
              "PUT /api/pools/claude/quota-login",
              "POST /api/sign-out",
            ]);
            expect(copiesLeft(setup)).toEqual([]);
            expect(yield* leaked(ran)).toEqual([]);
          }),
        ),
    );
  }

  it.effect(
    "stops before any client runs when the hub's list of pools is not the API's, as an older hub's may not be",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { kind: _, ...withoutKind } = claudePool;
          const hub = yield* standIn(500, "unused", "unused", {
            pools: [withoutKind],
          });
          const setup = setUp();
          const ran = yield* connected(
            setup,
            ["claude", "--email", email],
            { COTA_HUB_URL: `http://127.0.0.1:${hub.server.port}` },
            claudeItem(),
          );
          expect([ran.code, ran.stderr]).toEqual([
            1,
            "The hub's list of pools is not one this script reads: is the hub of the same version?\n",
          ]);
          expect(hub.seen).toEqual([
            "POST /api/sign-in",
            "GET /api/pools",
            "POST /api/sign-out",
          ]);
          expect(runsOf(setup)).toEqual([]);
        }),
      ),
  );
});
