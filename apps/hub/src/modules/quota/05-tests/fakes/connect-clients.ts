import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Fakes of `claude`, `codex` and `security` for the connect script's tests, run as
 * `connect-clients.ts <settings file> <name> <arguments>` by a wrapper of that name on `PATH`.
 * They take their settings from a file, since the script gives a client only part of its
 * environment. They sign in to nobody: what a sign-in leaves is the file `login` names, and the
 * keychain is a directory of files, `keychain`. Each run is written to `log`.
 */

export interface Settings {
  readonly log: string;
  readonly keychain: string;
  readonly login?: string;
  /** A file the sign-in writes `<wait>.ready` beside, then waits for `<wait>.go`. */
  readonly wait?: string;
  readonly loginExit?: number;
  readonly statusEmail?: string;
  /** The sign-in keeps its login in the item of the owner's own Claude Code, as a Claude Code that ignored its configuration directory would. */
  readonly ownersItem?: boolean;
  /** The keychain holds an item, which nobody in the test made, of every name that starts with this. */
  readonly foreignItems?: string;
}

export interface Run {
  readonly name: string;
  readonly args: ReadonlyArray<string>;
  readonly pid: number;
  readonly configDir: string | null;
  readonly codexHome: string | null;
  /** The names of the variables the client was given, never their values. */
  readonly environment: ReadonlyArray<string>;
}

/** What the wrapper's shell adds to the environment it was given. */
const addedByTheShell = ["PWD", "SHLVL", "_", "OLDPWD"];

/** The keychain item of the owner's own Claude Code, which uses no configuration directory of its own. */
export const ownersItem = "Claude Code-credentials";

/** The keychain item Claude Code makes for a configuration directory, named after its path. */
export const serviceOf = (configDir: string) =>
  `Claude Code-credentials-${createHash("sha256").update(configDir).digest("hex").slice(0, 8)}`;

const [settingsFile = "", name = "", ...args] = process.argv.slice(2);

const settings = (): Settings => JSON.parse(readFileSync(settingsFile, "utf8"));

const itemPath = (service: string) =>
  join(settings().keychain, encodeURIComponent(service));

const waited = async () => {
  const { wait } = settings();
  if (wait === undefined) return;
  writeFileSync(`${wait}.ready`, String(process.pid));
  for (let step = 0; step < 1000 && !existsSync(`${wait}.go`); step++) {
    await Bun.sleep(20);
  }
};

const signedIn = async (leave: (login: string) => void) => {
  const { login, loginExit } = settings();
  if (login !== undefined) leave(readFileSync(login, "utf8"));
  await waited();
  return loginExit ?? 0;
};

const claude = async (args: ReadonlyArray<string>) => {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? "";
  if (args[0] === "auth" && args[1] === "login") {
    const email = args[args.indexOf("--email") + 1] ?? "";
    writeFileSync(join(configDir, "account"), email);
    return signedIn((login) => {
      writeFileSync(
        itemPath(settings().ownersItem ? ownersItem : serviceOf(configDir)),
        login,
      );
    });
  }
  if (args[0] === "auth" && args[1] === "status") {
    const account = join(configDir, "account");
    const email =
      settings().statusEmail ??
      (existsSync(account) ? readFileSync(account, "utf8") : null);
    console.log(
      JSON.stringify({
        loggedIn: email !== null,
        authMethod: "claude.ai",
        email,
      }),
    );
    return 0;
  }
  return 1;
};

const codex = async (args: ReadonlyArray<string>) => {
  if (args[0] !== "login") return 1;
  return signedIn((login) => {
    writeFileSync(join(process.env.CODEX_HOME ?? "", "auth.json"), login);
  });
};

const security = async (args: ReadonlyArray<string>) => {
  const service = args[args.indexOf("-s") + 1] ?? "";
  const path = itemPath(service);
  const { foreignItems } = settings();
  if (
    foreignItems !== undefined &&
    service.startsWith(foreignItems) &&
    !existsSync(path)
  ) {
    writeFileSync(path, "a login nobody in the test made");
  }
  if (!existsSync(path)) {
    console.error(
      "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
    );
    return 44;
  }
  if (args[0] === "find-generic-password") {
    console.log(
      args.includes("-w")
        ? readFileSync(path, "utf8")
        : `keychain: "fake"\nclass: "genp"\nattributes:\n    "svce"<blob>="${service}"\n    "mdat"<timedate>="${statSync(path).mtimeMs}"`,
    );
    return 0;
  }
  if (args[0] === "delete-generic-password") {
    rmSync(path);
    console.log(
      `keychain: "fake"\nclass: "genp"\n    "svce"<blob>="${service}"\npassword has been deleted.`,
    );
    return 0;
  }
  return 1;
};

const fakes: Record<string, (args: ReadonlyArray<string>) => Promise<number>> =
  {
    claude,
    codex,
    security,
  };

if (import.meta.main) {
  const run: Run = {
    name,
    args,
    pid: process.pid,
    configDir: process.env.CLAUDE_CONFIG_DIR ?? null,
    codexHome: process.env.CODEX_HOME ?? null,
    environment: Object.keys(process.env)
      .filter((variable) => !addedByTheShell.includes(variable))
      .sort(),
  };
  appendFileSync(settings().log, `${JSON.stringify(run)}\n`);
  process.exit(await (fakes[name] ?? (async () => 127))(args));
}
