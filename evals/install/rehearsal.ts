import {
  type Block,
  blocksOf,
  type Change,
  changed,
  sectionOf,
  unmatchedOf,
} from "./document.ts";
import type { Installer, Machine, Owner, Ran } from "./installer.ts";
import { doctorOf } from "./observe.ts";
import type { Pool, PoolKind, Task } from "./tasks.ts";
import { checkout } from "./world.ts";

/** Every block of the install prompt the rehearsal knows, by what it does with it. */
export const known = {
  image: "The hub › 1. Build the hub image #1",
  hubDirectory: "The hub › 2. Make the hub directory #1",
  keys: "The hub › 3. Make the secrets #1",
  secretFile: "The hub › 3. Make the secrets #2",
  environment: "The hub › 4. Write `.env` and the configuration #1",
  configuration: "The hub › 4. Write `.env` and the configuration #2",
  pools: "The hub › 4. Write `.env` and the configuration #3",
  start: "The hub › 5. Start the hub #1",
  health: "The hub › 5. Start the hub #2",
  handOver: "The hub › 6. Hand the hub to the owner, and stop #1",
  build: "Each machine › 1. Build `cota`, and install it #1",
  join: "Each machine › 2. Join the hub #1",
  joinBySsh: "Each machine › 2. Join the hub #2",
  joined: "Each machine › 2. Join the hub #3",
  doctor: "Each machine › 3. Run doctor until it passes #1",
  login: "Each machine › 4. Machine logins, where a route needs one #1",
  route: "The routes #1",
} as const;

type Known = keyof typeof known;

/** Where step 1 of each machine installs `cota`, which every later command runs. */
const installed = "~/.local/bin/cota";

/** The prompt's example hub address, which every block that names the hub uses. */
const exampleHub = "http://studio.lan:8080";

/** The example table of each kind of pool in step 4's block. */
const exampleTables: Readonly<Record<PoolKind, string | undefined>> = {
  "claude-subscription": "work",
  "chatgpt-subscription": "chatgpt",
  zai: "zai",
  "opencode-go": undefined,
  local: undefined,
};

/** What a join says on a system without a scheduler, and the line for cron it gives. */
const notScheduled =
  "the title reporter was not scheduled: this system has no scheduler cota can use";
const cronLine = /(\* \* \* \* \* '[^'\n]+' titles report)/;

const outputOf = (ran: Ran) => `${ran.stdout}${ran.stderr}`;

/** The port of an address, as `COTA_PORT` publishes it. */
const portOf = (address: string): string => {
  const url = new URL(address);
  return url.port === ""
    ? url.protocol === "https:"
      ? "443"
      : "80"
    : url.port;
};

const lastLines = (ran: Ran) =>
  outputOf(ran).trim().split("\n").slice(-6).join("\n");

/** The tables of a TOML block, by the id of `[pools.<id>]`. */
const tablesOf = (text: string): ReadonlyMap<string, string> => {
  const tables = new Map<string, string>();
  for (const table of text.split(/\n(?=\[pools\.)/)) {
    const id = table.match(/^\[pools\.([\w-]+)\]/)?.[1];
    if (id !== undefined) tables.set(id, table.trim());
  }
  return tables;
};

/** The `[pools.<id>]` table the prompt's example gives a pool, with the owner's name and the files of step 3 as the hub's container sees them. */
export const tableOf = (block: Block, pool: Pool): string => {
  const example = exampleTables[pool.kind];
  const table =
    example === undefined ? undefined : tablesOf(block.text).get(example);
  if (example === undefined || table === undefined) {
    throw new Error(
      `${block.key} has no example of a ${pool.kind} pool for ${pool.id}.`,
    );
  }
  const lines = table
    .replace(`[pools.${example}]`, `[pools.${pool.id}]`)
    .replace(`/etc/cota/secrets/${example}`, `/etc/cota/secrets/${pool.id}`)
    .split("\n");
  return [
    ...lines,
    ...(pool.fallback === undefined ? [] : [`fallback = "${pool.fallback}"`]),
    ...(pool.keptLogin === true
      ? [`kept_login = { file = "/etc/cota/secrets/${pool.id}-login" }`]
      : []),
  ].join("\n");
};

/** The secrets the owner puts in files of step 3, by file name: each API plan's key and each kept login. */
export const secretFilesOf = (
  task: Task,
): ReadonlyArray<{ readonly name: string; readonly what: string }> => [
  ...task.pools.flatMap((pool) => [
    ...(pool.kind === "zai" || pool.kind === "opencode-go"
      ? [{ name: pool.id, what: `the API key of ${pool.id}` }]
      : []),
    ...(pool.keptLogin === true
      ? [
          {
            name: `${pool.id}-login`,
            what: `what claude setup-token prints, signed in to ${pool.id}`,
          },
        ]
      : []),
  ]),
];

const routesText = (task: Task) =>
  Object.entries(task.routes)
    .map(
      ([client, list]) =>
        `${client}: ${[...list.routes.map(({ pattern, pool }) => `${pattern} on ${pool}`), `the rest on ${list.defaultPool ?? "no pool"}`].join(", ")}`,
    )
    .join("\n");

/**
 * The scripted installer: it does what the install prompt says for a task,
 * each command the text of one of the prompt's fenced blocks with the owner's
 * answers put in, and stops at a block it does not know.
 */
export const rehearsal = (task: Task): Installer => ({
  name: "rehearsal",
  install: async ({ prompt, machines, owner }) => {
    const blocks = blocksOf(prompt);
    const { unknown, missing } = unmatchedOf(blocks, Object.values(known));
    if (unknown.length > 0 || missing.length > 0) {
      throw new Error(
        [
          ...unknown.map(
            (block) =>
              `the rehearsal does not know ${block.key}: ${block.text.split("\n")[0]}`,
          ),
          ...missing.map((key) => `the install prompt no longer has ${key}`),
        ].join("; "),
      );
    }
    const block = (name: Known): Block => {
      const found = blocks.find(({ key }) => key === known[name]);
      if (found === undefined)
        throw new Error(`the install prompt no longer has ${known[name]}`);
      return found;
    };
    const text = (name: Known, changes: ReadonlyArray<Change> = []) =>
      changed(block(name), changes);
    const machine = (name: string): Machine => {
      const found = machines.find((each) => each.name === name);
      if (found === undefined)
        throw new Error(`the world has no machine ${name}`);
      return found;
    };
    const run = async (
      on: Machine,
      name: Known,
      command: string,
      cwd = checkout,
    ): Promise<Ran> => {
      const ran = await on.run(command, { cwd });
      if (ran.exitCode !== 0) {
        throw new Error(
          `${known[name]} on ${on.name} exited ${ran.exitCode ?? "at its time limit"}: ${lastLines(ran)}`,
        );
      }
      return ran;
    };
    const ask = async (
      message: string,
      expect?: (answer: string) => boolean,
    ) => {
      const answer = await owner.tell(message);
      if (expect !== undefined && !expect(answer)) {
        throw new Error(
          `the owner answered: ${answer.split("\n").slice(0, 6).join(" ")}`,
        );
      }
      return answer;
    };
    const hubChange: Change = { from: exampleHub, to: task.hub.address };
    const hub = machine(task.hub.machine);

    await ask(
      `Before I run anything, please answer these:\n\n${sectionOf(prompt, "Ask the owner first")}`,
    );

    await run(hub, "image", text("image"));
    await run(hub, "hubDirectory", text("hubDirectory"));
    await run(hub, "keys", text("keys"));
    for (const { name, what } of secretFilesOf(task)) {
      await ask(
        `On ${hub.name}: please run this in your own terminal, paste ${what}, and press Enter and then Ctrl-D:\n\n${text("secretFile", [{ from: "zai", to: name }])}`,
        (answer) => answer.startsWith("Done"),
      );
    }
    await run(
      hub,
      "environment",
      text("environment", [
        { from: "COTA_BIND=127.0.0.1", to: `COTA_BIND=${task.hub.bind}` },
        { from: "COTA_PORT=8080", to: `COTA_PORT=${portOf(task.hub.address)}` },
      ]),
    );
    await run(hub, "configuration", text("configuration"));
    const tables = task.pools
      .map((pool) => tableOf(block("pools"), pool))
      .join("\n\n");
    await run(
      hub,
      "pools",
      `cat >> "$HOME/cota-hub/cota.toml" <<'EOF'\n\n${tables}\nEOF`,
    );
    await run(hub, "start", text("start"));
    const health = text("health", [hubChange]);
    let healthy: Ran | undefined;
    for (let attempt = 0; attempt < 30 && healthy === undefined; attempt++) {
      const ran = await hub.run(health, { cwd: checkout });
      if (/\{"status":"ok"\}\s*1\s*$/.test(ran.stdout)) healthy = ran;
      else await Bun.sleep(2_000);
    }
    if (healthy === undefined) {
      throw new Error(
        `${known.health}: the hub did not answer {"status":"ok"} and 1 in a minute; docker compose logs hub in ~/cota-hub on ${hub.name} says why`,
      );
    }
    await ask(
      text("handOver", [
        { from: "`$HUB` (give the address)", to: `\`${task.hub.address}\`` },
      ]),
      (answer) => answer === "I am signed in.",
    );

    const joinedLine =
      block("joined").text.split("\n")[0]?.split(" http")[0] ?? "cota: joined";
    const ordered = [
      hub,
      ...task.machines
        .filter(({ name }) => name !== hub.name)
        .map(({ name }) => machine(name)),
    ];
    const plainHttp =
      task.hub.address.startsWith("http:") && task.hub.plainHttpAccepted;
    for (const each of ordered) {
      const built = await run(each, "build", text("build"));
      if (!built.stdout.includes("cli:build: bun-linux-")) {
        throw new Error(
          `${known.build} on ${each.name} did not print cli:build: bun-linux-…`,
        );
      }
      const joinOutput =
        each === hub
          ? outputOf(
              await run(
                each,
                "join",
                text("join", [
                  hubChange,
                  ...(plainHttp
                    ? [
                        {
                          from: 'join "$HUB"',
                          to: 'join "$HUB" --allow-plain-http',
                        },
                      ]
                    : []),
                ]),
              ),
            )
          : await ask(
              `On ${each.name}: it does not reach ${hub.name} by ssh, so please run \`${installed} join "${task.hub.address}"${plainHttp ? " --allow-plain-http" : ""}\` in your own terminal there, in its checkout, and paste the keys from ${hub.name}'s ~/cota-hub/secrets/clients and ~/cota-hub/secrets/fleet, then an empty line.`,
              (answer) => answer.startsWith("Done"),
            );
      if (
        !joinOutput.includes(
          `${joinedLine} ${task.hub.address} as ${each.name}`,
        )
      ) {
        throw new Error(
          `${each.name} did not say ${joinedLine} ${task.hub.address} as ${each.name}: ${joinOutput.split("\n").slice(-6).join(" ")}`,
        );
      }
      const cron = joinOutput.includes(notScheduled)
        ? joinOutput.match(cronLine)?.[1]
        : undefined;
      if (joinOutput.includes(notScheduled)) {
        await ask(
          `On ${each.name}: this system has no scheduler cota can use, so the title reporter is not scheduled. Please add this line to your crontab (crontab -e), which is yours: ${cron ?? "the join gave no line for cron"}`,
          (answer) => answer.startsWith("Done"),
        );
      }
      await doctorUntilItPasses(each, owner, text("doctor"), run);
      for (const pool of task.machines.find(({ name }) => name === each.name)
        ?.machineLogins ?? []) {
        await ask(
          `On ${each.name}: a route sends acme's projects to ${pool}, a subscription Claude Code there is not signed in to. Please run \`${text("login", [{ from: "personal", to: pool }])}\` in your own terminal there, in its checkout, signed in to ${pool} with claude setup-token, and give it what that prints.`,
          (answer) => answer.startsWith("Done"),
        );
      }
    }

    await ask(
      `Please set these routes in the dashboard's Settings → Routes, which needs the owner password:\n\n${routesText(task)}`,
      (answer) => answer.startsWith("I set them"),
    );
    for (const { name, projects } of task.machines) {
      for (const { directory } of projects) {
        const ran = await run(
          machine(name),
          "route",
          text("route", [{ from: "~/src/acme-api", to: `~/${directory}` }]),
        );
        if (!ran.stdout.includes("project") || !ran.stdout.includes("pool")) {
          throw new Error(
            `${known.route} on ${name} in ~/${directory} printed no project and pool: ${lastLines(ran)}`,
          );
        }
      }
    }

    await ask(
      `${
        sectionOf(prompt, "Done")
          .split("\n")
          .find((line) => line.startsWith("2."))
          ?.replace(/^2\. /, "") ??
        "Please start claude in a project and send one message."
      }\n\nPlease send one message from each machine you work on.`,
      (answer) => !answer.includes("It exited"),
    );
    for (const each of ordered)
      await doctorUntilItPasses(each, owner, text("doctor"), run);
    await owner.tell(
      `I am done. ${ordered.map(({ name }) => name).join(" and ")} are joined to the hub at ${task.hub.address}, and doctor passes on each. You set the hub up, typed every key and login, and set the routes.`,
    );
  },
});

/** Step 3 of each machine: doctor, and what its table says to do for each check that failed, until it passes. */
const doctorUntilItPasses = async (
  machine: Machine,
  owner: Owner,
  doctor: string,
  run: (on: Machine, name: Known, command: string) => Promise<Ran>,
) => {
  for (let round = 1; round <= 4; round++) {
    const ran = await machine.run(doctor, { cwd: checkout });
    if (ran.exitCode === 0 && !/^failed/m.test(ran.stdout)) return;
    const report = doctorOf(
      (await machine.run(`${doctor} --json`, { cwd: checkout })).stdout,
    );
    for (const check of report.checks.filter(
      ({ outcome }) => outcome === "failed",
    )) {
      const fix = check.fix ?? "";
      if (check.id === "files" && fix.startsWith("chmod "))
        await run(machine, "doctor", fix);
      else if (check.id === "shims" || check.id === "path")
        await run(machine, "doctor", `${installed} shims`);
      else if (check.id === "kept-routes" && fix.startsWith("rm "))
        await run(machine, "doctor", fix);
      else if (check.id === "configured")
        await run(machine, "doctor", `${installed} configure`);
      else if (check.id === "titles" && fix.includes("crontab")) {
        const line = fix.match(cronLine)?.[1];
        await owner.tell(
          `On ${machine.name}: this system has no scheduler cota can use. May I ask you to add this line to your crontab (crontab -e)? ${line ?? fix}`,
        );
      } else if (check.id === "titles") {
        await run(machine, "doctor", `${installed} titles schedule`);
        await run(machine, "doctor", `${installed} titles report`);
      } else {
        throw new Error(
          `${known.doctor} on ${machine.name}: ${check.id} failed (${check.problem ?? ""}), and its fix is not the rehearsal's to do: ${fix}`,
        );
      }
    }
  }
  throw new Error(
    `${known.doctor} on ${machine.name}: doctor still fails after four rounds of fixes`,
  );
};
