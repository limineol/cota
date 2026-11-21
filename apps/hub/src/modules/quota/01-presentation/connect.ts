import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { parseArgs } from "node:util";
import { BunRuntime } from "@effect/platform-bun";
import {
  Console,
  DateTime,
  Effect,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import { isShim, shimHeadBytes } from "#shared/03-domain/shim.ts";
import * as PoolsApi from "./pools.api.ts";

const usage =
  "Usage: bun run quota:connect <pool> [--email <address>] [--allow-plain-http]";

class Stop extends Schema.TaggedError<Stop>()("Stop", {
  code: Schema.Literals([1, 2]),
  message: Schema.String,
}) {}

class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", {
  why: Schema.String,
}) {}

const stop = (code: 1 | 2, message: string) =>
  Effect.fail(new Stop({ code, message }));

const notKept = (why: string) => stop(1, `The login was not kept: ${why}`);

type Secret = Redacted.Redacted<string>;

/** Whether a host, as a URL writes it, is this machine: `localhost`, `127.0.0.0/8` or `[::1]`. A name is not resolved. */
const isThisMachine = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127\.\d+\.\d+\.\d+$/.test(hostname);

/** Why the owner password and a login may not be sent to the hub at this URL, if they may not. */
export const refusalOf = (
  url: URL,
  allowPlainHttp: boolean,
): Option.Option<string> => {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Option.some("COTA_HUB_URL is not an http or https URL.");
  }
  if (
    url.protocol === "https:" ||
    allowPlainHttp ||
    isThisMachine(url.hostname)
  ) {
    return Option.none();
  }
  return Option.some(
    `COTA_HUB_URL is plain http to ${url.hostname}, which is not this machine, so the owner password and the login would cross the network unencrypted. Use https, or pass --allow-plain-http if the hub is reached over a private or overlay network that encrypts its traffic, such as a VPN, Tailscale or ZeroTier.`,
  );
};

const optionsOf = Effect.fn("optionsOf")(function* (
  args: ReadonlyArray<string>,
) {
  const parsed = yield* Effect.try({
    try: () =>
      parseArgs({
        args: [...args],
        options: {
          email: { type: "string" },
          "allow-plain-http": { type: "boolean" },
        },
        allowPositionals: true,
        strict: true,
      }),
    catch: () => new Stop({ code: 2, message: usage }),
  });
  const [pool, ...more] = parsed.positionals;
  if (pool === undefined || more.length > 0) return yield* stop(2, usage);
  return {
    pool,
    email: Option.fromNullishOr(parsed.values.email),
    allowPlainHttp: parsed.values["allow-plain-http"] === true,
  };
});

const hubUrlOf = Effect.fn("hubUrlOf")(function* (
  given: string | undefined,
  allowPlainHttp: boolean,
) {
  if (given === undefined || given === "") {
    return yield* stop(
      2,
      "COTA_HUB_URL is not set: it names the hub, such as https://cota.example.",
    );
  }
  const url = URL.parse(given);
  if (url === null) return yield* stop(2, "COTA_HUB_URL is not a URL.");
  const refusal = refusalOf(url, allowPlainHttp);
  if (Option.isSome(refusal)) return yield* stop(2, refusal.value);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url;
});

const typed = (prompt: string) =>
  Effect.callback<Secret>((resume) => {
    const input = process.stdin;
    let text = "";
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          done();
          resume(Effect.succeed(Redacted.make(text)));
          return;
        }
        if (character === "\u0003" || character === "\u0004") {
          done();
          resume(Effect.interrupt);
          return;
        }
        text =
          character === "\u007f" || character === "\b"
            ? [...text].slice(0, -1).join("")
            : text + character;
      }
    };
    const done = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write("\n");
    };
    process.stderr.write(prompt);
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
    return Effect.sync(done);
  });

const ownerPassword = Effect.gen(function* () {
  const given = process.env.COTA_OWNER_PASSWORD;
  if (given !== undefined && given !== "") return Redacted.make(given);
  if (!process.stdin.isTTY) {
    return yield* stop(
      2,
      "No owner password: set COTA_OWNER_PASSWORD, or run this in a terminal to type it.",
    );
  }
  return yield* typed("The hub's owner password: ");
});

interface Hub {
  readonly url: URL;
  readonly cookie: Secret;
}

interface Call {
  readonly method: "GET" | "POST" | "PUT";
  readonly cookie?: Secret;
  readonly body?: string;
}

const send = (url: URL, path: string, call: Call) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(new URL(path, url), {
        method: call.method,
        headers: {
          "user-agent": "cota quota:connect",
          ...(call.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(call.cookie === undefined
            ? {}
            : { cookie: Redacted.value(call.cookie) }),
        },
        body: call.body,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      }),
    catch: (error) =>
      new Unreachable({
        why: `could not reach the hub at ${url.origin} (${error instanceof Error ? error.message : "no answer"})`,
      }),
  });

const textOf = (response: Response) =>
  Effect.promise(() => response.text().catch(() => ""));

const Problem = Schema.Struct({
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
});
const decodeProblem = Schema.decodeUnknownOption(
  Schema.fromJsonString(Problem),
);

/** The problem an answer holds, as its title, detail and status: the hub's details never repeat a token. */
const problemOf = Effect.fn("problemOf")(function* (response: Response) {
  const problem = decodeProblem(yield* textOf(response));
  if (Option.isNone(problem)) return `the hub answered ${response.status}.`;
  const { title, detail } = problem.value;
  return `${title}${detail === undefined ? "" : ` ${detail}`} (${response.status})`;
});

const signedOut = Effect.fn("signedOut")(function* (hub: Hub) {
  const answer = yield* Effect.option(
    send(hub.url, "api/sign-out", { method: "POST", cookie: hub.cookie }),
  );
  if (Option.isSome(answer) && [204, 401].includes(answer.value.status)) {
    return;
  }
  yield* Console.error(
    "Could not sign out of the hub: the sign-in lapses in 30 days, or DELETE /api/sign-ins ends it.",
  );
});

const signedIn = (url: URL, password: Secret) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const response = yield* send(url, "api/sign-in", {
        method: "POST",
        body: JSON.stringify({ password: Redacted.value(password) }),
      }).pipe(
        Effect.mapError(
          ({ why }) =>
            new Stop({ code: 1, message: `Could not sign in: ${why}.` }),
        ),
      );
      if (response.status !== 204) {
        return yield* stop(
          1,
          `The hub refused the sign-in: ${yield* problemOf(response)}`,
        );
      }
      const cookie = response.headers
        .getSetCookie()
        .map((line) => line.split(";")[0] ?? "")
        .find((pair) => pair.startsWith("cota_sign_in="));
      if (cookie === undefined) {
        return yield* stop(1, "The hub signed in without giving its cookie.");
      }
      return { url, cookie: Redacted.make(cookie) } satisfies Hub;
    }),
    signedOut,
  );

const decodePools = Schema.decodeUnknownOption(
  Schema.fromJsonString(PoolsApi.Pools),
);

const providerOf = Effect.fn("providerOf")(function* (hub: Hub, pool: string) {
  const response = yield* send(hub.url, "api/pools", {
    method: "GET",
    cookie: hub.cookie,
  }).pipe(
    Effect.mapError(
      ({ why }) =>
        new Stop({
          code: 1,
          message: `Could not list the hub's pools: ${why}.`,
        }),
    ),
  );
  if (response.status !== 200) {
    return yield* stop(
      1,
      `The hub did not list its pools: ${yield* problemOf(response)}`,
    );
  }
  const pools = decodePools(yield* textOf(response));
  if (Option.isNone(pools)) {
    return yield* stop(
      1,
      "The hub's list of pools is not one this script reads: is the hub of the same version?",
    );
  }
  const found = pools.value.pools.find(({ id }) => id === pool);
  if (found === undefined) {
    return yield* stop(2, `The hub has no pool ${JSON.stringify(pool)}.`);
  }
  if (found.quotaLogin === null) {
    return yield* stop(
      2,
      `The pool ${JSON.stringify(pool)} takes no quota login: only a subscription pool that speaks anthropic-messages or chatgpt-codex takes one.`,
    );
  }
  return found.quotaLogin.provider;
});

/**
 * The client's real command: the first named for it on `PATH` that is not one
 * of `cota`'s shims, which would sign in through `cota` and the hub
 * (`docs/specs/cli/spec.md`, Launching, step 2).
 */
const commandOf = Effect.fn("commandOf")(function* (
  name: string,
  missing: string,
) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory === "") continue;
    const path = Bun.which(name, { PATH: directory });
    if (path === null) continue;
    const head = yield* Effect.promise(() =>
      Bun.file(path)
        .slice(0, shimHeadBytes)
        .text()
        .catch(() => ""),
    );
    if (!isShim(head)) return path;
  }
  return yield* stop(2, missing);
});

/** All that the provider's client is given of this script's environment, beside its own directory: what it needs to run, to reach the provider and to open a browser (the quota logins spec says why each). */
const passed = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TERM",
  "COLORTERM",
  "LANG",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "XDG_CURRENT_DESKTOP",
  "DBUS_SESSION_BUS_ADDRESS",
  "BROWSER",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
];

const isPassed = (name: string) =>
  passed.includes(name) || name.startsWith("LC_");

type Environment = Record<string, string>;

const environmentWith = (own: Environment): Environment => ({
  ...Object.fromEntries(
    Object.entries(process.env).flatMap(([name, value]) =>
      value !== undefined && isPassed(name) ? [[name, value]] : [],
    ),
  ),
  ...own,
});

type Child = Pick<
  Bun.Subprocess,
  "exitCode" | "signalCode" | "kill" | "exited"
>;

interface Ended {
  readonly exitCode: number | null;
  readonly signalCode: Child["signalCode"];
  readonly stdout: string;
}

const succeeded = (ended: Ended) => ended.exitCode === 0;

const endOf = ({ exitCode, signalCode }: Ended) =>
  signalCode === null
    ? `ended with exit code ${exitCode}`
    : `was stopped by ${signalCode}`;

const stopped = (child: Child) =>
  Effect.promise(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const late = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await child.exited;
    clearTimeout(late);
  });

const spawned = <A extends Child>(command: string, spawn: () => A) =>
  Effect.try({
    try: spawn,
    catch: () =>
      new Stop({
        code: 1,
        message: `The login was not kept: ${command} could not be run.`,
      }),
  });

/** Runs a command with the terminal, so that the owner signs in through it. */
const ranInTerminal = (
  command: string,
  args: ReadonlyArray<string>,
  env: Environment,
) =>
  Effect.acquireUseRelease(
    spawned(command, () =>
      Bun.spawn([command, ...args], {
        env,
        stdio: ["inherit", "inherit", "inherit"],
      }),
    ),
    (child) =>
      Effect.promise(async (): Promise<Ended> => {
        await child.exited;
        return {
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          stdout: "",
        };
      }),
    stopped,
  );

/** Runs a command whose output is read here and never shown: it may be a login. */
const ranCaptured = (
  command: string,
  args: ReadonlyArray<string>,
  env: Environment,
) =>
  Effect.acquireUseRelease(
    spawned(command, () =>
      Bun.spawn([command, ...args], {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      }),
    ),
    (child) =>
      Effect.promise(async (): Promise<Ended> => {
        const stdout = await new Response(child.stdout).text();
        await child.exited;
        return {
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          stdout,
        };
      }),
    stopped,
  );

const removed = (directory: string, left: Ref.Ref<boolean>) =>
  Effect.try({
    try: () => rmSync(directory, { recursive: true, force: true }),
    catch: () => directory,
  }).pipe(
    Effect.catch(() =>
      Effect.andThen(
        Ref.set(left, true),
        Console.error(
          `Could not remove ${directory}, which may hold the login: remove it yourself.`,
        ),
      ),
    ),
  );

const throwawayPrefix = ".cota-connect-";

/** The keychain item Claude Code makes for a configuration directory: named after its path, which has no symbolic link. */
const keychainItemOf = (directory: string) =>
  `Claude Code-credentials-${createHash("sha256").update(directory).digest("hex").slice(0, 8)}`;

/** Names each throwaway directory a run killed outright left behind (or one still running uses), and how to remove it; removes none. */
const leftBehindNamed = Effect.fn("leftBehindNamed")(function* () {
  const names = yield* Effect.orElseSucceed(
    Effect.try(() => readdirSync(homedir())),
    () => [],
  );
  for (const name of names.filter((name) => name.startsWith(throwawayPrefix))) {
    const directory = yield* Effect.orElseSucceed(
      Effect.try(() => realpathSync(join(homedir(), name))),
      () => join(homedir(), name),
    );
    yield* Console.error(
      `${directory} was left by a run of this script that was stopped before it could clean up, and may hold a login. Once no run of this script is running, remove it (rm -rf '${directory}') and, if it was a Claude sign-in, its keychain item (security delete-generic-password -s "${keychainItemOf(directory)}").`,
    );
  }
});

/** A directory of the owner's own for the client to sign in to, removed with everything in it when the scope closes. */
const throwaway = (left: Ref.Ref<boolean>) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => realpathSync(mkdtempSync(join(homedir(), throwawayPrefix))),
      catch: () =>
        new Stop({
          code: 1,
          message: `Could not make a throwaway directory in ${homedir()}.`,
        }),
    }),
    (directory) => removed(directory, left),
  );

type Login = typeof PoolsApi.GivenQuotaLogin.Type;

interface Made {
  readonly login: Login;
  readonly account: string;
}

const Text = Schema.RedactedFromValue(Schema.String);

const ClaudeStatus = Schema.Struct({
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(ClaudeStatus),
);

const ClaudeItem = Schema.Struct({
  claudeAiOauth: Schema.Struct({
    accessToken: Text,
    refreshToken: Text,
    expiresAt: Schema.Finite,
    subscriptionType: Schema.optionalKey(Schema.NullOr(Schema.String)),
    rateLimitTier: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
const decodeItem = Schema.decodeUnknownOption(
  Schema.fromJsonString(ClaudeItem),
);

// `security` answers 44, errSecItemNotFound, when no item has the name.
const itemNotFound = 44;

/** The keychain item of the owner's own Claude Code, which has no configuration directory of its own. */
const ownersItem = "Claude Code-credentials";

/** What `security` says of a keychain item, its attributes and never its secret, or null when there is none. */
const attributesOf = Effect.fn("attributesOf")(function* (
  security: string,
  service: string,
) {
  const found = yield* ranCaptured(
    security,
    ["find-generic-password", "-s", service],
    environmentWith({}),
  );
  if (found.exitCode === itemNotFound) return null;
  if (!succeeded(found)) {
    return yield* notKept(
      `security could not say whether the keychain item "${service}" exists: it ${endOf(found)}.`,
    );
  }
  return found.stdout;
});

const keychainItemDeleted = Effect.fn("keychainItemDeleted")(function* (
  security: string,
  service: string,
  left: Ref.Ref<boolean>,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const deleted = yield* Effect.option(
      ranCaptured(
        security,
        ["delete-generic-password", "-s", service],
        environmentWith({}),
      ),
    );
    if (Option.isSome(deleted) && deleted.value.exitCode === itemNotFound) {
      return;
    }
    if (Option.isNone(deleted) || !succeeded(deleted.value)) break;
  }
  yield* Ref.set(left, true);
  yield* Console.error(
    `Could not delete the keychain item "${service}", which may hold the login: delete it in Keychain Access.`,
  );
});

const claudeLogin = Effect.fn("claudeLogin")(function* (
  email: Option.Option<string>,
  left: Ref.Ref<boolean>,
) {
  const security = yield* commandOf(
    "security",
    "A Claude login can be connected from macOS only for now: it is read from the macOS keychain with the security command, which is not on PATH.",
  );
  if (Option.isNone(email)) {
    return yield* stop(
      2,
      "A Claude login needs its account's address: pass --email <address>, the address you sign in to Claude with.",
    );
  }
  const claude = yield* commandOf(
    "claude",
    "Claude Code (claude) is not on PATH beyond cota's shims: install it, then run this again.",
  );
  const directory = yield* throwaway(left);
  const service = keychainItemOf(directory);
  if ((yield* attributesOf(security, service)) !== null) {
    return yield* notKept(
      `the keychain item "${service}" was there before Claude Code signed in, so it is not this run's, and the script left it alone. Delete it in Keychain Access if it is not yours, then run this again.`,
    );
  }
  const ownersBefore = yield* attributesOf(security, ownersItem);
  yield* Effect.addFinalizer(() =>
    keychainItemDeleted(security, service, left),
  );
  const env = environmentWith({ CLAUDE_CONFIG_DIR: directory });
  yield* Console.error(
    `Claude Code signs you in as ${email.value}, in a throwaway directory; finish in your browser.`,
  );
  const login = yield* ranInTerminal(
    claude,
    ["auth", "login", "--claudeai", "--email", email.value],
    env,
  );
  const ownersAfter = yield* attributesOf(security, ownersItem);
  if (ownersAfter !== ownersBefore) {
    return yield* notKept(
      `the keychain item "${ownersItem}", your own Claude Code's login, changed while Claude Code signed in in the throwaway directory. Either this Claude Code keeps its login there whatever its directory, so the sign-in replaced yours, or your own Claude Code wrote it meanwhile: the script cannot tell which, so it read and deleted none of it. Check that claude still works, signed in as you, and sign in to it again if not. If this happens again, this version of Claude Code cannot be connected by this script.`,
    );
  }
  if (!succeeded(login)) {
    return yield* notKept(`Claude Code's sign-in ${endOf(login)}.`);
  }
  const status = yield* ranCaptured(claude, ["auth", "status", "--json"], env);
  if (!succeeded(status)) {
    return yield* notKept(`claude auth status ${endOf(status)}.`);
  }
  const signedInAs = Option.flatMap(decodeStatus(status.stdout), (status) =>
    Option.fromNullishOr(status.email),
  );
  if (Option.isNone(signedInAs)) {
    return yield* notKept("claude auth status did not say who signed in.");
  }
  if (signedInAs.value.toLowerCase() !== email.value.toLowerCase()) {
    return yield* notKept(
      `Claude Code signed in as ${signedInAs.value}, not ${email.value}.`,
    );
  }
  const item = yield* ranCaptured(
    security,
    ["find-generic-password", "-s", service, "-w"],
    env,
  );
  if (!succeeded(item)) {
    return yield* notKept(
      `Claude Code left no login in the keychain item "${service}".`,
    );
  }
  const oauth = Option.map(
    decodeItem(item.stdout.trim()),
    (item) => item.claudeAiOauth,
  );
  const endsAt = Option.flatMap(oauth, ({ expiresAt }) =>
    DateTime.make(expiresAt),
  );
  if (Option.isNone(oauth) || Option.isNone(endsAt)) {
    return yield* notKept(
      `the keychain item "${service}" does not hold a Claude login: claudeAiOauth with accessToken, refreshToken and expiresAt.`,
    );
  }
  const { accessToken, refreshToken, subscriptionType, rateLimitTier } =
    oauth.value;
  return {
    account: email.value,
    login: {
      provider: "anthropic",
      accessToken,
      refreshToken,
      endsAt: endsAt.value,
      subscriptionType: subscriptionType || null,
      rateLimitTier: rateLimitTier || null,
    },
  } satisfies Made;
});

const CodexAuth = Schema.Struct({
  tokens: Schema.Struct({
    id_token: Schema.optionalKey(Schema.NullOr(Schema.String)),
    access_token: Text,
    refresh_token: Text,
    account_id: Schema.optionalKey(Schema.NullOr(Text)),
  }),
});
const decodeAuth = Schema.decodeUnknownOption(Schema.fromJsonString(CodexAuth));

const IdClaims = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
  "https://api.openai.com/auth": Schema.optionalKey(
    Schema.Struct({ chatgpt_account_id: Schema.optionalKey(Text) }),
  ),
});
const decodeClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(IdClaims),
);

const claimsOf = (idToken: string) =>
  decodeClaims(
    Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  );

const chatGptLogin = Effect.fn("chatGptLogin")(function* (
  left: Ref.Ref<boolean>,
) {
  const codex = yield* commandOf(
    "codex",
    "Codex (codex) is not on PATH beyond cota's shims: install it, then run this again.",
  );
  const directory = yield* throwaway(left);
  const env = environmentWith({ CODEX_HOME: directory });
  yield* Console.error(
    "Codex signs you in, in a throwaway directory; finish in your browser.",
  );
  const login = yield* ranInTerminal(
    codex,
    ["login", "-c", 'cli_auth_credentials_store="file"'],
    env,
  );
  if (!succeeded(login)) {
    return yield* notKept(`Codex's sign-in ${endOf(login)}.`);
  }
  const text = yield* Effect.option(
    Effect.try(() => readFileSync(join(directory, "auth.json"), "utf8")),
  );
  if (Option.isNone(text)) {
    return yield* notKept(
      "Codex wrote no auth.json in the throwaway directory.",
    );
  }
  const auth = decodeAuth(text.value);
  if (Option.isNone(auth)) {
    return yield* notKept(
      "Codex's auth.json does not hold a ChatGPT login: tokens with access_token and refresh_token.",
    );
  }
  const { tokens } = auth.value;
  const claims = Option.flatMap(
    Option.fromNullishOr(tokens.id_token),
    claimsOf,
  );
  const accountId = Option.orElse(Option.fromNullishOr(tokens.account_id), () =>
    Option.flatMap(claims, (claims) =>
      Option.fromNullishOr(
        claims["https://api.openai.com/auth"]?.chatgpt_account_id,
      ),
    ),
  );
  if (Option.isNone(accountId)) {
    return yield* notKept(
      "Codex's auth.json names no account: neither tokens.account_id nor the id token's chatgpt_account_id.",
    );
  }
  return {
    account: Option.getOrElse(
      Option.flatMap(claims, ({ email }) => Option.fromNullishOr(email)),
      () => "an unnamed account",
    ),
    login: {
      provider: "chatgpt",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accountId: accountId.value,
    },
  } satisfies Made;
});

const encodeLogin = Schema.encodeEffect(
  Schema.fromJsonString(PoolsApi.GivenQuotaLogin),
);

const given = Effect.fn("given")(function* (
  hub: Hub,
  pool: string,
  login: Login,
  sending: Ref.Ref<boolean>,
) {
  const body = yield* encodeLogin(login).pipe(
    Effect.catch(() =>
      notKept(
        "it is not one the hub takes: a token is 1 to 16,384 characters with no whitespace or control character, an account id 1 to 255 of them, and a plan fact 1 to 255 characters.",
      ),
    ),
  );
  yield* Ref.set(sending, true);
  const response = yield* send(
    hub.url,
    `api/pools/${encodeURIComponent(pool)}/quota-login`,
    { method: "PUT", cookie: hub.cookie, body },
  ).pipe(
    Effect.mapError(
      ({ why }) =>
        new Stop({
          code: 1,
          message: `The hub may not have kept the login: ${why}. GET /api/pools says whether it did.`,
        }),
    ),
  );
  if (response.status !== 200) {
    return yield* stop(
      1,
      `The hub did not keep the login: ${yield* problemOf(response)}`,
    );
  }
  yield* textOf(response);
});

const connect = (left: Ref.Ref<boolean>, sending: Ref.Ref<boolean>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const options = yield* optionsOf(process.argv.slice(2));
      yield* leftBehindNamed();
      const url = yield* hubUrlOf(
        process.env.COTA_HUB_URL,
        options.allowPlainHttp,
      );
      const password = yield* ownerPassword;
      const hub = yield* signedIn(url, password);
      const provider = yield* providerOf(hub, options.pool);
      const made =
        provider === "anthropic"
          ? yield* claudeLogin(options.email, left)
          : yield* chatGptLogin(left);
      yield* given(hub, options.pool, made.login, sending);
      yield* Console.log(
        `The hub now reads ${options.pool}'s quota windows with ${made.account}'s login.`,
      );
    }),
  );

// `runMain` interrupts the script on SIGINT and SIGTERM only. A terminal that closes sends SIGHUP, and Ctrl-\ SIGQUIT, each of which would otherwise end the process with no cleanup.
const interruptedOnHangUpAndQuit = Effect.withFiber((fiber) =>
  Effect.sync(() => {
    for (const signal of ["SIGHUP", "SIGQUIT"] as const) {
      process.on(signal, () => fiber.interruptUnsafe(fiber.id));
    }
  }),
);

const main = Effect.gen(function* () {
  yield* interruptedOnHangUpAndQuit;
  const left = yield* Ref.make(false);
  const sending = yield* Ref.make(false);
  const code = yield* connect(left, sending).pipe(
    Effect.as(0),
    Effect.catchTag("Stop", ({ code, message }) =>
      Effect.as(Console.error(message), code),
    ),
    Effect.catchDefect(() =>
      Effect.as(
        Console.error(
          "Something unexpected went wrong, and the script says no more of it so as to print no secret. GET /api/pools says whether the hub kept the login.",
        ),
        1,
      ),
    ),
    Effect.onInterrupt(() =>
      Effect.flatMap(Ref.get(sending), (sent) =>
        Console.error(
          sent
            ? "Interrupted: the hub may have kept the login. GET /api/pools says whether it did."
            : "Interrupted: the login was not kept.",
        ),
      ),
    ),
  );
  process.exitCode = (yield* Ref.get(left)) ? 1 : code;
});

if (import.meta.main) {
  BunRuntime.runMain(main, { disableErrorReporting: true });
}
