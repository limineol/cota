export type ClientName = "claude" | "codex";
export const routedClients = ["claude-code", "codex"] as const;
export type RoutedClient = (typeof routedClients)[number];

export type PoolKind =
  | "claude-subscription"
  | "chatgpt-subscription"
  | "zai"
  | "opencode-go"
  | "local";

export interface Pool {
  readonly id: string;
  readonly kind: PoolKind;
  /** The pool a refused login of this one goes to. */
  readonly fallback?: string;
  /** Whether the pool keeps a login, as a fallback does: the owner pastes it. */
  readonly keptLogin?: boolean;
}

export interface Project {
  /** Under the owner's home. */
  readonly directory: string;
  /** Its `origin`, or none. */
  readonly remote: string | null;
}

export interface MachineOfTask {
  readonly name: string;
  readonly clients: ReadonlyArray<ClientName>;
  /** The pools whose machine login the owner gives this machine. */
  readonly machineLogins: ReadonlyArray<string>;
  readonly projects: ReadonlyArray<Project>;
}

export interface RouteList {
  readonly routes: ReadonlyArray<{
    readonly pattern: string;
    readonly pool: string;
  }>;
  readonly defaultPool: string | null;
}

/** A launch the owner makes once the installer is done, and the request the hub should then have. */
export interface Launch {
  readonly machine: string;
  readonly directory: string;
  readonly message: string;
  readonly project: string;
  readonly pool: string;
}

export interface Task {
  readonly id: string;
  /** What the owner first says to the installer, before it asks anything. */
  readonly ask: string;
  /** The owner's answers to the prompt's "Ask the owner first", as the owner would write them. */
  readonly words: string;
  readonly hub: {
    readonly machine: string;
    readonly address: string;
    readonly plainHttpAccepted: boolean;
    /** Where the deployment publishes the hub on its machine, `COTA_BIND`, for the machines to reach it at `address`. */
    readonly bind: string;
  };
  readonly pools: ReadonlyArray<Pool>;
  readonly machines: ReadonlyArray<MachineOfTask>;
  readonly routes: Readonly<Record<RoutedClient, RouteList>>;
  readonly launches: ReadonlyArray<Launch>;
}

const studioAndLaptop: Task = {
  id: "studio-and-laptop",
  ask: "Please install Cota for me, on my machines studio and laptop, as its install document below says.",
  words: `1. The hub runs on studio, the machine you are on; it stays on, and every machine reaches it. It has Docker and curl, and reaches GitHub; you may run Cota's Compose project in its Docker. I do not run a ClickHouse of my own.
2. Pools: my Claude Max for work is "work", and my own Claude Pro is "personal", which is work's fallback; my ChatGPT subscription is "chatgpt", for Codex; and my Z.ai coding plan is "zai".
3. The machines reach the hub at http://studio:8080. It is plain http on my own network, and I accept that.
4. Join studio and laptop; each has curl and reaches GitHub. Both have Claude Code and Codex, neither OpenCode nor Pi. Claude Code is signed in to personal on both; on laptop I also work on acme's projects, so give laptop a machine login for work. Acme's projects (acme/*) bill work and everything else personal; Codex bills chatgpt.`,
  hub: {
    machine: "studio",
    address: "http://studio:8080",
    plainHttpAccepted: true,
    bind: "0.0.0.0",
  },
  pools: [
    { id: "work", kind: "claude-subscription", fallback: "personal" },
    { id: "personal", kind: "claude-subscription", keptLogin: true },
    { id: "chatgpt", kind: "chatgpt-subscription" },
    { id: "zai", kind: "zai" },
  ],
  machines: [
    {
      name: "studio",
      clients: ["claude", "codex"],
      machineLogins: [],
      projects: [{ directory: "src/notes", remote: null }],
    },
    {
      name: "laptop",
      clients: ["claude", "codex"],
      machineLogins: ["work"],
      projects: [
        { directory: "src/acme-api", remote: "git@github.com:Acme/API.git" },
      ],
    },
  ],
  routes: {
    "claude-code": {
      routes: [{ pattern: "acme/*", pool: "work" }],
      defaultPool: "personal",
    },
    codex: { routes: [], defaultPool: "chatgpt" },
  },
  launches: [
    {
      machine: "laptop",
      directory: "src/acme-api",
      message: "Say hello from laptop",
      project: "acme/api",
      pool: "work",
    },
    {
      machine: "studio",
      directory: "src/notes",
      message: "Say hello from studio",
      project: "notes",
      pool: "personal",
    },
  ],
};

export const tasks: ReadonlyArray<Task> = [studioAndLaptop];
