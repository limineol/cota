import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = crypto.randomUUID().slice(0, 8);
const project = `cota-deploy-${run}`;
const firstImage = `cota-hub:deploy-${run}`;
const newerImage = `cota-hub:deploy-${run}-newer`;
const ownerPassword = `owner-password-${crypto.randomUUID()}`;
const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;

interface Ran {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const spawned = async (
  argv: ReadonlyArray<string>,
  options: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly limitMs?: number;
  } = {},
): Promise<Ran> => {
  const child = Bun.spawn([...argv], {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let stopped = false;
  const timer = setTimeout(() => {
    stopped = true;
    child.kill("SIGKILL");
  }, options.limitMs ?? 300_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { exitCode: stopped ? null : exitCode, stdout, stderr };
};

const must = (what: string, ran: Ran): string => {
  if (ran.exitCode !== 0) {
    throw new Error(
      `${what} exited ${ran.exitCode ?? "at its time limit"}: ${`${ran.stderr}\n${ran.stdout}`.trim().split("\n").slice(-12).join("\n")}`,
    );
  }
  return ran.stdout;
};

const hubDirectory = mkdtempSync(join(tmpdir(), "cota-deploy-"));

/** The project's own name, and the fake provider's Compose file beside the deployment's, for every command run in the hub directory. */
const composeEnvironment = {
  COMPOSE_PROJECT_NAME: project,
  COMPOSE_FILE: "compose.yaml:compose.provider.yaml",
};

const compose = (args: ReadonlyArray<string>, limitMs = 300_000) =>
  spawned(["docker", "compose", ...args], {
    cwd: hubDirectory,
    env: composeEnvironment,
    limitMs,
  });

/** Runs a block of the deployment spec, as the owner types it, in the hub directory. */
const shell = (script: string) =>
  spawned(["sh", "-ec", script], {
    cwd: hubDirectory,
    env: composeEnvironment,
  });

const port = (() => {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data: () => {} },
  });
  const free = server.port;
  server.stop(true);
  return free;
})();
const hub = `http://127.0.0.1:${port}`;

const secret = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
const fleetKey = secret();

const provider = `Bun.serve({
  port: 8000,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions")
      return new Response("not found", { status: 404 });
    const { model } = await request.json();
    return Response.json({
      id: "chatcmpl-deploy",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: "Hello from the fake provider." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    });
  },
});
`;

/** The hub directory as the install makes it (docs/specs/deployment/spec.md, Making one), with a pool pointed at the fake provider. */
const makeHubDirectory = () => {
  chmodSync(hubDirectory, 0o700);
  for (const folder of ["secrets", "store", "archive"]) {
    mkdirSync(join(hubDirectory, folder), { mode: 0o700 });
  }
  for (const name of ["clickhouse", "clients", "fleet", "agents"]) {
    writeFileSync(
      join(hubDirectory, "secrets", name),
      `${name === "fleet" ? fleetKey : secret()}\n`,
      { mode: 0o600 },
    );
  }
  copyFileSync(
    join(root, "deploy", "compose.yaml"),
    join(hubDirectory, "compose.yaml"),
  );
  writeFileSync(
    join(hubDirectory, "cota.toml"),
    `${readFileSync(join(root, "deploy", "cota.toml"), "utf8")}
[pools.local]
protocol = "openai-chat"
provider = "fake"
base_url = "http://provider:8000/v1"
`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(hubDirectory, ".env"),
    [
      `COTA_HUB_IMAGE=${firstImage}`,
      `COTA_UID=${uid}`,
      `COTA_GID=${gid}`,
      "COTA_BIND=127.0.0.1",
      `COTA_PORT=${port}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(join(hubDirectory, "provider.ts"), provider);
  writeFileSync(
    join(hubDirectory, "compose.provider.yaml"),
    [
      "services:",
      "  provider:",
      "    image: ${COTA_HUB_IMAGE}",
      '    command: ["bun", "/provider/provider.ts"]',
      "    volumes:",
      "      - ./provider.ts:/provider/provider.ts:ro",
      "",
    ].join("\n"),
  );
};

const guardsLine =
  "ClickHouse's password file /etc/cota/secrets/clickhouse is missing or empty; the install makes it";

const envImage = () =>
  readFileSync(join(hubDirectory, ".env"), "utf8").match(
    /^COTA_HUB_IMAGE=(.*)$/m,
  )?.[1];

const runningImage = async () =>
  must(
    "docker inspect",
    await spawned([
      "docker",
      "inspect",
      "--format",
      "{{.Config.Image}}",
      must("docker compose ps", await compose(["ps", "--quiet", "hub"])).trim(),
    ]),
  ).trim();

const runningServices = async () =>
  must(
    "docker compose ps",
    await compose(["ps", "--status", "running", "--services"]),
  )
    .split("\n")
    .filter((line) => line !== "");

let cookie = "";

const call = async (
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
) => {
  const answer = await fetch(`${hub}${path}`, {
    method: init.method ?? "GET",
    headers: {
      cookie,
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const set = answer.headers.getSetCookie()[0]?.split(";")[0];
  if (set !== undefined) cookie = set;
  return answer;
};

const SqlAnswer = Schema.Struct({
  rows: Schema.Array(Schema.Array(Schema.Unknown)),
});

const requestsLogged = async (): Promise<number> => {
  const answer = await call("/api/sql", {
    method: "POST",
    body: { sql: "SELECT count() FROM requests WHERE project = 'deployment'" },
  });
  expect(answer.status).toBe(200);
  const { rows } = Schema.decodeUnknownSync(SqlAnswer)(await answer.json());
  return Number(rows[0]?.[0]);
};

const waitFor = async (what: string, done: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await done()) return;
    await Bun.sleep(1_000);
  }
  throw new Error(`${what} did not happen within a minute`);
};

const sendRequest = async (message: string) => {
  const answer = await fetch(`${hub}/pools/local/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${fleetKey}`,
      "content-type": "application/json",
      "x-cota-project": "deployment",
    },
    body: JSON.stringify({
      model: "fake-model",
      messages: [{ role: "user", content: message }],
    }),
  });
  expect(answer.status).toBe(200);
  await answer.text();
};

const DisplayNames = Schema.Struct({
  names: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      key: Schema.String,
      name: Schema.String,
    }),
  ),
});

const ownersNames = async () => {
  const answer = await call("/api/display-names");
  expect(answer.status).toBe(200);
  return Schema.decodeUnknownSync(DisplayNames)(await answer.json())
    .names.filter(({ kind }) => kind === "pool")
    .map(({ key, name }) => `${key}: ${name}`);
};

const archived = () =>
  readdirSync(join(hubDirectory, "archive"), { recursive: true })
    .map(String)
    .sort();

/** The sh blocks of the deployment spec's "Upgrading and rolling back", as the owner types them. */
const blocksOfUpgrade = () => {
  const spec = readFileSync(
    join(root, "docs", "specs", "deployment", "spec.md"),
    "utf8",
  );
  const section =
    spec.split("## Upgrading and rolling back")[1]?.split("\n## ")[0] ?? "";
  const blocks = [...section.matchAll(/```sh\n([\s\S]*?)```/g)].map(
    (match) => match[1] ?? "",
  );
  const [upgrade, rollback] = blocks;
  if (upgrade === undefined || rollback === undefined)
    throw new Error("the deployment spec has no upgrade and rollback blocks");
  const [beforeNaming, afterNaming] = upgrade.split(
    /^# name the new image.*\n/m,
  );
  if (afterNaming === undefined)
    throw new Error(
      "the upgrade block no longer says where the new image is named",
    );
  return { beforeNaming: beforeNaming ?? "", afterNaming, rollback };
};

const projectLabel = `label=com.docker.compose.project=${project}`;

const cleanUp = async () => {
  const down = await compose([
    "down",
    "--volumes",
    "--remove-orphans",
    "--timeout",
    "10",
  ]);
  if (down.exitCode !== 0)
    console.warn(`docker compose down exited ${down.exitCode}: ${down.stderr}`);
  // When an `up` is refused for one service's mount, the engine can still be
  // creating another service's container, which appears seconds later, after
  // `down`: whatever of the project appears goes by its label, until none has
  // for three looks in a row.
  for (let quiet = 0, look = 0; quiet < 3 && look < 30; look++) {
    const left = (
      await spawned([
        "docker",
        "ps",
        "--all",
        "--quiet",
        "--filter",
        projectLabel,
      ])
    ).stdout
      .split("\n")
      .filter((id) => id !== "");
    if (left.length > 0) {
      quiet = 0;
      await spawned(["docker", "rm", "--force", ...left]);
    } else {
      quiet++;
    }
    await Bun.sleep(2_000);
  }
  for (const kind of ["network", "volume"]) {
    const ids = (
      await spawned(["docker", kind, "ls", "--quiet", "--filter", projectLabel])
    ).stdout
      .split("\n")
      .filter((id) => id !== "");
    if (ids.length > 0) await spawned(["docker", kind, "rm", ...ids]);
  }
  await spawned(["docker", "image", "rm", "--force", firstImage, newerImage]);
  rmSync(hubDirectory, { recursive: true, force: true });
};

const interrupted = () => {
  void cleanUp().finally(() => process.exit(130));
};

describe("the deployment", () => {
  beforeAll(async () => {
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    const revision = must(
      "git rev-parse",
      await spawned(["git", "rev-parse", "HEAD"]),
    ).trim();
    must(
      "docker build",
      await spawned(
        [
          "docker",
          "build",
          "--build-arg",
          `COTA_REVISION=${revision}`,
          "--tag",
          firstImage,
          ".",
        ],
        { limitMs: 900_000 },
      ),
    );
    must(
      "docker tag",
      await spawned(["docker", "tag", firstImage, newerImage]),
    );
    makeHubDirectory();
  }, 900_000);

  afterAll(async () => {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    await cleanUp();
    expect(
      must(
        "docker ps",
        await spawned([
          "docker",
          "ps",
          "--all",
          "--quiet",
          "--filter",
          projectLabel,
        ]),
      ).trim(),
    ).toBe("");
    expect(
      must(
        "docker volume ls",
        await spawned([
          "docker",
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `name=${project}`,
        ]),
      ).trim(),
    ).toBe("");
  }, 120_000);

  it("labels the image with its source and the commit it was built from", async () => {
    const labels = JSON.parse(
      must(
        "docker image inspect",
        await spawned([
          "docker",
          "image",
          "inspect",
          "--format",
          "{{json .Config.Labels}}",
          firstImage,
        ]),
      ),
    );
    expect(labels).toMatchObject({
      "org.opencontainers.image.title": "cota-hub",
      "org.opencontainers.image.licenses": "MIT",
      "org.opencontainers.image.source": "https://github.com/limineol/cota",
      "org.opencontainers.image.revision":
        expect.stringMatching(/^[0-9a-f]{40}$/),
    });
  });

  it("Y1: With an empty volume and a hub directory holding only what the install makes, `docker compose up --wait` brings both services healthy, and a request sent through the hub to a fake provider is in the request log.", async () => {
    must("docker compose up", await compose(["up", "--detach", "--wait"]));
    expect(await (await fetch(`${hub}/health`)).json()).toEqual({
      status: "ok",
    });
    const logs = must("docker compose logs", await compose(["logs", "hub"]));
    expect(logs).toContain("cota hub listening");
    expect(logs).toContain("local (openai-chat)");
    const code = logs.match(/give it the setup code (\S+) and choose/)?.[1];
    expect(code).toBeDefined();
    const setUp = await call("/api/setup", {
      method: "POST",
      body: { code, password: ownerPassword },
    });
    expect(setUp.status).toBe(204);
    await sendRequest("Hello from the first image");
    await waitFor(
      "the request's row",
      async () => (await requestsLogged()) === 1,
    );
    const named = await call("/api/display-names/pool/local", {
      method: "PUT",
      body: { name: "Deployed pool" },
    });
    expect(named.status).toBe(200);
  });

  it("Y6: The hub's process runs as the uid `.env` names, and the hub store it creates has mode 0600 and that owner.", async () => {
    const top = must("docker compose top", await compose(["top", "hub"]));
    // Engines and Compose versions differ in the table: the user is under UID
    // (Docker's engines) or USER (OrbStack's), and older versions of Compose
    // print the container's name above it.
    const lines = top
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => line.trim().split(/\s+/));
    const at = lines.findIndex((cells) => cells.includes("PID"));
    const header = lines[at] ?? [];
    const column = header.findIndex(
      (cell) => cell === "UID" || cell === "USER",
    );
    expect(column).toBeGreaterThanOrEqual(0);
    const users = lines.slice(at + 1).map((cells) => cells[column]);
    expect(users.length).toBeGreaterThan(0);
    const name = must("id -un", await spawned(["id", "-un"])).trim();
    for (const user of users) expect([String(uid), name]).toContain(user);
    const store = statSync(join(hubDirectory, "store", "cota.sqlite"));
    expect({ mode: store.mode & 0o777, uid: store.uid }).toEqual({
      mode: 0o600,
      uid,
    });
  });

  it("Y7: A hub started from the image, with no `[dashboard]` in its configuration, answers `/` with the index of the dashboard the image was built with.", async () => {
    const built = must(
      "the image's index.html",
      await compose([
        "exec",
        "-T",
        "hub",
        "cat",
        "/app/apps/web/dist/index.html",
      ]),
    );
    const answer = await fetch(`${hub}/`);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe(built);
  });

  it("Y2: After `docker compose down` and `up` again, without removing the volume, the request log, the hub store and the archive hold what they held before.", async () => {
    const archiveBefore = archived();
    must("docker compose down", await compose(["down"]));
    // The hub stopped on SIGTERM folds its write-ahead log into the store.
    const wal = join(hubDirectory, "store", "cota.sqlite-wal");
    expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
    must("docker compose up", await compose(["up", "--detach", "--wait"]));
    expect(await requestsLogged()).toBe(1);
    expect((await call("/api/me")).status).toBe(200);
    expect(await ownersNames()).toEqual(["local: Deployed pool"]);
    expect(archived()).toEqual(archiveBefore);
  });

  it("Y8: After an upgrade from one image to another and a rollback, the first image runs on the store as it was before the upgrade, and the request log still holds every request either image logged.", async () => {
    const { beforeNaming, afterNaming, rollback } = blocksOfUpgrade();
    must("the upgrade's first steps", await shell(beforeNaming));
    writeFileSync(
      join(hubDirectory, ".env"),
      readFileSync(join(hubDirectory, ".env"), "utf8").replace(
        `COTA_HUB_IMAGE=${firstImage}`,
        `COTA_HUB_IMAGE=${newerImage}`,
      ),
    );
    must("the upgrade's last step", await shell(afterNaming));
    expect(await runningImage()).toBe(newerImage);
    expect(
      must("docker compose logs", await compose(["logs", "hub"])),
    ).toContain("local (openai-chat)");
    await sendRequest("Hello from the newer image");
    await waitFor(
      "the newer image's row",
      async () => (await requestsLogged()) === 2,
    );
    const renamed = await call("/api/display-names/pool/local", {
      method: "PUT",
      body: { name: "Named after the upgrade" },
    });
    expect(renamed.status).toBe(200);

    must("the rollback", await shell(rollback));
    expect(envImage()).toBe(firstImage);
    expect(await runningImage()).toBe(firstImage);
    expect(await ownersNames()).toEqual(["local: Deployed pool"]);
    expect(await requestsLogged()).toBe(2);
  });

  it("Y3: With ClickHouse's password file empty or missing, neither ClickHouse nor the hub starts.", async () => {
    const refused = await compose([
      "exec",
      "-T",
      "clickhouse",
      "clickhouse-client",
      "--user",
      "cota",
      "--query",
      "SELECT 1",
    ]);
    expect(refused.exitCode).not.toBe(0);
    must("docker compose down", await compose(["down"]));
    const password = join(hubDirectory, "secrets", "clickhouse");
    writeFileSync(password, "", { mode: 0o600 });
    const empty = await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "60"],
      120_000,
    );
    expect(empty.exitCode).not.toBe(0);
    expect(
      must("docker compose logs", await compose(["logs", "clickhouse"])),
    ).toContain(guardsLine);
    expect(await runningServices()).not.toContain("hub");
    must("docker compose down", await compose(["down"]));
    rmSync(password);
    const missing = await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "60"],
      120_000,
    );
    expect(missing.exitCode).not.toBe(0);
    // Compose refuses a missing file, naming it; a file just removed under
    // macOS's /var/folders can still be seen by the engine, without contents,
    // and then the guard refuses it.
    const refusedBy = `${missing.stderr}${missing.stdout}`.includes(
      "secrets/clickhouse",
    )
      ? "compose"
      : must("docker compose logs", await compose(["logs", "clickhouse"]))
            .split("\n")
            .some((line) => line.includes(guardsLine))
        ? "the guard"
        : `nothing: ${missing.stderr}`;
    expect(["compose", "the guard"]).toContain(refusedBy);
    const running = await runningServices();
    expect(running).not.toContain("clickhouse");
    expect(running).not.toContain("hub");
  });
});
