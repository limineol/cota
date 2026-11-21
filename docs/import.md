---
status: active
scope: repository
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-18
supersedes: []
code:
  - apps/hub/src/import.ts
  - deploy/compose.yaml
---

# Importing the prototype's log

How an owner brings the prototype's history (Bifrost's request log, its conversation tables, and its dashboard's titles and names) into a running hub with `bun run import`. What the import reads, builds and checks is the import spec's (`docs/specs/import/spec.md`), and why is ADR-0025's. This page is the steps.

The import only reads its source, with `SELECT`, and only adds to the hub: rows the request log does not hold, and display names the owner has not given. Running it again adds nothing; an interrupted run is picked up by running it again.

## Before

- **The hub is deployed** (`docs/install.md`), with every pool the prototype's requests billed in its configuration. The hub may keep running while the import runs; nothing else may import or restore into its request log at the same time.
- **A user of the source's ClickHouse that can only select**, from the `bifrost` and `hub` databases. The prototype's has one. To make one, as the source's administrator:

  ```sql
  CREATE USER cota_import IDENTIFIED WITH sha256_password BY '<a new password>' SETTINGS readonly = 2;
  GRANT SELECT ON bifrost.* TO cota_import;
  GRANT SELECT ON hub.* TO cota_import;
  ```

  A settings profile that caps a user's answers, as the prototype's does, needs no change: the import lifts the caps on an answer's size and makes every other limit an error, so an answer is never cut short unsaid (the import spec, What is read).

- **The source's ClickHouse reachable from where the import runs.** From the hub image, that is from the hub's container, not the host's loopback. On OrbStack and Docker Desktop, a port the source publishes on the host's loopback (`127.0.0.1:<port>`) is reached from the hub's container as `host.docker.internal:<port>`; on Docker Engine on Linux it is not, and how the container reaches the source is the owner's network.
- **Copies of the dashboard's files**, if titles and names should come over: its titles database (SQLite) and its settings file (`settings.json`), copied out of the prototype dashboard's data volume into the import folder (step 1), one file at a time, from the prototype's Compose directory:

  ```sh
  docker compose cp <the dashboard's service>:<the titles database's path> <the hub directory>/import/titles.sqlite
  docker compose cp <the dashboard's service>:<the settings file's path> <the hub directory>/import/settings.json
  ```

  Only those two files, never the volume or its folder: the login files beside them are the prototype's Claude and ChatGPT logins.

## 1. Write the import file

In a folder of its own inside the hub directory, `import/`, which the commands below mount from there, with the source user's password in a file next to it (`import/source-password`, readable only by the owner):

```toml
[source.clickhouse]
url = "http://<the source's ClickHouse, as the hub's container reaches it, such as host.docker.internal>:8123"
user = "cota_import"
password = { file = "/etc/cota/import/source-password" }

[source.files]
titles = "titles.sqlite"    # optional, read against this file's folder
names = "settings.json"     # optional

# Every pool of the source (its account tag, or its provider), to a pool of the hub's configuration.
[pools]
work-plan = "work"
zai = "zai"

# Optional: a machine the source tagged by another name than the one it joined the hub as.
[machines]
old-name = "studio"
```

The pool map must name every pool of the source; the dry run lists them. A request's pool is its account tag, else its provider, so a provider is named whenever any of its requests has no account, even when most of its requests carry one.

## 2. Dry run

From the hub directory:

```sh
docker compose run --rm -v ./import:/etc/cota/import:ro hub \
  bun run import /etc/cota/import/import.toml --dry-run
```

It reads everything, builds every row, and adds and verifies each day into temporary tables of its own, so its counts are what the real run will add; it writes nothing to the request log or the hub store. Read its report:

- **Exit code 1 with `The pool map does not name: …`**: add those pools to `[pools]` and run it again.
- **One line per day**: what it would add, its cost by the hub's price lists beside what the source recorded, and what it would not carry and why.
- **The source's pools, machines, user agents, statuses and object types**, with their counts: check them against what you know of the prototype.
- **`requests not of their pool's provider`**: the requests that bill a pool (by their account tag) though their provider is not the one most of that pool's requests have. They are imported under that pool, as the prototype counted them; check that it is the pool they billed.
- **Each day's time** to read, build and load, and their sum: about how long the real run takes.

`--from <YYYY-MM-DD>` and `--to <YYYY-MM-DD>` limit it to some days. A dry run keeps everything it loads, in temporary tables of the request log's ClickHouse, until it ends, so that each day's counts include what the days before it would add: a dry run of a whole large source needs about as much free disk in that ClickHouse as the import will add. Where that is short, dry-run a range at a time with `--from` and `--to`, and import each range before dry-running the next: a dry run adds nothing to the log, so a later range whose requests carry items first seen in an earlier one fails at its first such day (`… carry items the log does not hold; import from <day>`) until that earlier range is imported.

## 3. Import

The same command without `--dry-run`. It goes day by day, oldest first, and prints each day as it is added. The prototype may still be running for the days that have ended; import its last day once it has stopped, since its items lag its requests by a few minutes.

- **`added`** or **`already held`** for every day, and exit code 0: done.
- **`failed`** stops the run at that day. The days before it are whole, and the rows that day added stay; running the import again (with `--from` that day, to skip reading the days before) adds the rest. `the source changed while it was read` means the prototype was still writing that day.
- **Exit code 2** means it could not start, and says why: a file, a column of the source, the hub store not at this hub's steps (start the hub once), or a server it could not reach.

The display names are set once every day is added, only where you have not named that pool, model, machine, client or project yourself.

## After

- The archiver archives the imported days at its next run, as any other day ([`operating.md`](operating.md#the-archive)).
- Imported requests show in the dashboard and the API with their conversations in the form the prototype logged them (`bifrost-responses`, `bifrost-chat`), not the body the client sent. What the prototype never recorded is said once, in the report's last lines.
- The prototype's data stays as it was, for the way back, until you remove it.
