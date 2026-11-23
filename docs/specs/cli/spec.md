---
status: active
scope: apps/cli
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/cli
  - apps/hub/src/shared/05-tests/harness.ts
  - tooling/boundaries.ts
  - tooling/mutants.table.ts
---

# The CLI

`cota`, the one command a machine runs: joining a hub, launching Claude Code, Codex, OpenCode and Pi through it, keeping the machine's logins, configuring the clients that read a configuration file, and doctor. ADR-0022 gives the reasons, and where each file lives; which pool a project bills is `docs/specs/routes/spec.md`; reporting session titles is `docs/specs/title-reporter/spec.md`.

**Status.** Active. Milestone 4b built everything here but the title reporter's parts, which milestone 4c built (`docs/specs/title-reporter/spec.md`): step 7 of Joining, the schedule's removal in Leaving, `cota titles` and doctor's `titles` check; and milestone 6d the request reporter's (`docs/specs/request-reporter/spec.md`): its keys, `cota requests`, the step of Joining after the title reporter's, the first removal in Leaving and doctor's `requests` check. The parts only Windows runs (the `.cmd` shims, the user's `Path` through PowerShell, doctor's `path` check there, Pi's key command there) are built behind their ports, and their pure parts are tested, but none was run on Windows: ADR-0022, Facts to confirm, lists what must be tried there, and this spec changes with what is found. So do the client facts it relies on that were not seen on a real client.

## Commands

| Command | Does | Exits |
| --- | --- | --- |
| `cota join <hub> [--machine <name>] [--no-shims] [--allow-plain-http]` | Joins the machine (Joining) | 0, or 1 with nothing written |
| `cota leave` | Undoes a join (Leaving) | 0, 1 |
| `cota [--pool <pool>] <client> [args…]`, and the shims | Launches a client (Launching). `<client>` is `claude`, `codex`, `opencode` or `pi` | the client's status; 1 when the launch stops; 127 when the client is not installed; 126 when it is found but cannot be started |
| `cota route [<client>] [--pool <pool>]` | Says which pool a launch here would bill, and why, without launching | 0, 1 |
| `cota routes show <client>`, `cota routes set <client>` | Prints a client's routes, or replaces them from standard input, signed in as the owner (Routes from the CLI) | 0, 1 |
| `cota login <pool>`, `cota logout <pool>` | Keeps or removes a machine login (Machine logins) | 0, 1 |
| `cota configure` | Rewrites `cota`'s part of Codex's, OpenCode's and Pi's configuration (Configuring) | 0, 1 |
| `cota shims [--remove]` | Installs the shims and puts their directory first on `PATH`, or removes both (Shims) | 0, 1 |
| `cota titles report`, `cota titles schedule [--remove]` | Reports titles once, or schedules it every 30 seconds (`docs/specs/title-reporter/spec.md`) | 0, 1 |
| `cota requests add <client> <folder> <pool>`, `cota requests remove <client> <folder>`, `cota requests show [--json]`, `cota requests report`, `cota requests schedule [--remove]` | Keeps or forgets a reported client's data folder, says how far each was reported, reports their model calls once, or schedules that every 30 seconds (`docs/specs/request-reporter/spec.md`) | 0, 1 |
| `cota doctor [--json]` | Runs every check (Doctor) | 0, or 1 when a check failed |
| `cota hub-key keyed` | Prints the keyed hub key, for Pi's configuration to run | 0, or 1 without one |
| `cota memory key`, `cota memory get <path> [<name>=<value>…]`, `cota memory sql`, `cota memory transcript <session>` or `--request <id>`, with `[--from <n>] [--entries <n>] [--cut <n>]` | Keeps the machine's reader key, or reads the request log with it, for the memory skill (`docs/specs/memory-skill/spec.md`, `cota memory`) | 0, 1 |
| `cota --version` | Prints its version | 0 |
| `cota --help`, `cota help` | Prints how to use it, on standard output | 0 |

A command used wrongly prints what is wrong and how to use it, on stderr, and exits 2. Every line `cota` prints about itself to a launched client's terminal starts `cota: `, on stderr. The command line is read by `cota`'s own parser (`01-presentation/command-line.ts`): a launch's arguments after the client's command are the client's, passed on untouched, which Effect's CLI package, which reads options anywhere and splits `-abc`, could not promise.

## The machine's configuration

`config.toml`, in the configuration's directory (ADR-0022), decoded once with a Schema; a file that does not decode is doctor's `config` check, and every command but `join`, `leave`, `doctor`, the bypass, a launch on a machine that has not joined, `--version` and `--help` stops with its problems. A key the table below does not name is a problem, with its place (`at ["machin"]`), not a key ignored: a key misspelled would otherwise change nothing and say nothing. A join writes the file in one fixed form, whatever form the owner wrote it in: the keys in the table's order, `[launch]` and then each `[clients.<client>]` that has a setting, and a wait as a whole number of seconds (`"7 seconds"`), else of milliseconds; so joining again rewrites an owner's `wait = "7000 millis"` as `wait = "7 seconds"`, and drops the comments and blank lines the owner added.

| Key | Holds | Default |
| --- | --- | --- |
| `hub` | The hub's address, `http` or `https`, without a path | required |
| `machine` | The machine's name, the `x-cota-machine` tag: 1 to 200 code points | required |
| `allow_plain_http` | Whether an `http` address that is not loopback is allowed | `false` |
| `shims` | `false` when the machine joined with `--no-shims`, so that doctor skips `shims` and `path`; `cota shims` removes it | absent: the machine has shims |
| `launch.wait` | How long a launch waits for the hub | `"5 seconds"` |
| `launch.wait_routed` | How long, when the last answer kept for the launch named a pool other than the client's own | `"40 seconds"` |
| `clients.<client>.own_pool` | The pool a routed client's own login spends on this machine (`claude-code`, `codex`) | the client's default pool, as the hub answers it |
| `clients.<client>.reported` | The data folders of a reported client (`antigravity`) this machine reports, each `{ folder, pool }`, as `[[clients.antigravity.reported]]` tables (`docs/specs/request-reporter/spec.md`, The configuration); a reported client has no other key, and a launched one never this | none |

Hub keys are `hub-keys/subscription` and `hub-keys/keyed`, and `hub-keys/reader` when the owner gave the machine its reader key with `cota memory key` (a join neither writes nor removes it), and machine logins `logins/<pool>`, beside it: one secret a file, trimmed when read, and a file that holds nothing else is none.

Where the files are is a function of the system and its environment alone (ADR-0022's table, J15). On macOS and Linux an `XDG_*` variable is used when it is set to an absolute path, as the XDG specification says, else its default under `HOME`, which must be absolute too; on Windows the configuration is under `APPDATA`, the state and shims under `LOCALAPPDATA`. A directory that no variable gives stops every command that needs it, naming the variable.

The environment `cota` reads: `COTA=off` (the bypass), `COTA_POOL` (an override), `COTA_PROJECT` (the project, when something already named it), `COTA_OWNER_PASSWORD` (for `cota routes set`), and the systems' own (`PATH`, `PATHEXT`, `SHELL`, `HOME`, `XDG_*`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `COMPUTERNAME`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`).

## Joining

1. The hub's address is checked: `http` or `https`, no user information, path, query or fragment (J16). An `http` address whose host is not loopback (`localhost`, `127.0.0.0/8`, `::1`) needs `--allow-plain-http`. The address kept is the URL's origin: `HTTP://Cota.Internal:80/` is kept as `http://cota.internal`. The machine's name is `--machine`, else the host name's first label lowercased (`COMPUTERNAME` on Windows), and is 1 to 200 characters.
2. Hub keys are read, one a line, spaces trimmed: from standard input when it is not a terminal, its lines that are not empty, else from a prompt that does not echo, until an empty line. Never from an argument. None stops the join.
3. Each key is shown to the hub: `GET /api/machine` with it, waiting 5 seconds for each answer. The join stops, having written nothing, when the hub cannot be reached, a key is one the hub does not know (401) or one it could not say anything about, a key is a reader key, or two keys are of one scope; it says every such key, by its place in the order given, never by its value (J17). A machine keeps at most two keys, one of each scope, so a third key always stops the join.
4. The configuration and the keys are written, each atomically and only when it differs from what is there, the directories 0700 and the files 0600; a key of the scope no key was given for is removed. A machine joined before keeps its `launch` and `clients` settings.
5. Unless `--no-shims`: Shims, below. With it, step 4 writes `shims = false`.
6. Configuring, below, for each of Codex, OpenCode and Pi that is installed: its command is on `PATH` beyond the shims, or its configuration file's directory exists. Its lines go to standard output, and a file left as it was is said on stderr; the join goes on either way, and doctor's `configured` check fails.
7. The title reporter is scheduled (`cota titles schedule`), and runs once (`cota titles report`), so that doctor sees a run. Where the system has no scheduler `cota` can use, it says so and goes on. Then, when the configuration keeps a reported folder (a machine joined before keeps its `clients`), the request reporter is scheduled (`cota requests schedule`) and runs once (`cota requests report`), the same way.
8. Doctor runs, and its report ends the join's output. The join exits 0 whatever doctor found: doctor's own exit says that.

Joining again with the same address, keys and name writes nothing new, and says so. Steps 5 to 7 are `MachineSteps.join` (`02-application/interfaces/machine-steps.ts`, built in `cli.ts`'s `machineSteps`).

## Leaving

`cota leave` removes, in this order, each that exists: the request reporter's schedule; the title reporter's schedule; `cota`'s part of each client's configuration (the rewrite with no pools); the shims and the `PATH` line (`cota shims --remove`, below); the state's directory; the configuration's directory, with the keys and machine logins in it. A step that fails is said and the others still run; it exits 1 when one failed. The three after the schedules are `MachineSteps.leave`; a schedule's removal says nothing when there was none. The rewrite with no pools takes each client's file that exists, installed or not, and a file it leaves as it was fails its step. A machine that has not joined has nothing to remove, which `leave` says, exiting 0.

## The project

1. `COTA_PROJECT`, trimmed, when it is set and not empty.
2. Else the `origin` remote of the git repository holding the working directory (`git remote get-url origin`, the `git` found on `PATH` as a client is; without `git`, the repository's own configuration file is read: `.git/config` in the working directory or the nearest directory above it, or for a worktree, whose `.git` is a file naming its `gitdir`, the configuration of the repository it belongs to). A remote's project is its path after the host, with any leading `/` and `~` removed, without a trailing `/` and then a trailing `.git`, lowercased. The forms read are `<scheme>://[<user information>@]<host>[:<port>]/<path>` for `https`, `http`, `ssh` and `git`, and the short form `[<user>@]<host>:<path>`. A remote that is a local path, a `file://` address, or one that gives an empty path gives none.
3. Else the working directory's name, as it is.

The project is cut to 200 code points. `cota` sets `COTA_PROJECT` to it for the client.

## Launching

For `cota <client> [args…]`, or the shim of `<client>`:

1. **The bypass.** With `COTA=off`, or on a machine that has not joined, the real client (step 2) is started with the environment and arguments given, `PATH` included.
2. **The real client** is the first file named for the client on `PATH`, with `PATH` lacking the shims' directory and its empty entries, that this user may run and that is not a shim of `cota`'s (its marker line, in its first 512 bytes). On Windows the names tried are the client's with each of `PATHEXT`'s extensions, `.exe` before `.cmd` in one directory. None: exit 127 with `cota: <command> is not installed: no <command> on PATH beyond cota's shims.` One found that the system will not start: exit 126 with `cota: <path> could not be started: <reason>`. Whatever else is found is taken for the client, another tool's wrapper of it included (another gateway's script that sets the provider's address and runs the client): doctor's `clients` check names each file found, and warns of a script.
3. **The project**, above.
4. **The pool** (Claude Code and Codex). The question is `GET /api/route?client=<claude-code|codex>&project=<project>`, with `&pool=<override>` when `COTA_POOL` or `--pool` names one (`--pool` wins), sent with the subscription hub key, else the keyed one. It is sent once a second until it is answered or the deadline passes: `launch.wait`, or `launch.wait_routed` when the answer kept for this client and project names a pool other than the client's own (step 6, with the kept answer's default pool). An answer, success or problem, is not retried; only a hub that cannot be reached is asked again. The clock is Effect's `Clock`. A success is kept in `routes.json` (`{ "answers": [{ client, project, pool: { id, kind, protocol, provider }, defaultPool }] }`, oldest first), the latest 1,000 by client and project, written atomically in the state's directory, 0600, and only when the answer is not already the latest kept; a file that cannot be written is said in one line and the launch goes on. A file that does not read is as if it kept nothing, and doctor's `kept-routes` warns of it.
5. **Its answer.**
   - A success: on to step 6 with its pool.
   - `no-route`: stop, with `cota: no route of <client> matches <project>, and it has no default pool. Add one in Settings → Routes.`
   - `route-pool-gone`, `no-such-pool`, `pool-not-for-client`: stop, with the problem's detail and `Change the route in Settings → Routes.` (or, for an override, `Name another pool.`).
   - `hub-store-unavailable` and any 5xx, or any other answer that does not decode: the hub is up but cannot say; with a kept answer, on to step 6 with its pool, through the hub; without one, stop, with `cota: <hub> could not say which pool <project> bills, and no answer is kept for it; <command> did not start.`
   - 401, a hub key the hub does not know: stop, with `cota: <hub> does not know this machine's hub key; <command> did not start. Join again: cota join <hub>.` A machine that keeps no hub key asks nothing, and stops with `cota: this machine keeps no hub key; <command> did not start. Join again: cota join <hub>.`
   - No answer by the deadline: Going direct, below.
6. **The login.** The client's **own pool** is `clients.<client>.own_pool`, else the answer's `defaultPool` (none when the client has no default pool, so that every subscription pool is another).
   - A subscription pool that is the own pool: the client's own login.
   - Another subscription pool: for Claude Code, the machine login `logins/<pool>`; without it, stop, with `cota: <project> bills <pool>, and this machine has no login for it. Sign in to <pool>'s subscription with claude setup-token, then run cota login <pool>.` For Codex, stop, with `cota: <project> bills <pool>, and Codex on this machine spends <own pool>; cota cannot give Codex another ChatGPT login.` (`its own login's pool` in place of `<own pool>` when there is none).
   - A keyed pool: the keyed hub key; without it, stop, with `cota: <project> bills <pool>, whose key the hub holds, and this machine has no keyed hub key. Join again with one: cota join <hub>.`
7. **The environment and arguments**, by client (below), with `PATH` lacking the shims' directory and `COTA_PROJECT` set.
8. **The start.** On macOS and Linux `cota` replaces itself with the client where Bun can (`execve`, Node's `process.execve`, which a compiled Bun program has: ADR-0022, Facts to confirm), so the client keeps `cota`'s process, its signals and its exit status. Otherwise, and on Windows, it starts the client as its child with its standard streams, ignores the interrupts a terminal sends to both (`SIGINT`, `SIGQUIT`), passes `SIGTERM` and `SIGHUP` on, and exits with the client's status, or 128 and the number of the signal that ended it.

Steps 1 to 7 are one decision with no IO (`03-domain/launch.ts`, `decide`): from the client, the environment and arguments given, the real client found, and, on a machine that has joined, its configuration, project, hub keys, machine logins, the override, the hub's answer or its absence by the deadline, and the kept answer, it gives exactly one of: start this command with these arguments and this environment (and one line to say first, going direct), or stop with this line and this exit status. Every line it gives is printed on stderr as the spec quotes it.

**Claude Code.**

| | Subscription pool | Keyed pool |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `{hub}/pools/<pool>` | the same |
| `ANTHROPIC_CUSTOM_HEADERS` | the owner's lines that are not `x-cota-*`, then `x-cota-key: <subscription key>`, `x-cota-project`, `x-cota-machine`, `x-cota-client: claude-code`, one `Name: value` a line | the same without `x-cota-key` |
| `CLAUDE_CODE_OAUTH_TOKEN` | the machine login; removed for the own pool | removed |
| `ANTHROPIC_API_KEY` | removed | the keyed hub key when the pool's provider is `anthropic`; else set empty |
| `ANTHROPIC_AUTH_TOKEN` | removed | the keyed hub key when the pool's provider is not `anthropic`; else removed |
| `CLAUDE_CODE_GATEWAY_HINT_HEADERS` | `1` | `1` |

A tag's value is the project or machine with every line break and control character replaced by a space, since a header is one line.

**Codex.** `-c` and `model_provider="cota-<pool>"` before the arguments given. When `config.toml` (`$CODEX_HOME`, else `~/.codex`) has no table `model_providers.cota-<pool>` under `cota`'s marker comment, Configuring runs for Codex alone first (`CodexProviders.provide`), and says what it did in Configuring's lines, on stderr; the launch goes on either way.

**OpenCode and Pi.** No step 4, 5 or 6: `COTA_PROJECT` and `PATH` are set, and the arguments are passed as given. They wait for nothing.

## Going direct

When the hub gives no answer by the deadline, the launch goes on the answer kept for its client and project:

| Kept answer | The launch |
| --- | --- |
| none | goes direct with the client's own login: `cota: <hub> cannot be reached, and <command> has not been launched in <project> on this machine before; it goes direct with its own login, unlogged.` |
| a subscription pool that is the own pool | goes direct with the own login |
| another subscription pool, its machine login kept (Claude Code) | goes direct with the machine login |
| another subscription pool, without its login, or any for Codex | stops, as step 6 says |
| a keyed pool | stops: `cota: <hub> cannot be reached, and <project> bills <pool>, whose key only the hub holds; <command> did not start.` |

Going direct, Claude Code is given only its login's variables, as step 6 says, and Codex no `-c`; neither gets the hub's address, the tags or a hub key. An `ANTHROPIC_BASE_URL` given that is the hub's (`{hub}/pools/…`, from a launch this one runs inside) is removed, and so are the `x-cota-*` lines of `ANTHROPIC_CUSTOM_HEADERS`, the owner's other lines kept. `PATH` lacks the shims and `COTA_PROJECT` is set, as through the hub. The line, when there is one but the first row's, is `cota: <hub> cannot be reached; <command> goes direct with <pool>'s login, unlogged and with no fallback.`

## Routes from the CLI

`cota route [<client>] [--pool <pool>]` asks the question of step 4 for the working directory (the client defaults to `claude`; `--pool`, else `COTA_POOL`, is the override), with the same deadline, and prints the answer; it launches nothing and keeps nothing:

```text
project  acme/api
pool     claude, a subscription pool of anthropic-messages
by       route 1 of claude-code, acme/*
```

`by` is `route <position> of <client>, <pattern>`, `the default pool of <client>`, or `the override`. A refusal prints the line a launch would, and exits 1; so do `cota: <hub> cannot be reached.`, `cota: <hub> could not say which pool <project> bills.`, and the lines of a hub key the hub does not know or a machine without one. `cota routes show <client>` and `cota routes set <client>` (`<client>` is `claude` or `codex`) sign in as the owner (`POST /api/sign-in`, `User-Agent: cota routes`) with the password from `COTA_OWNER_PASSWORD`, else from a prompt that does not echo when standard input is a terminal, and sign out (`POST /api/sign-out`) before they end, whether they stored, were refused or failed; a sign-out that fails is said in one line, and the sign-in lasts until it expires or is revoked in Settings. The password is never an argument and never printed. Without it, and with standard input not a terminal, they stop: `cota: COTA_OWNER_PASSWORD is not set, and standard input is not a terminal to ask for the owner password on`. A refused sign-in stops with its reason in one line (`the owner password is wrong`; a hub whose password is turned off, to use Settings → Routes; a hub not set up; too many attempts, with the seconds to wait).

`show` prints the client's routes one a line, `<pattern> <pool>`, then `* <pool>` for the default pool, on standard output. `set` reads the same form from standard input (so `set` after an interactive sign-in reads what is typed after the password, until the end of input): each line that is not empty is split at its last run of spaces, since a pattern may hold spaces and a pool's id cannot, `*` as the pattern names the default pool, and a line without both, or a second default, stops it before anything is sent (`cota: the routes given do not read: line 1 is not a pattern and a pool: "acme/*"; give them as cota routes show prints them`). It reads the list's revision (`GET /api/routes`) and replaces the list from it (`PUT /api/routes/{client}`), so a change made between is refused `routes-changed`: `cota: the routes of <client> changed after cota read them, and were not stored; read them again with cota routes show <command>`. Stored, it says `cota: stored the routes of <client>, revision <n>.` on stderr and prints the list stored as `show` does. Refused `routes-refused`, it prints `cota: the routes of <client> were not stored:` and a line a refusal, in the hub's order, naming the route as given: `cota: route 1, acme/* codex: the pool does not speak anthropic-messages`, `cota: route 2, acme/* claude: an earlier route has the same pattern`, `… route 1 matches every project it matches`, `… the hub has no such pool`, `… it is not a project pattern: …`, and `cota: the default pool, <pool>: …`. Each exits 1 when it stops.

## Shims

1. A shim per client is written in the shims' directory (0755), each only when it differs: on macOS and Linux a POSIX shell script, mode 0755,

   ```sh
   #!/bin/sh
   # cota: this shim launches its client through cota; cota shims rewrites it.
   exec '<cota>' claude "$@"
   ```

   on Windows `<client>.cmd`, `@rem cota: this shim launches its client through cota; cota shims rewrites it.` and `@"<cota.exe>" <client> %*`. `<cota>` is the path of the `cota` that wrote it, in single quotes as the shell reads them. The marker is the words `cota: this shim launches its client through cota`.
2. The directory is put first on `PATH`:
   - zsh: the line `export PATH="<shims>:$PATH" # cota: keep last` at the end of `~/.zshrc`; bash: the same in `~/.bashrc`, and in the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists, which is the one a login bash reads, when it does not read `~/.bashrc` (it names `.bashrc`); other POSIX shells: `~/.profile`. A line of `cota`'s (one ending `# cota: keep last`) that is not last is removed and written again last; nothing else in the file changes, and a file already so is not written. A file written keeps its mode; a new one is 0644. The shell is `$SHELL`'s.
   - fish: `$XDG_CONFIG_HOME/fish/conf.d/cota.fish` (default `~/.config/fish/conf.d/cota.fish`), a file of `cota`'s, which runs `fish_add_path --prepend --move --path '<shims>'` (`--move`, so that a directory already on `PATH` is moved first).
   - Windows: the user's `Path` variable, with the directory first, read with `[Environment]::GetEnvironmentVariable('Path', 'User')` and written with `[Environment]::SetEnvironmentVariable('Path', …, 'User')` through `powershell.exe -NoProfile -NonInteractive`, the value passed in an environment variable and never in the command's text, behind the port `UserPath` (`02-application/interfaces/user-path.ts`, `04-infrastructure/powershell-user-path.ts`). The new value is a function of the old (`03-domain/user-path.ts`, J18): the directory first, every other entry as it was and in order, the directory's other entries removed, entries compared without case and without a trailing separator; a `Path` already so is not written. `cota shims --remove` takes the directory out the same way.
3. On a machine that joined with `--no-shims`, `cota shims` also removes `shims = false` from `config.toml`, and says so.
4. `cota shims --remove` removes the shims of `cota`'s (those with the marker), the shims' directory when it is then empty, `cota`'s line from each of `~/.zshrc`, `~/.bashrc`, `~/.bash_profile`, `~/.bash_login` and `~/.profile` whatever the shell, fish's file, and the `Path` entry on Windows, and nothing else.

Each says, one line each, what it wrote or removed, or that all was in place already.

## Configuring

`cota configure` rewrites, for each of Codex, OpenCode and Pi that is installed (Joining, step 6), `cota`'s part of its configuration file, from the pools the hub answers to the machine's keys (`GET /api/machine`). Codex gets the subscription pools of `chatgpt-codex` the subscription hub key opens; OpenCode and Pi the keyed pools of `openai-chat` the keyed hub key opens, and none on a machine without one. It says, one line a client, what it did: `cota: wrote <file>, with cota's providers cota-a and cota-b.`, `cota: removed cota's providers from <file>.`, `cota: <file> has cota's provider cota-a already; nothing changed.`, `cota: <file> needs no provider of cota's; nothing changed.`, or, on stderr, `cota: left <file> as it was: <why>.`; and `cota: none of codex, opencode and pi is installed; there was nothing to configure.` when none is. It exits 1 when it left a file as it was, else 0. When the hub cannot say which pools a key opens (it cannot be reached in 5 seconds, does not know the key, or fails), the files of that key's clients are left as they were, since a rewrite from no pools would remove what `cota` wrote, and the line says why.

**A rewrite**:

1. reads the file (a file that does not exist is empty, and its directory is made when the file is written: 0700 for Codex's, 0755 for the others);
2. parses it as JSON (OpenCode, Pi) or TOML (Codex); a file that does not parse is left as it is, and the rewrite of that client stops with the parser's message (`it does not read as TOML: …`; neither Bun's TOML parser nor `JSON.parse` gives a line and column);
3. removes what is `cota`'s and writes what is `cota`'s now, as below;
4. parses the result, and checks that it parses and that what is not `cota`'s is the same value as before; otherwise the file is left as it is and the rewrite stops;
5. writes it atomically, keeping the file's mode (Codex's is set to 0600; a new OpenCode or Pi file is 0644), only when it differs from the file read.

Each rewrite is a function with no IO from the file's text and the pools to the new text or the reason it stops (`03-domain/codex.ts`, `opencode.ts`, `pi.ts`, `json-file.ts`), under J3 to J5.

**What is `cota`'s**, and nothing else:

- **Codex** (`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`): every table `[model_providers.cota-<pool>]` written as a standard table under the comment `# cota: this table is rewritten by cota configure.`, with the lines up to the next table header, but the blank and comment lines just before that header, which are the owner's (a comment above the owner's next table belongs to it), and with the one blank line before the comment. They are removed where they stand and written again at the end of the file, each after one blank line (none at the start of an empty file), in order of pool; a pool whose id is not a bare TOML key is written quoted, `[model_providers."cota-<pool>"]`. Every other line is kept as it was, byte for byte:

  ```toml
  # cota: this table is rewritten by cota configure.
  [model_providers.cota-chatgpt]
  name = "OpenAI"
  base_url = "http://cota.internal:8080/pools/chatgpt/backend-api/codex"
  wire_api = "responses"
  requires_openai_auth = true
  http_headers = { "x-cota-key" = "<subscription hub key>", "x-cota-machine" = "studio", "x-cota-client" = "codex" }
  env_http_headers = { "x-cota-project" = "COTA_PROJECT" }
  ```

  A provider whose id starts `cota-` written in any other form (an inline table, dotted keys, without the comment) is not `cota`'s to move: the rewrite stops and names it.
- **OpenCode** (`$XDG_CONFIG_HOME/opencode/opencode.json` on macOS and Linux when it is set to an absolute path, as OpenCode reads it, else `~/.config/opencode/opencode.json`, under `USERPROFILE` on Windows): every key of `provider` that starts `cota-`, each replaced in place, new ones added at the end, in order of pool; `provider` is removed when nothing but `cota`'s was in it:

  ```json
  "cota-zai": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "Z.ai · Cota",
    "options": {
      "baseURL": "http://cota.internal:8080/pools/zai",
      "apiKey": "{file:/home/me/.config/cota/hub-keys/keyed}",
      "headers": { "x-cota-machine": "studio", "x-cota-client": "opencode", "x-cota-project": "{env:COTA_PROJECT}" }
    },
    "models": { "coder-large": { "name": "Coder Large", "limit": { "context": 200000, "output": 64000 }, "cost": { "input": 1, "output": 4, "cache_read": 0.25, "cache_write": 0 } } }
  }
  ```

  A model's `limit` is written when both limits are known, its `cost` when its price is, and `attachment: true` when it reads images. A file with comments does not parse as JSON, and is left as it is (step 2).
- **Pi** (`$PI_CODING_AGENT_DIR/models.json`, default `~/.pi/agent/models.json`): every key of `providers` that starts `cota-`, the same way, each with `name`, `baseUrl`, `api: "openai-completions"`, `apiKey: "!'<cota>' hub-key keyed"` (`<cota>` the path of the `cota` that wrote it), `headers` (the tags, and `x-cota-project: "$COTA_PROJECT"`, the form Pi reads a variable in), `compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openai" }` and `models` (`id`, `name`, `input`: `["text"]`, with `"image"` when it reads images, `contextWindow` and `maxTokens` where known, `cost` where its price is). On Windows `<cota>` is in double quotes, `!"<cota>" hub-key keyed`, since Pi's command there is not run by a POSIX shell (ADR-0022, Facts to confirm). `providers` is removed when nothing but `cota`'s was in it.

A JSON file is written with two spaces of indent and a final line break; its keys keep their order, but for keys that are whole numbers, which JavaScript puts first (a JSON value compares the same either way); a number is written as JSON writes it (`1.0` as `1`). A file with nothing to change is not written, so a file `cota` has nothing to do with keeps its form.

**A model's cost**, for OpenCode (`input`, `output`, `cache_read`, `cache_write`) and Pi (`input`, `output`, `cacheRead`, `cacheWrite`), is its price's base rates, in dollars per million tokens as numbers: the clients take one cache-write price, which is the price's `cacheWriteShort` (`cacheWriteLong` is not written), and a tiered price is written by its base rates, the tiers over a prompt's size not written, since neither client takes them.

**A pool's models** are the ids its provider lists, asked through the relay as a client asks (`GET {hub}/pools/<pool>/models` with the keyed hub key and `x-cota-client: cota`), each with the facts `GET /api/machine` gives for that id; an id the hub has no facts for gets its id as its name and nothing else. When the listing fails, the pool keeps the models `cota` last wrote for it, and the rewrite says so (`cota: the models of <pool> could not be listed (<why>); its provider keeps the models cota last wrote for it, or is given those the hub has prices for.`); a pool written for the first time then gets the models of its facts.

## Machine logins

`cota login <pool>` reads one login from standard input (its first line that is not empty) or a prompt that does not echo, refuses an empty one, asks the hub (`GET /api/machine`, with each hub key the machine keeps) that `<pool>` is among the pools they open and a subscription pool of `anthropic-messages`, and writes `logins/<pool>`, mode 0600 in a directory 0700, replacing any; it says `cota: kept the machine login for <pool>.` A refusal says why in one line (`<pool> is not a pool this machine's hub keys open`, `<pool> is a keyed pool of anthropic-messages; a machine login is for a subscription pool of anthropic-messages`, the hub not answering) and keeps nothing. `cota logout <pool>` removes it, or says there was none, both exiting 0; a `<pool>` that is not a pool's id (one path segment of letters, digits, `.`, `_`, `~` and `-`) is refused. Neither contacts a provider.

## Doctor

`cota doctor` runs the checks in this order, reading and never writing. Each is **passed**, **failed**, **warned** (it works, but worse than it should) or **skipped** (a check it needs failed, or it does not apply to the system). A failed or warned check prints what is wrong and the command that fixes it, or the file to edit where no command does. Every check after `config` needs it; `hub-keys` needs `hub`; `path` needs `shims` to pass; `own-pools`, `logins` and `configured` need `hub-keys` to pass or warn. Each answer of the hub is waited for 5 seconds.

| Id | Passes when | Fix |
| --- | --- | --- |
| `config` | the configuration reads | `cota join <hub>` |
| `hub` | the hub answers `GET /health` within 5 seconds | check the address and the network; `cota join <hub>` to change it |
| `hub-keys` | the machine keeps a hub key, and each is one the hub knows, of the scope it is kept under; warned without a keyed hub key | `cota join <hub>` |
| `files` | the directories are 0700, the request reporter's scratch directory (`requests` in the state's directory) among them, and `config.toml`, the keys, the machine logins and the state's other files 0600 (skipped on Windows) | the `chmod` that sets it |
| `shims` | each shim exists, has the marker, and calls a `cota` this user may run (a `cota` gone is failed); warned when none is installed; warned when the `cota` they call is inside a Git checkout (a directory above it, below the home directory, holds a `.git`: a home that is itself a repository, as one of dotfiles is, does not count), where a rebuild, a switch of branch or a `git clean` changes or removes what every launch, the title reporter's schedule and Pi's key command run, and `path` is still checked; skipped when `config.toml` says `shims = false` (a join with `--no-shims`) | `cota shims`; for a `cota` in a checkout, `install -m 0755 '<cota>' ~/.local/bin/cota && ~/.local/bin/cota shims`, on Windows a copy to `%LOCALAPPDATA%\Programs\cota\cota.exe` (`docs/install.md`) |
| `path` | `cota`'s `PATH` line is the last line of each file of `$SHELL` (Shims), or fish's file is `cota`'s, and a new login shell (`$SHELL -lic 'command -v <client>'`, `/bin/sh` without `$SHELL`, through the port `LoginShell`) finds each shim first; on Windows, the user's `Path` (read through `UserPath`) starts with the shims' directory | `cota shims` |
| `clients` | each client's real command is found (Launching, step 2), and the check names where each was found; warned, naming each missing; warned when one found is a script (a file, not a link, whose first bytes are `#!`), which another gateway's wrapper is (it sets a provider's base URL or key), and a version manager's shim (asdf's) too, and a client a package manager installed is not (a program, or a link to the package's own script), or when a line of `$SHELL`'s files (Shims) after `cota`'s line changes `PATH`; the warning names where each was found too. A script is the owner's, whatever it is: the warning says in words what to look for (a gateway's is for the owner to take off `PATH` or remove its setup; a version manager's shim is fine), and no fix removes or edits it | `install <client>, then run cota doctor`; for a script, `head -n 20 '<file>' to see which it is, then cota doctor`, which only shows it; for a line, `cota shims, which moves cota's line back to the end` |
| `own-pools` | each `clients.<client>.own_pool` is a subscription pool of the client's protocol among the pools the machine's hub keys open | `edit own_pool in '<config.toml>' to a pool of the client's own login, or remove it` |
| `logins` | each machine login's pool is a subscription pool of `anthropic-messages` among them | `cota logout <pool>` |
| `kept-routes` | `routes.json` is absent or reads; warned when it does not | `rm '<routes.json>'` |
| `configured` | each installed client's file holds what `cota configure` would write now (Configuring, without writing); skipped when none of Codex, OpenCode and Pi is installed | `cota configure`; for a file it cannot rewrite for what is in it, `edit '<file>' as the problem says, then cota configure` |

The title reporter's `titles` check comes after these (`docs/specs/title-reporter/spec.md`), and the request reporter's `requests` check after it (`docs/specs/request-reporter/spec.md`). What `path` does not check: a shell other than `$SHELL`'s, a terminal that starts a shell that is not a login shell, and terminals already open; on Windows, a client on the machine's `Path`, which Windows puts before the user's.

`--json` prints `{ "ok": <no check failed>, "checks": [{ "id", "outcome", "problem", "fix" }] }`, `problem` and `fix` null for a passed or skipped check, and `found` beside them for a passed check that says what it found (`clients`: `claude at <path>, codex at <path>, …`), which the text report prints after its id. Doctor exits 1 when a check failed, and 0 otherwise, warnings included. It never prints a secret.

## Hub endpoints it needs

`PUT /api/session-titles` exists; `GET /api/route` is the routes spec's. One is new, in 4a, and built:

**`GET /api/machine`**: any hub key, or the owner. It answers what the caller is and the pools it opens:

```json
{
  "hubKey": { "name": "fleet", "scope": "keyed" },
  "pools": [{
    "id": "zai", "kind": "keyed", "protocol": "openai-chat", "provider": "zai", "displayName": "Z.ai",
    "models": [{ "id": "glm-5", "name": "GLM-5", "contextTokens": 204800, "outputTokens": 131072, "imageInput": false,
      "price": { "base": { "input": "1.000000000000", "cacheRead": "0.200000000000", "cacheWriteShort": "0.000000000000", "cacheWriteLong": "0.000000000000", "output": "3.200000000000" }, "tiers": [] } }]
  }]
}
```

`hubKey` is null for the owner. `pools` are the pools the caller's scope opens, in order of id (all of them for the owner, none for a reader key), each with its display name or null. `models` is empty for a subscription pool; for a keyed pool it is the models of its price list and its own prices (ADR-0009): each with its name (a display name, else the built-in one, else its id), context and output limits and image input from the price list (null where unknown), and its price in dollars per million tokens, written as the API writes money (`docs/specs/api/spec.md`, Conventions), the pool's own price winning: its base rates of the five classes, a missing cache rate filled in as the request log's cost fills it in, and its tiers over a prompt's size. Errors: none of its own. The endpoint and its fields are `docs/specs/api/spec.md`, Machine; the query and its laws (A7, A8) are the admission spec's, The machine.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| J1 | **A project is read the same from every form of its remote.** For every host, port, user information and path, the `https`, `http`, `ssh`, `git` and short forms of a remote, with or without `.git` and a trailing slash, in any case, give the same project: the path, without `.git`, lowercased. | property |
| J2 | **No credential reaches a project.** A remote's user information never appears in the project read from it. | property |
| J3 | **A rewrite changes nothing that is not `cota`'s.** For every client file and every set of pools, what is not `cota`'s reads as the same value after a rewrite as before, and in Codex's file every line outside `cota`'s tables is unchanged and in order. | property |
| J4 | **A rewrite is idempotent.** Rewriting a file twice with the same pools gives the bytes of rewriting it once, and the second rewrite writes nothing. | property |
| J5 | **`cota`'s part is exactly the pools given.** After a rewrite, `cota`'s part of a file names exactly the pools given, each with its models, and after the rewrite with none, the file holds nothing of `cota`'s. | property |
| J6 | **A launch spends only its pool's login.** A launch to a subscription pool starts its client with the own login only when the pool is the own pool, with a machine login only when it is that login's pool, and otherwise not at all. | property |
| J7 | **A keyed pool is never reached directly.** No launch whose pool is keyed starts its client without the hub's address. | property |
| J8 | **The bypass changes nothing.** With `COTA=off`, or on a machine that has not joined, the client gets exactly the environment and arguments the launch was given. | property |
| J9 | **Secrets stay off command lines and out of output.** No launch, shim, schedule or rewrite puts a hub key or a login in any command's arguments, and no command but `cota hub-key keyed` prints one. | property, contract |
| J10 | **The `PATH` line is once, and last.** After `cota shims`, the shell's file holds `cota`'s line exactly once, as its last line, and every other line as it was, in order. | property |
| J14 | **A failed check names its fix.** Every check that fails or warns says what is wrong and the command that fixes it. | types, property |
| J15 | **The machine's files are where ADR-0022 says.** For every system and every combination of `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `HOME`, `APPDATA` and `LOCALAPPDATA` set, empty or unset, the configuration's, the state's and the shims' directories are those of ADR-0022's table, and a directory no variable gives names the variable that would. | property |
| J16 | **Plain http only where it was allowed.** An address is kept only when it is `http` or `https` with no user information, path, query or fragment, and an `http` one only when its host is loopback or plain http was allowed; what is kept is its scheme, host and port, and a refusal repeats no user information. | property |
| J17 | **A join writes all or nothing.** For every set of keys and every answer of the hub to each, a join writes the configuration and keys only when the hub was reached and every key is known, none is a reader key and no two are of one scope; otherwise the machine's files are as they were. | property |
| J18 | **The user's `Path` has the shims first, once.** After `cota shims` on Windows, the user's `Path` holds the shims' directory exactly once, as its first entry, and every other entry as it was, in order. | property |

J11 to J13 are the title reporter's (`docs/specs/title-reporter/spec.md`), and J19 and on the request reporter's (`docs/specs/request-reporter/spec.md`), each held where its spec says.

J1 and J2 run over generated hosts (names, IPv4 and bracketed IPv6), ports, user information (a user, a user and a token), paths of one to four segments with dots, dashes and upper case, and each form of each, and compare every form's project with the path lowercased (`03-domain/project.laws.test.ts`). J11 to J13, the title reporter's, are `docs/specs/title-reporter/spec.md`'s and keep their ids. J3 to J5 run each client's rewrite over generated files and generated sets of pools, empty among them, 600 cases each (`03-domain/client-files.laws.test.ts`): for Codex, the owner's top-level keys with comments, odd spacing, escapes and Unicode, tables of every kind (the owner's providers, providers named `cotax`, `my-cota-x`, `[profiles.cota-work]`, a header written with spaces, a comment above a table), `cota`'s tables already there anywhere among them, with an old key in them, with and without a final line break, and the forms a rewrite refuses (a `cota-` provider as dotted keys, an inline table or without the marker, a file that does not parse), over pool ids that are bare keys and ids that need quotes; for OpenCode and Pi, roots of the client's own keys and unknown ones (nested values, numbers, Unicode, escapes, `__proto__`, a key that is a whole number), the container absent, empty or holding providers of every name (some starting `cota`, some `cota-` with stale models), first or last, with indents of 0, 2 and 4 and with or without a final line break, the forms refused (not JSON, comments, an array, a container that is not an object), and pools whose models are listed (with prices, without, reading images) or kept from a listing that failed. J3 compares what is not `cota`'s, as a value, before and after, and for Codex the owner's lines in order and every line after them `cota`'s; J4 rewrites the result again; J5 reads `cota`'s part back, each provider whole, and the rewrite with no pools. J18 runs over generated user `Path`s, entries of the owner's (`%VAR%` among them), empty ones, and the shims' directory written in another case or with a trailing separator, anywhere and more than once, and checks the result, that it is already so when rewritten, and that `cota shims --remove`'s rewrite leaves the other entries (`03-domain/user-path.laws.test.ts`). J6 to J8 run the launch's decision, a function of the answer (or none, and the kept answer), the configuration, the logins and keys held, and the environment and arguments given, over generated cases, and compare the environment and arguments it gives with this spec's tables (`03-domain/launch.laws.test.ts`). J9 checks the same decisions (`03-domain/launch.laws.test.ts`), the shims, the schedules' definitions and the rewritten files for every key and login generated, and runs `join`, `doctor`, `doctor --json` and `leave` with generated keys, typed or piped, that the hub answers in every way, finding none of them in any argument, line printed or prompt (`01-presentation/cota.laws.test.ts`); its contract half reads the arguments every stand-in client and scheduler of the contract tests below was given, and everything `cota` printed to them. J10 runs over generated shell files, with `cota`'s line absent, present once, twice and in the middle, and lines appended after it (`03-domain/shims.laws.test.ts`). J14 is the type of a check's outcome (`03-domain/check.ts`), which cannot fail without a problem and a fix, and a property test of doctor over generated machines: each system, with and without its home's variables, the configuration absent, valid, not TOML, of wrong keys or plain `http`, each hub key absent, blank or answered in each way, the hub up, down or failing, and the files' modes right or wrong, and the shims, the shell's file, what a new login shell finds, the clients installed (as programs or as scripts), the own pools, the machine logins, `routes.json`, the title reporter's schedule (as given, otherwise, absent, or no scheduler), its last run and `titles.error` in each state; every failed or warned check naming a fix that runs `cota`, `chmod` or `rm`, or edits a file it names (`02-application/queries/doctor.query.laws.test.ts`). J15 compares `pathsOf` with ADR-0022's table read directly, over every system and each variable unset, empty, relative or absolute in either system's form, with and without a trailing separator (`03-domain/paths.laws.test.ts`). J16 writes addresses from generated parts (schemes, user information with and without a password, loopback and other hosts, IPv6 among them, default and other ports, paths, queries and fragments) and compares what is kept with the parts (`03-domain/hub-address.laws.test.ts`). J17 runs `cota join` over an in-memory file system, empty or joined before, with one to three keys the hub answers in every way, and compares the files after it with those before (`02-application/commands/join-machine.command.laws.test.ts`).

**Contract tests** run `cota` as a machine runs it, against a whole hub from the harness (`apps/hub/src/shared/05-tests/harness.ts`) with routes stored, with a home directory of its own and stand-ins for `claude`, `codex`, `opencode`, `pi` and `git` as the only commands on `PATH`, and one for `launchctl` behind the scheduler's adapter, which records what it is given and runs nothing (`05-tests/machine.ts`). A stand-in client is a script linked to from the machine's `PATH`, as a package manager links a client's own script, and writes what it was given (its arguments, and the names and values of its environment) to a file beside it that the test reads, and exits with the status, or by the signal, its arguments ask for. They cover joining (one, two and three keys, each way a join stops, joining again, without the shims) and leaving; doctor's report and exit status on a healthy machine, for each failing check, for another gateway's wrapper script on `PATH` before the client and a `PATH` line after `cota`'s, for shims that call a `cota` inside a Git checkout and for a home directory that is a repository, and with `--json`, with a real login shell (`/bin/sh -lic`) in the temporary home; `cota hub-key keyed`; each client's launch to each kind of pool, through the hub by a route, the default pool and an override, and going direct in each row of Going direct's table (a hub stopped, the clock advanced rather than waited for); a hub that answers but cannot say; each refusal and each missing login; the bypass and a machine that has not joined; a client's exit status and the signal that ended it; a shim that launches through `cota` without looping, run as its own process, which replaces itself with the client; `cota route`; `cota login` and `logout` (`01-presentation/cota.contract.test.ts`, `01-presentation/launch.contract.test.ts`); joining configuring the installed clients, leaving removing `cota`'s part of each file and nothing of the owner's, and a Codex launch that writes its missing table first; `cota configure` writing each client's file afresh, adding to a file of the owner's own providers and comments without changing them, keeping a file's mode, writing nothing on a second run, and leaving a file that does not parse as it was; doctor's `configured` check failed, fixed and skipped (`01-presentation/configure.contract.test.ts`); the title reporter (`01-presentation/titles.contract.test.ts`, the title reporter's spec); the request reporter (`01-presentation/requests.contract.test.ts`, the request reporter's spec); and `cota routes show` and `set` signed in by the variable and by a prompt, stored, refused route by route, changed between the read and the write, given routes that do not read, a wrong password and none to ask for, each sign-in found signed out afterwards (`01-presentation/routes.contract.test.ts`). The harness's fake provider answers each pool's model listing (`05-tests/machine.ts`, `listing`). They run `cota` in the test's own process, through its ports, with its real files adapter, its real HTTP client and its clients started as children, but for the shim, which runs this checkout's `main.ts`; the harness is `@cota/hub/harness`, an export of the hub only tests import. No test, and no agent, ever runs a real client or contacts a provider. No test runs on Windows: the PowerShell adapter of the user's `Path` and Pi's key command there are untested beyond their pure parts (ADR-0022, Facts to confirm).

## Not built, on purpose

- **A machine login for ChatGPT.** Codex spends only its own login; a route to another ChatGPT pool stops the launch.
- **Routes for OpenCode and Pi.** Their pool is the model the person picks.
- **Giving quota logins.** It needs a client's own login, which `cota` never reads; the connect script stays (ADR-0017).
- **Keeping the clients' configuration current by itself.** `cota configure` is run by the owner; doctor says when a file is behind.
- **Removing or disabling providers that go around the hub**, and rewriting Pi's enabled models (`settings.json`): they are the owner's.
- **Asking models.dev for a model's facts.** They are the hub's price list's; a model it lacks is written with its id alone.
- **Rewriting a file with comments**: OpenCode's JSONC, or a Codex `cota-` provider written by hand in another form. It is left as it is, and said.
- **A keychain.** Secrets are files only the user reads.
- **Updating `cota`.** Left by ADR-0027, under which a release publishes `cota` for the five systems.
