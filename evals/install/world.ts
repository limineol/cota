import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ran } from "./installer.ts";
import type { Task } from "./tasks.ts";

const worldFolder = fileURLToPath(new URL("world", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));

const bunImage =
  "oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895";
const bunSlimImage =
  "oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61";
const machineImage = "cota-install-machine";
const hubMachineImage = "cota-install-hub-machine";

/** The Compose file the world adds to every `docker compose` on the hub's machine, by `COMPOSE_FILE`: the hub's container trusts the fake provider's CA, as the machines do. */
const worldComposeFile = "/etc/cota-install/compose.world.yaml";
const worldCompose = `services:
  hub:
    environment:
      NODE_EXTRA_CA_CERTS: /etc/cota-install/ca.crt
    volumes:
      - type: bind
        source: /etc/cota-install/ca.crt
        target: /etc/cota-install/ca.crt
        read_only: true
`;

/** Every host name of a provider the hub or a client may call: on the world's network each is the fake provider's. */
export const providerHosts = [
  "api.anthropic.com",
  "console.anthropic.com",
  "platform.claude.com",
  "claude.ai",
  "chatgpt.com",
  "api.openai.com",
  "auth.openai.com",
  "api.z.ai",
  "opencode.ai",
  "openrouter.ai",
  "models.dev",
];

export const home = "/home/owner";
export const checkout = `${home}/cota`;

export interface ShellOptions {
  readonly user?: "owner" | "root";
  readonly cwd?: string;
  readonly stdin?: string | Uint8Array;
  readonly limitMs?: number;
}

export interface World {
  readonly project: string;
  /** Runs a command with `bash -c` in a machine, unrecorded. */
  readonly shell: (
    machine: string,
    command: string,
    options?: ShellOptions,
  ) => Promise<Ran>;
  /** Answers SQL against the deployment's ClickHouse on the hub's machine, one JSON object a line. */
  readonly clickhouse: (sql: string) => Promise<string>;
  /** What the deployment's hub has logged, every container of it. */
  readonly hubLog: () => Promise<string>;
  /** Removes the world whole: its containers, network and volumes. */
  readonly remove: () => void;
}

const spawned = async (
  argv: ReadonlyArray<string>,
  stdin: string | Uint8Array | undefined,
  limitMs: number,
): Promise<Ran> => {
  const child = Bun.spawn([...argv], {
    stdin:
      stdin === undefined
        ? "ignore"
        : typeof stdin === "string"
          ? Buffer.from(stdin)
          : stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  let stopped = false;
  const timer = setTimeout(() => {
    stopped = true;
    child.kill("SIGKILL");
  }, limitMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { exitCode: stopped ? null : exitCode, stdout, stderr };
};

const must = (what: string, ran: Ran): Ran => {
  if (ran.exitCode !== 0) {
    throw new Error(
      `${what} ${ran.exitCode === null ? "did not finish in its time" : `exited ${ran.exitCode}`}: ${`${ran.stderr}\n${ran.stdout}`.trim().split("\n").slice(-8).join("\n")}`,
    );
  }
  return ran;
};

const certificates = (folder: string) => {
  const openssl = (...args: ReadonlyArray<string>) => {
    const ran = Bun.spawnSync(["openssl", ...args], {
      cwd: folder,
      stderr: "pipe",
    });
    if (ran.exitCode !== 0) {
      throw new Error(`openssl ${args[0]} failed: ${ran.stderr.toString()}`);
    }
  };
  const key = [
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
  ];
  openssl(
    "req",
    "-x509",
    ...key,
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-days",
    "2",
    "-subj",
    "/CN=Cota install eval CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign",
  );
  openssl(
    "req",
    ...key,
    "-keyout",
    "provider.key",
    "-out",
    "provider.csr",
    "-subj",
    "/CN=Cota install eval provider",
  );
  writeFileSync(
    join(folder, "provider.ext"),
    `subjectAltName=${providerHosts.map((host) => `DNS:${host}`).join(",")}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`,
  );
  openssl(
    "x509",
    "-req",
    "-in",
    "provider.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "provider.crt",
    "-days",
    "2",
    "-extfile",
    "provider.ext",
  );
};

/** The world's Compose project, as JSON, which Compose reads as YAML. */
export const composeOf = (project: string, task: Task, folder: string) => {
  const others = task.machines.filter(({ name }) => name !== task.hub.machine);
  const machine = (name: string) => {
    const isHub = name === task.hub.machine;
    const builds = isHub || others[0]?.name === name;
    return {
      ...(builds
        ? {
            build: {
              context: worldFolder,
              dockerfile: "machine.Dockerfile",
              target: isHub ? "hub" : "machine",
            },
          }
        : {}),
      image: isHub ? hubMachineImage : machineImage,
      pull_policy: builds ? "build" : "never",
      hostname: name,
      init: true,
      environment: {
        NODE_EXTRA_CA_CERTS: "/etc/cota-install/ca.crt",
        ...(isHub ? { COMPOSE_FILE: `compose.yaml:${worldComposeFile}` } : {}),
      },
      volumes: [
        `${join(folder, "ca.crt")}:/etc/cota-install/ca.crt:ro`,
        ...(isHub
          ? [
              `${join(folder, "compose.world.yaml")}:${worldComposeFile}:ro`,
              "/var/lib/docker",
            ]
          : []),
      ],
      // The hub's machine runs a Docker engine of its own, which needs it;
      // no other service of the world is privileged.
      ...(isHub ? { privileged: true } : {}),
      depends_on: { provider: { condition: "service_started" } },
    };
  };
  return {
    name: project,
    services: {
      ...Object.fromEntries(
        task.machines.map(({ name }) => [name, machine(name)]),
      ),
      provider: {
        image: bunImage,
        command: ["bun", "/provider/provider.ts"],
        volumes: [
          `${join(worldFolder, "provider.ts")}:/provider/provider.ts:ro`,
          `${join(folder, "provider.crt")}:/provider/provider.crt:ro`,
          `${join(folder, "provider.key")}:/provider/provider.key:ro`,
        ],
        networks: { default: { aliases: providerHosts } },
      },
    },
  };
};

const standIn = (client: string) => join(worldFolder, "stand-ins", client);

/**
 * Makes the world of a run: its Compose project up, each machine given the
 * owner's files, the checkout of `commit` and the stand-ins of its clients,
 * and every provider's name checked to reach the fake provider. It removes
 * what it made when it cannot finish.
 */
export const makeWorld = async (options: {
  readonly run: string;
  readonly task: Task;
  readonly commit: string;
  readonly folder: string;
  readonly say: (line: string) => void;
  /** Called with the world as soon as it exists, so an interrupt can remove it. */
  readonly made: (world: World) => void;
}): Promise<World> => {
  const { run, task, commit, folder, say } = options;
  const project = `cota-install-${run}`;
  const hubMachine = task.hub.machine;
  mkdirSync(folder, { recursive: true });
  certificates(folder);
  writeFileSync(join(folder, "compose.world.yaml"), worldCompose);
  const composeFile = join(folder, "compose.json");
  writeFileSync(
    composeFile,
    JSON.stringify(composeOf(project, task, folder), null, 2),
  );
  const compose = ["docker", "compose", "-p", project, "-f", composeFile];
  const shell = (
    machine: string,
    command: string,
    shellOptions: ShellOptions = {},
  ) => {
    const user = shellOptions.user ?? "owner";
    return spawned(
      [
        ...compose,
        "exec",
        "-T",
        "-u",
        user,
        "-w",
        shellOptions.cwd ?? (user === "owner" ? home : "/"),
        ...(user === "owner"
          ? [
              "-e",
              `HOME=${home}`,
              "-e",
              "USER=owner",
              "-e",
              "LOGNAME=owner",
              "-e",
              "SHELL=/bin/bash",
              "-e",
              "LANG=C.UTF-8",
            ]
          : []),
        machine,
        "bash",
        "-c",
        command,
      ],
      shellOptions.stdin,
      shellOptions.limitMs ?? 600_000,
    );
  };
  const containersOf = (service: string) =>
    `docker ps --all --quiet --filter label=com.docker.compose.project=cota --filter label=com.docker.compose.service=${service}`;
  const world: World = {
    project,
    shell,
    clickhouse: async (sql) =>
      must(
        "ClickHouse",
        await shell(
          hubMachine,
          `docker exec -i $(${containersOf("clickhouse")} | head -n 1) sh -c 'clickhouse-client --user cota --password "$(cat /etc/cota/secrets/clickhouse)" --database cota --format JSONEachRow'`,
          { user: "root", stdin: sql, limitMs: 60_000 },
        ),
      ).stdout,
    hubLog: async () =>
      must(
        "the hub's log",
        await shell(
          hubMachine,
          `for container in $(${containersOf("hub")}); do docker logs "$container" 2>&1; done`,
          { user: "root", limitMs: 60_000 },
        ),
      ).stdout,
    remove: () => {
      Bun.spawnSync(
        [...compose, "down", "--volumes", "--remove-orphans", "--timeout", "3"],
        {
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      rmSync(folder, { recursive: true, force: true });
    },
  };
  options.made(world);
  say(`${project}: building the clean machines and starting the world`);
  must(
    "docker compose build",
    await spawned([...compose, "build"], undefined, 900_000),
  );
  must(
    "docker compose up",
    await spawned([...compose, "up", "--detach", "--wait"], undefined, 600_000),
  );
  const bundle = join(folder, "cota.bundle");
  const bundled = Bun.spawnSync(["git", "bundle", "create", bundle, "HEAD"], {
    cwd: root,
    stderr: "pipe",
  });
  if (bundled.exitCode !== 0)
    throw new Error(`git bundle failed: ${bundled.stderr.toString()}`);
  for (const machine of task.machines) {
    for (const client of machine.clients) {
      must(
        `the stand-in ${client} on ${machine.name}`,
        await shell(
          machine.name,
          `mkdir -p /usr/local/lib/stand-ins && cat > /usr/local/lib/stand-ins/${client} && chmod 755 /usr/local/lib/stand-ins/${client} && ln -sf ../lib/stand-ins/${client} /usr/local/bin/${client}`,
          {
            user: "root",
            stdin: await Bun.file(standIn(client)).bytes(),
          },
        ),
      );
    }
    must(
      `the checkout on ${machine.name}`,
      await shell(
        machine.name,
        `cat > /tmp/cota.bundle && git init -q ${checkout} && git -C ${checkout} fetch -q /tmp/cota.bundle HEAD && git -C ${checkout} checkout -q --detach ${commit} && rm /tmp/cota.bundle`,
        { stdin: await Bun.file(bundle).bytes() },
      ),
    );
    const projects = machine.projects.map(
      ({ directory, remote }) =>
        `mkdir -p ~/${directory} && git -C ~/${directory} init -q${remote === null ? "" : ` && git -C ~/${directory} remote add origin '${remote}'`}`,
    );
    must(
      `the owner's files on ${machine.name}`,
      await shell(
        machine.name,
        [
          "mkdir -p ~/.codex",
          `printf '%s\\n' 'model = "gpt-5.5"' '' '[profiles.review]' 'model = "gpt-5.5-codex"' > ~/.codex/config.toml`,
          ...projects,
        ].join(" && "),
      ),
    );
    const reached = await providerReached(shell, machine.name);
    if (!reached) {
      throw new Error(
        `${machine.name}: the providers' names do not reach the fake provider, so nothing is run`,
      );
    }
  }
  await engineStarted(shell, hubMachine);
  if (!(await providerReachedFromEngine(shell, hubMachine))) {
    throw new Error(
      `${hubMachine}: a container of its Docker engine does not reach the fake provider by the providers' names, so nothing is run`,
    );
  }
  return world;
};

const reachesProviders = `for (const host of ${JSON.stringify(providerHosts)}) { const text = await (await fetch("https://" + host + "/")).text(); if (!text.includes("install eval's fake provider")) { console.log(host); process.exit(1); } }`;

const providerReached = async (
  shell: World["shell"],
  machine: string,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const ran = await shell(machine, 'bun -e "$(cat)"', {
      stdin: reachesProviders,
      limitMs: 30_000,
    });
    if (ran.exitCode === 0) return true;
    await Bun.sleep(1_000);
  }
  return false;
};

/** Waits for the hub's machine's own Docker engine to answer its owner. */
const engineStarted = async (shell: World["shell"], machine: string) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ran = await shell(
      machine,
      "docker info --format '{{.ServerVersion}}'",
      {
        limitMs: 15_000,
      },
    );
    if (ran.exitCode === 0) return;
    await Bun.sleep(1_000);
  }
  const log = await shell(machine, "tail -n 20 /var/log/dockerd.log", {
    user: "root",
  });
  throw new Error(
    `${machine}: its Docker engine did not start in a minute: ${log.stdout}`,
  );
};

/** Whether a container of the hub's machine's engine, on a network of its own as the deployment's are, reaches the fake provider by every provider's name. */
const providerReachedFromEngine = async (
  shell: World["shell"],
  machine: string,
): Promise<boolean> => {
  const network = "cota-install-check";
  await shell(machine, `docker network create ${network}`, { user: "root" });
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const ran = await shell(
        machine,
        `docker run --rm -i --network ${network} -v /etc/cota-install/ca.crt:/etc/cota-install/ca.crt:ro -e NODE_EXTRA_CA_CERTS=/etc/cota-install/ca.crt '${bunSlimImage}' sh -c 'bun -e "$(cat)"'`,
        { user: "root", stdin: reachesProviders, limitMs: 300_000 },
      );
      if (ran.exitCode === 0) return true;
      await Bun.sleep(2_000);
    }
    return false;
  } finally {
    await shell(machine, `docker network rm ${network}`, { user: "root" });
  }
};
