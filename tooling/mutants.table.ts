export type Law =
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "F7"
  | "Q1"
  | "Q3"
  | "Q4"
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "A6"
  | "A7"
  | "A8"
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "C5"
  | "C6"
  | "R1"
  | "R2"
  | "R3"
  | "R4"
  | "R5"
  | "R6"
  | "R7"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "L6"
  | "L7"
  | "L8"
  | "L9"
  | "L10"
  | "L11"
  | "L12"
  | "L13"
  | "L14"
  | "L15"
  | "L16"
  | "L17"
  | "L18"
  | "L19"
  | "S1"
  | "S2"
  | "M1"
  | "M2"
  | "M3"
  | "M4"
  | "I1"
  | "I2"
  | "I3"
  | "I4"
  | "I5"
  | "I6"
  | "I7"
  | "I8"
  | "I9"
  | "I10"
  | "I11"
  | "I12"
  | "I13"
  | "I14"
  | "I15"
  | "I16"
  | "I17"
  | "H1"
  | "H2"
  | "H3"
  | "H4"
  | "H5"
  | "H6"
  | "H7"
  | "H8"
  | "H9"
  | "T1"
  | "T2"
  | "T3"
  | "T4"
  | "T5"
  | "T6"
  | "T7"
  | "T8"
  | "T9"
  | "T10"
  | "T11"
  | "T12"
  | "K1"
  | "K2"
  | "K3"
  | "K4"
  | "K5"
  | "K6"
  | "K7"
  | "K8"
  | "K9"
  | "K10"
  | "K11"
  | "X1"
  | "X2"
  | "X3"
  | "X4"
  | "X5"
  | "X6"
  | "D1"
  | "D2"
  | "D3"
  | "D4"
  | "W1"
  | "W2"
  | "W4"
  | "W5"
  | "W6"
  | "W7"
  | "U1"
  | "U2"
  | "U3"
  | "U4"
  | "U5"
  | "U6"
  | "G1"
  | "G2"
  | "G3"
  | "G4"
  | "G5"
  | "G6"
  | "G7"
  | "G8"
  | "G9"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5"
  | "B6"
  | "B7"
  | "B8"
  | "B9"
  | "B10"
  | "V1"
  | "V2"
  | "V3"
  | "V4"
  | "V5"
  | "V6"
  | "V8"
  | "V9"
  | "V10"
  | "V11"
  | "V12"
  | "V13"
  | "V14"
  | "V15"
  | "V16"
  | "V17"
  | "V18"
  | "V19"
  | "V20"
  | "V21"
  | "V22"
  | "V23"
  | "V24"
  | "V25"
  | "V26"
  | "V27"
  | "V28"
  | "V29"
  | "V30"
  | "V31"
  | "V32"
  | "V33"
  | "V34"
  | "V35"
  | "V36"
  | "V37"
  | "V38"
  | "V39"
  | "V40"
  | "V41"
  | "V42"
  | "V43"
  | "V44"
  | "V45"
  | "V46"
  | "V47"
  | "P1"
  | "P2"
  | "P3"
  | "P4"
  | "N1"
  | "N2"
  | "N3"
  | "N4"
  | "N5"
  | "N6"
  | "N7"
  | "N8"
  | "N9"
  | "N10"
  | "N11"
  | "J1"
  | "J2"
  | "J3"
  | "J4"
  | "J5"
  | "J6"
  | "J7"
  | "J8"
  | "J9"
  | "J10"
  | "J11"
  | "J12"
  | "J13"
  | "J14"
  | "J15"
  | "J16"
  | "J17"
  | "J18"
  | "J19"
  | "J20"
  | "J21"
  | "J22"
  | "J23"
  | "J24"
  | "J26"
  | "J27"
  | "E1"
  | "E2"
  | "E3"
  | "E4"
  | "E5"
  | "Y3"
  | "Y4"
  | "Y5"
  | "Z1"
  | "Z2"
  | "Z3"
  | "Z4"
  | "Z5"
  | "Z6"
  | "Z7"
  | "Z8"
  | "Z9"
  | "Z10"
  | "Z11"
  | "Z12"
  | "Z13"
  | "O1"
  | "O2"
  | "O3"
  | "O4"
  | "O5"
  | "O6"
  | "O7"
  | "O8";

export interface Mutant {
  readonly name: string;
  readonly law?: Law;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  readonly killedBy: string;
}

const fallback = "apps/hub/src/modules/relay/03-domain/fallback.ts";
const cli = "apps/cli/src";
const cliDoctor = `${cli}/02-application/queries/doctor.query.ts`;
const cliCheck = `${cli}/03-domain/check.ts`;
const cliPaths = `${cli}/03-domain/paths.ts`;
const cliHubAddress = `${cli}/03-domain/hub-address.ts`;
const cliJoin = `${cli}/03-domain/join.ts`;
const cliJoinMachine = `${cli}/02-application/commands/join-machine.command.ts`;
const cliProject = `${cli}/03-domain/project.ts`;
const cliLaunch = `${cli}/03-domain/launch.ts`;
const cliShims = `${cli}/03-domain/shims.ts`;
const cliCodex = `${cli}/03-domain/codex.ts`;
const cliJsonFile = `${cli}/03-domain/json-file.ts`;
const cliPi = `${cli}/03-domain/pi.ts`;
const cliUserPath = `${cli}/03-domain/user-path.ts`;
const cliTitles = `${cli}/03-domain/titles.ts`;
const cliMemory = `${cli}/03-domain/memory.ts`;
const cliSchedule = `${cli}/03-domain/schedule.ts`;
const deployCompose = "deploy/compose.yaml";
const deployConfig = "deploy/cota.toml";
const y3 =
  "Y3: The Compose file names no ClickHouse password; ClickHouse's password is the secret file's.";
const y4 =
  "Y4: Neither service has a secret as an environment variable or in its command: every secret reaches it as a file mounted read-only.";
const y5 =
  "Y5: With `COTA_BIND` unset, the hub is published on 127.0.0.1 alone, and ClickHouse on no port of the host.";
const installCriteria = "evals/install/criteria.ts";
const e1 = "E1: A run with any criterion failed, or with none, fails.";
const e2 =
  "E2: A machine, a launch or a route the eval could not read fails its criterion; nothing unobserved passes.";
const installClient = "evals/install/client.ts";
const installAgent = "evals/install/agent.ts";
const e3 =
  "E3: A run whose client announces any tool but the eval's two, or lacks one of them, does not start.";
const e4 =
  "E4: A run whose installer was stopped at a limit fails `ended`, naming the limit, whatever else it did.";
const e5 =
  "E5: A run whose agent installer's last message does not begin with the word that says it is done fails `ended`, quoting that message's first line.";
const saidItWasDone =
  "is done only when the client's last message begins with the word that says so, and otherwise quotes what it said";
const neverGivenTheTask =
  "does not start a client whose context holds any tool but the eval's two: it is never given the task, and nothing runs";
const stoppedAtItsStart =
  "stops a client whose start announces any other tool, and runs none of its calls";
const stoppedAtItsLimits =
  "stops a client at its turn limit, its spend limit, and when the eval stops it, keeping what it reported spending";
const cliReportTitles = `${cli}/02-application/commands/report-titles.command.ts`;
const cliRecord = `${cli}/03-domain/antigravity-record.ts`;
const cliRequests = `${cli}/03-domain/requests.ts`;
const cliSendRequests = `${cli}/02-application/commands/send-reported-requests.command.ts`;
const cliSqliteRecords = `${cli}/04-infrastructure/sqlite-client-records.ts`;
const cliRunLock = `${cli}/04-infrastructure/node-run-lock.ts`;
const cliShowRequests = `${cli}/02-application/queries/show-requests.query.ts`;
const j3 =
  "J3: For every client file and every set of pools, what is not `cota`'s reads as the same value after a rewrite as before, and in Codex's file every line outside `cota`'s tables is unchanged and in order.";
const j4 =
  "J4: Rewriting a file twice with the same pools gives the bytes of rewriting it once, and the second rewrite writes nothing.";
const j5 =
  "J5: After a rewrite, `cota`'s part of a file names exactly the pools given, each with its models, and after the rewrite with none, the file holds nothing of `cota`'s.";
const j18 =
  "J18: After `cota shims` on Windows, the user's `Path` holds the shims' directory exactly once, as its first entry, and every other entry as it was, in order.";
const j1 =
  "J1: For every host, port, user information and path, the `https`, `http`, `ssh`, `git` and short forms of a remote, with or without `.git` and a trailing slash, in any case, give the same project: the path, without `.git`, lowercased.";
const j2 =
  "J2: A remote's user information never appears in the project read from it.";
const j6 =
  "J6: A launch to a subscription pool starts its client with the own login only when the pool is the own pool, with a machine login only when it is that login's pool, and otherwise not at all.";
const j7 =
  "J7: No launch whose pool is keyed starts its client without the hub's address.";
const j8 =
  "J8: With `COTA=off`, or on a machine that has not joined, the client gets exactly the environment and arguments the launch was given.";
const j10 =
  "J10: After `cota shims`, the shell's file holds `cota`'s line exactly once, as its last line, and every other line as it was, in order.";
const o1 =
  "O1: A page shows at most the entries asked, each text cut at the cut asked, and says of each what it left out: the text's length less what it shows, plus what the hub cut.";
const o2 =
  "O2: Reading pages from the first entry, each from where the page before said the next starts, shows every entry once, in order, and ends with a page that says it is the last.";
const o3Kept =
  "O3: the reader key, given on standard input, is kept 0600 and reaches the hub only in x-cota-key, never in what any subcommand prints";
const o3Refused =
  "O3: a reader key typed at the prompt is kept; a key of another scope, or one the hub does not know, is refused without being printed or written";
const memoryVerdicts = "evals/memory/verdicts.ts";
const memoryAgent = "evals/memory/agent.ts";
const memoryTools = "evals/memory/tools.ts";
const o4 =
  "O4: An answer to a question that has facts is right only when its first line says it found one and it holds a spelling of every fact.";
const o5 =
  "O5: An answer whose first line says it found nothing is right exactly for a question with no facts, and missed for any other; one that says it found something, to a question with none, is wrong.";
const o6 =
  "O6: An answer that holds a secret of the world, or whose answerer's commands or what they printed hold the reader key, is leaked, whatever else it holds.";
const o7Context =
  "O7: a client whose context holds another tool is not given the question, and runs nothing";
const o7Start =
  "O7: a client that announces a built-in tool at its start is stopped, and runs nothing";
const o8 =
  "O8: The agent answerer's tool runs the world's `cota` only for `memory get`, `memory sql` and `memory transcript`, without a shell, in the world's machine; any other arguments are refused and nothing runs.";
const o8Served =
  "O8: runs the machine's cota with the arguments and input given, without a shell, and refuses any other command with nothing run";
const j9 =
  "J9: No launch, shim, schedule or rewrite puts a hub key or a login in any command's arguments, and no command but `cota hub-key keyed` prints one.";
const j11 =
  "J11: For any sequence of appends to a source, cut anywhere, inside a line or a character, the titles read run by run are those of reading the whole once.";
const j12 =
  "J12: For any sequence of changes and runs whose batches are kept or fail, a session's current title is among those each run has to send until a batch holding it is answered 204, and among none after until it changes; a run sends them in batches, in order, until one is not kept.";
const j13 =
  "J13: A session's title is T3 Code's, else Claude Code's owner name, else its generated one, else Codex's, the first not empty as the hub keeps it, and the hub keeps it as sent.";
const j14 =
  "J14: Every check that fails or warns says what is wrong and the command that fixes it.";
const j15 =
  "J15: For every system and every combination of `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `HOME`, `APPDATA` and `LOCALAPPDATA` set, empty or unset, the configuration's, the state's and the shims' directories are those of ADR-0022's table, and a directory no variable gives names the variable that would.";
const j16 =
  "J16: An address is kept only when it is `http` or `https` with no user information, path, query or fragment, and an `http` one only when its host is loopback or plain http was allowed; what is kept is its scheme, host and port, and a refusal repeats no user information.";
const j17 =
  "J17: For every set of keys and every answer of the hub to each, a join writes the configuration and keys only when the hub was reached and every key is known, none is a reader key and no two are of one scope; otherwise the machine's files are as they were.";
const j19 =
  "J19: For any record appended to step by step, its steps finishing in place later or never, and read in runs cut anywhere (between steps, on an unfinished step, after a compaction), the model calls read run by run are those of reading the whole record once, with the same usage, model, times and output, but for a step reported unfinished, which stays as it was reported, a step read past while not finished, which the next call's input holds as it was read, and the order a late call is read in. A call whose step is finished is read by the first run that finds it so, whatever step not finished lies before it, and a run not settled reports a step unfinished only when a finished call follows it; a step read past while not finished and without usage, which later finishes with usage, is read by the first run after it finishes, before that run's newer calls; and each call names as `after` the call of the greatest step below its own among those read before it, its input every step between the two, so that a call read past a late one names the call before that late one and holds its step as it was.";
const j20 =
  "J20: For any sequence of appends and runs whose reports are answered 200, refused, failed or never, a call is among those each run sends from the first run that finds its step finished, whatever step not finished lies before it, until a report holding it is answered 200, and among none after: a call reported unfinished among them, whatever its step becomes, and a late call from the first run after its step finishes; each call names as `after` a call before it in its conversation, stored before its report or earlier in it: the one just before it, but for a call read past a late one.";
const j21 =
  "J21: Every report holds calls of one folder, at most 200 and 8 MiB but for a call alone over it, in order, and no report's body is over 64 MiB; a run reads a conversation only once the calls it read before and has not sent fit in one report.";
const j22 =
  "J22: A call's usage, model, times and items are those of the record when it was read, and an item written out in the record form reads back into the step's bytes exactly.";
const j23 =
  "J23: A run opens no file of a data folder but `conversations/*.db` and their `-wal`, opens none of them to write, and leaves every file of the folder as it was.";
const j24 =
  "J24: For any record with a table or column missing, a sub-agent, a step that is not a protocol buffer or a record rewritten, the calls reported are those before it, and `cota requests show` and doctor name the conversation and the reason.";
const j26 =
  "J26: A report carries a folder's `through` only when every call the folder's readable conversations held when the run began reading it has been answered 200, and that `through` is the moment the run began.";
const j27 =
  "J27: Of runs that take the lock at once, over no lock or one whose process is gone, exactly one takes it; the lock appears whole, naming its owner, or not at all; and a run removes only its own lock.";
const signIn = "apps/hub/src/modules/sign-in";
const access = `${signIn}/03-domain/access.ts`;
const attempts = `${signIn}/03-domain/attempts.ts`;
const signInEntity = `${signIn}/03-domain/sign-in.entity.ts`;
const signInOwner = `${signIn}/02-application/commands/sign-in-owner.command.ts`;
const setUpHub = `${signIn}/02-application/commands/set-up-hub.command.ts`;
const changeOwnerPassword = `${signIn}/02-application/commands/change-owner-password.command.ts`;
const ownerPassword = `${signIn}/03-domain/owner-password.ts`;
const revokeSignIn = `${signIn}/02-application/commands/revoke-sign-in.command.ts`;
const revokeOtherSignIns = `${signIn}/02-application/commands/revoke-other-sign-ins.command.ts`;
const identifyOwner = `${signIn}/02-application/queries/identify-owner.query.ts`;
const sqliteSignIns = `${signIn}/04-infrastructure/persistence/sqlite/sqlite-sign-ins.repository.ts`;
const sqliteStoredPasswords = `${signIn}/04-infrastructure/persistence/sqlite/sqlite-stored-passwords.repository.ts`;
const signInHandlers = `${signIn}/01-presentation/sign-in.handlers.ts`;
const signInApi = `${signIn}/01-presentation/sign-in.api.ts`;
const requestLog = "apps/hub/src/modules/request-log";
const traffic = `${requestLog}/03-domain/traffic.ts`;
const reader = `${requestLog}/04-infrastructure/persistence/clickhouse/clickhouse-request-log-reader.ts`;
const h4 =
  "H4: adding model-listing requests to any request log changes no answer of overview, series, breakdown, facets or errors";
const h5 =
  "H5: for any request log and filters, the overview's requests, errors, usage, cost and unpriced count equal their sums over a breakdown by any dimension with no limit, and over the series' points";
const h7 =
  "H7: for any request log and filters, each dimension's facet is the non-empty values the overview counts requests for with that value as its dimension's only filter, each with that count";
const h9 =
  "H9: for generated request logs written by RecordRequest, every reading query answers the same over ClickHouse as over the in-memory reader, search's hits and the sessions a search query selects included";
const requestRole = `${requestLog}/03-domain/request-role.ts`;

const reportRequests = `${requestLog}/02-application/commands/report-requests.command.ts`;
const reportDomain = `${requestLog}/03-domain/report.ts`;
const reportsHandlers = `${requestLog}/01-presentation/reports.handlers.ts`;
const sqliteReportedThrough = `${requestLog}/04-infrastructure/persistence/sqlite/sqlite-reported-through.ts`;
const storedProtocol = `${requestLog}/03-domain/stored-protocol.ts`;
const reportedThroughDomain = `${requestLog}/03-domain/reported-through.ts`;
const readBack =
  "reads a reported request back: its origin, its transcript by the record form's table, and its body as its steps through its input";
const lateness =
  "answers every machine's, client's and pool's reported through in that order, late once it is more than 5 minutes behind the hub's clock";
const l7 =
  "L7: the stored requests' hub key is the caller's hub key's name, empty for the owner, and their machine the caller's x-cota-machine, whatever the report holds";
const l7Contract =
  "L7: the stored requests' hub key is the caller's hub key's name, empty for the owner, and their machine the caller's x-cota-machine, whatever the body names";
const l8 =
  "L8: a reported request's id is a function of its client, call key and start alone, a UUID version 7 stamped with the start, and two call keys never share one";
const l8Text = "L8: a reported request's id is the one the spec's text gives";
const l9 =
  "L9: however a report is delivered again, by its reporter or another, in part, with others, or after a delivery stored in part, the log holds each call once, with the rows one delivery of each call gives";
const l10 =
  "L10: a report answered 200 has every one of its calls held in the log at the moment of the answer";
const l11 =
  "L11: a report answered with any problem but request-log-unavailable and hub-store-unavailable changes nothing in the log or the hub store";
const l12 =
  "L12: for any conversation in any cut into reports, each call's input part is every item of the calls before it and its own input, in order, its output part its own, and each item is stored once per session";
const l13 =
  "L13: every stored reported request has its record form as its protocol, its purpose compaction exactly when its output is a compaction's step, and the empty value of every other column the forwarded origin holds";
const l14 =
  "L14: storing any report beside any forwarded traffic changes no answer of the quota sources, the only reading of the request log that admission, the fallback or the pools group's windows rest on";
const l15Report =
  "L15: a report naming a pool that is not observed stores nothing, whichever hub key sends it";
const l16 =
  "L16: for any sequence of reports, a machine's, client's and pool's through is the greatest any of their reports gave";
const l17 =
  "L17: a reported request's cost is the one the writer gives a request of its pool, model and usage, and none where that has no price";
const l18 =
  "L18: a call whose call before another call already names, held in the log or earlier in the report, is stored, its input part its call before's input and output and then its own input, and the other call's rows are left as they are";
const l19 =
  "L19: a report holding a call the log holds, with other content than was stored, leaves that call's rows as they were, stores its items the session does not hold, and builds each later call of the report on the call as the report gives it";
const segment = `${requestLog}/03-domain/segment.ts`;
const t1 =
  "T1: every request of a session has exactly one request role, and it depends on that session's requests only";
const t1LatestFirst = `${t1}, for two equal threads given latest first`;
const t2 =
  "T2: a request that rule 2, 3, 4 or 5 decides has that role whatever the other requests of its session are";
const t5 =
  "T5: a segment begins at a main request other than the first exactly when the compaction or the size rule holds for it";
const reportedSegments =
  "begins a reported session's segment at the call after a compaction its record names, though the prompt does not shrink, and once for one that shrinks it";
const title = `${requestLog}/03-domain/title.ts`;
const listSessions = `${requestLog}/02-application/queries/list-sessions.query.ts`;
const sessionTitles = `${requestLog}/04-infrastructure/persistence/clickhouse/clickhouse-session-titles.ts`;
const t8 =
  "T8: a listed session shows its latest report when not empty, else the title of its latest ok title request whose answer reads as one, else none";
const t9 =
  "T9: storing the same reports in any order, and any of them twice, gives every session the same reported title";
const t12 =
  "T12: a listed session's first prompt is the last user message of its first main request with a conversation, never of a title, subagent or utility request";
const transcriptRules = `${requestLog}/03-domain/transcript.ts`;
const transcripts = `${requestLog}/04-infrastructure/transcripts`;
const t10 =
  "T10: for every request, the items its transcript's entries come from are, in order, exactly the items of its system, input and output parts, a run of one item repeated taken as one on either side";
const t10Replayed =
  "T10: For every request, the items its transcript's entries come from are, in order, exactly the items of its system, input and output parts, a run of one item repeated taken as one on either side, and no entry shows an item as its JSON but those the spec names. Replayed from every exchange.";
const t11 =
  "T11: for every text in an entry, its length plus cut is the length of the text before cutting, and cut is 0 when the text fits";
const h8 =
  "H8: for any sort, the sessions list's pages, read by offset from 0 in steps of the limit, are disjoint, keep the order, and together are its total";
const search = `${requestLog}/03-domain/search.ts`;
const searchItems = `${requestLog}/02-application/queries/search-items.query.ts`;
const schema = `${requestLog}/04-infrastructure/persistence/clickhouse/schema.ts`;
const sqlDomain = `${requestLog}/03-domain/sql.ts`;
const sqlConsole = `${requestLog}/04-infrastructure/persistence/clickhouse/clickhouse-sql-console.ts`;
const sqlAnswer = `${requestLog}/04-infrastructure/persistence/clickhouse/sql-answer.ts`;
const clickHouseClient = `${requestLog}/04-infrastructure/persistence/clickhouse/client.ts`;
const x1 =
  "X1: no text sent to POST /api/sql changes any table, user, setting or grant: each is refused or does nothing, and the database reads the same";
const x2 =
  "X2: a query cannot change a setting, by SETTINGS, by SET or in the URL it cannot reach, and the profile's values hold for it";
const x3 =
  "X3: a query that reads another database or a system table beyond the harmless ones, or reaches outside the database, is refused";
const x4 =
  "X4: the line reader keeps the longest prefix of rows within 5,000 rows and 16 MiB, and reads at most the caps and two chunks";
const x5 =
  "X5: the line reader's answer is truncated exactly when rows were left past the caps";
const x6 =
  "X6: unless the SQL user has exactly the profile's settings and its one grant, no query is sent and both endpoints are unavailable";
const overTime =
  "stops a select of the hub's own user that runs past 30 seconds, in ClickHouse, and fails it as not answered in time";
const abandoned =
  "leaves nothing running in ClickHouse when the hub stops waiting for a select of its own user";
const failsLate =
  "answers ClickHouse's own failure for a select of the hub's own user that fails after its first rows";
const startedAgain =
  "gives the SQL user the limits of the latest start, over a profile an earlier start made";
const ownersLimits =
  "with limits of 2 seconds, 10 rows and 1 MiB, stops a query at 2 seconds, and truncates an answer past 10 rows or past 1 MiB";
const sqlFromConfig =
  "takes the SQL console's limits from the spec's defaults, or from [sql]";
const sqlBounds =
  "reports a [sql] limit outside its bounds, each with its path";
const pastTheCap =
  "has its first prompt from the latest 10,000, and the inspector gives no role or segment to a request older than them";
const inspectRequest = `${requestLog}/02-application/queries/inspect-request.query.ts`;
const readSession = `${requestLog}/02-application/queries/read-session.query.ts`;
const k1 = "K1: every hit is an item that matches the search query";
const k2 =
  "K2: every item of a selected session that matches the search query is a hit on some page";
const k3 =
  "K3: every hit's session has a traffic request in the window that matches the filters";
const k3InClickHouse = `${k3}, in ClickHouse`;
const k4 =
  "K4: reading every page from the first, by next, gives every hit once, in order";
const k5 =
  "K5: two search queries that lowercase to the same text have the same hits";
const k6 =
  "K6: for every string, the hub's words are the tokens ClickHouse's text index stores for it, splitByNonAlpha's each through lowerUTF8";
const k7 =
  "K7: for every search query and log, the hits with the index are those of a scan of the text";
const k8 =
  "K8: an item written twice is one hit, whose at, request and part are its earliest copy's, before and after ClickHouse merges the copies, in ClickHouse";
const k9 =
  "K9: a hit of a search is a hit of the same search query with prefix on, or with a larger fuzziness, for relau at 0.2, 0.5 and with prefix";
const k10 =
  "K10: a word of the search query is widened to itself, its first completions by length and then text, and its first neighbours by edits and then text, up to the bounds";
const k10InClickHouse = `${k10}, in ClickHouse`;
const k11 =
  "K11: for every two strings that are not empty, the hub's edits between them are ClickHouse's editDistanceUTF8";
const sessionsContract =
  "lists the sessions the pool routes sent, each with its first prompt and the title a hub key reported, latest first";
const signInCookie = `${signIn}/01-presentation/sign-in-cookie.ts`;
const i1 =
  "I1: every endpoint but those anyone may call and the definition answers 401 to a request with no caller, or one whose cookie and hub key the hub does not know";
const i5 =
  "I5: a token whose sign-in is revoked, or whose expiresAt is not after now, makes no caller";
const i6 =
  "I6: signing out, or revoking by id, ends exactly the sign-in named and no other";
const i4 =
  "I4: after any sequence of setups, sign-ins with a password or a passkey, changes of the password, passkeys made, sign-outs and revocations, the hub store holds no token, no setup code, no password in the clear, no challenge and no passkey's private key: SHA-256 digests of tokens, one hash of the stored password, and passkeys' public keys, which are not secrets";
const i7 =
  "I7: in any 10 minutes at most 10 wrong passwords, setup codes and current passwords are compared, whether sent one after another or together; once 10 have been, every attempt that would be compared is answered 429 until the oldest of them is 10 minutes old, whatever it gives";
const i8 =
  "I8: no 401 urn:cota:wrong-password or urn:cota:wrong-setup-code is answered less than one second after its request arrived";
const i11 =
  "I11: over any sequence of setups with right and wrong codes, the right ones in any writing, sent one after another or together, and any passwords, the password stored is the one given by the first setup that held the hub's setup code, and no other setup changes anything or signs anyone in";
const i12 =
  "I12: on a hub whose configuration holds an owner password, setup and changing the password are refused, and no stored password signs in, whatever the store holds";
const i13 =
  "I13: after a change, the new password signs in and the old one does not, the sign-in that made the change is live, and every other is revoked, one made with the old password while the change was made among them; of changes sent together, one is made and the others are answered as a wrong password";
const signInWithPasskey = `${signIn}/02-application/commands/sign-in-with-passkey.command.ts`;
const removePasskey = `${signIn}/02-application/commands/remove-passkey.command.ts`;
const challengesFile = `${signIn}/03-domain/challenges.ts`;
const relyingParty = `${signIn}/03-domain/relying-party.ts`;
const simpleWebAuthn = `${signIn}/04-infrastructure/simple-web-authn.ts`;
const sqlitePasskeys = `${signIn}/04-infrastructure/persistence/sqlite/sqlite-passkeys.repository.ts`;
const i7Passkeys =
  "I7: ten failed passkey sign-ins are answered at once and do not pause the password, and ten wrong passwords do not pause a passkey";
const i14 =
  "I14: a request's Origin gives a relying party exactly when it is https at a host name that is not an IP address, or localhost over http or https, at any port: its host name as the RP ID, and the origin as the URL writes it";
const i15 =
  "I15: a challenge is given back once, with what it was issued for, and only while it lasts, 5 minutes from when it was issued; of more than 64 outstanding, the oldest are dropped";
const i16 =
  "I16: an answer signs in exactly when it is signed by a kept passkey's key, for that passkey's RP ID and origin, over a challenge issued for signing in, not used and still lasting, with the user verified and the counter not behind; every other answer is the one 401 and makes no sign-in";
const i17 =
  "I17: over any sequence of setting, changing and forgetting the password and making and removing passkeys, sent one after another or together, on hubs with and without a configured password, a hub that was set up stays set up, and the commands refused as the last way in are exactly those that would leave no way in";
const displayNames = "apps/hub/src/modules/display-names";
const quotaModule = "apps/hub/src/modules/quota";
const sources = `${quotaModule}/03-domain/sources.ts`;
const quotaHeaders = `${quotaModule}/03-domain/quota-headers.ts`;
const readPools = `${quotaModule}/02-application/queries/read-pools.query.ts`;
const w1 =
  "W1: for any quota reading and quota headers of a pool, each scope and length that some current observation gives appears exactly once among the pool's windows, as the current one observed last, a reading winning a tie; no other window appears";
const w1Fixed =
  "W1: a reading and headers observed at the same instant give the reading's window, headers observed after the reading give theirs, and a reading after the headers gives its own";
const w1OverTheLog =
  "W1: for any quota headers of a pool, each scope and length that some current observation gives appears exactly once among the pool's windows, as the current one observed last";
const w2OverTheLog =
  "W2: every window has a used percentage, and it is the number the provider gave in that one observation, as a percentage, clamped to 0 to 100";
const w4Fixed =
  "W4: a window that resets at the answer's time, or that has no reset and was observed exactly its length before it, is not answered";
const w5 =
  "W5: a window whose source is headers takes its percentage, its reset and its length from the quota headers of one request";
const w6 =
  "W6: every window's standing in an answer is what standing gives for that window at the answer's time";
const w7 =
  "W7: GET /api/pools answers each pool of the configuration exactly once, in order of id, whatever the request log, the readings and the quota logins hold";
const poolsAnswered =
  "answers each pool with the windows its quota headers and its quota reading give, their standing at the answer's time in every pace, and the plan, to a reader key and to the owner alike";
const h9Quota =
  "H9: for generated request logs whose answers carry quota headers, the latest quota headers of the pools and names asked answer the same over ClickHouse as over the in-memory reader";
const displayName = `${displayNames}/03-domain/display-name.ts`;
const sqliteDisplayNames = `${displayNames}/04-infrastructure/persistence/sqlite/sqlite-display-names.repository.ts`;
const keysInPaths =
  "takes a key from the path percent-decoded once, with slashes, spaces, non-ASCII characters and SQL in it, up to 255 characters";
const quota = "apps/hub/src/modules/quota/03-domain/quota.ts";
const readings = `${quotaModule}/03-domain/readings.ts`;
const abandonedAsks =
  "U2: a read every asker stopped waiting for runs to its end and is kept, so twenty abandoned asks make one read in a period";
const logFailsWhileRead =
  "a request log that fails while a pool is read leaves the read running: five asks during the failure make one usage call, whose reading is kept";
const retryAfterRead =
  "read a retry-after only as whole seconds or an HTTP date, and never further than 24 hours ahead";
const hugeWindow =
  "leaves out a window whose length is not a whole number of milliseconds the hub can hold, from the quota headers and from each reader, and still answers";
const usageEndpoint = `${quotaModule}/04-infrastructure/readers/usage-endpoint.ts`;
const providerCall = `${quotaModule}/04-infrastructure/provider-call.ts`;
const zaiReader = `${quotaModule}/04-infrastructure/readers/zai.ts`;
const openCodeGoReader = `${quotaModule}/04-infrastructure/readers/opencode-go.ts`;
const u1 =
  "U1: for any asks of a pool, however they overlap, no two reads of that pool are in flight at once, and every ask made while a read runs gets that read's outcome";
const u1Fixed =
  "U1: three asks while one read runs share it, and all three get its reading";
const u2 =
  "U2: after a good reading of a pool, no read of it starts until its period has passed, and the first ask at or after then starts one";
const u2Fixed =
  "U2: a pool read with a held key is read again at 60 seconds after a good reading, not a millisecond before";
const u3 =
  "U3: after n failed reads in a row, no read starts before the last failure's end plus the longer of min(15 minutes, period × 2^(n−1)) and its retry-after, and the first ask at or after then starts one; a good reading ends the run";
const u3Waits =
  "U3: after one to six failed reads in a row the waits are 60 seconds, 2, 4, 8 and 15 minutes with a held key, and 2, 4, 8 and 15 minutes with a quota login";
const u3RetryAfter =
  "U3: a 429's retry-after longer than the backoff holds the next read back until it has passed";
const u4 =
  "U4: after any sequence of reads, a pool's quota reading is its last good one, and its failure the latest since that reading, or none";
const u4Fixed =
  "U4: a failed read keeps the last good reading beside its failure, a good one clears the failure, and an expired quota login forgets them";
const u5Fixtures =
  "U5: each reader reads its constructed fixture into literal windows and plan";
const u5 =
  "U5: each reader turns a 2xx answer that does not decode, or that gives no window, into the failure unreadable, never into a reading";
const u5NoWindow =
  "U5: a Z.ai answer whose windows are all of units the reader does not know, or none long, is unreadable";
const u6 =
  "U6: every call to a usage endpoint sends User-Agent: cota/<version>, and is abandoned 10 seconds after it was sent";
const refreshQuotaLogin = `${quotaModule}/02-application/commands/refresh-quota-login.command.ts`;
const readQuota = `${quotaModule}/02-application/commands/read-quota.command.ts`;
const keepAlive = `${quotaModule}/02-application/commands/keep-quota-logins-alive.command.ts`;
const sqliteQuotaLogins = `${quotaModule}/04-infrastructure/persistence/sqlite/sqlite-quota-logins.ts`;
const giveQuotaLogin = `${quotaModule}/02-application/commands/give-quota-login.command.ts`;
const quotaLoginDomain = `${quotaModule}/03-domain/quota-login.ts`;
const forgottenWhileRefreshed =
  "a quota login forgotten while it is refreshed is not sent to the usage endpoint afterwards";
const g4SameMillisecond =
  "G4: a quota login refused while another given to its pool in the same millisecond is refreshed is not refreshed again, though the store fails to write its expiry";
const chatGptEnds =
  "ends at the exp of a JWT, and 8 days after now when the token is not a JWT or its payload has no numeric exp";
const g1Contract =
  "G1: a login whose token is too long, or holds a space, is answered 400 without the token";
const g1Echoes =
  "G1: token and usage endpoints that answer with every token in their bodies, refuse, fail, cannot be read or never answer put no token in an API answer, a problem, a log line or the request log";
const g9 =
  "G9: a quota login for a pool that takes none, or that takes the other provider's, is answered 400 quota-login-not-taken, and the hub store does not change";
const g2 =
  "G2: with a quota login kept for every subscription pool, no request the relay sends to a provider carries a quota login's token";
const u5Each =
  "U5: each change of each reader's fixture that the spec's decoding refuses, alone, is the failure unreadable";
const u6Tokens =
  "U6: every call to a token endpoint sends User-Agent: cota/<version>, and is abandoned 10 seconds after it was sent";
const connectScript = `${quotaModule}/01-presentation/connect.ts`;
const connectsClaude =
  "connects a Claude login: the hub keeps it and reads with it, the client never sees the owner password or a key, and the script prints no token and leaves no copy";
const failedClaudeSignIn =
  "a Claude sign-in that fails after leaving a login is not kept, and leaves no copy and prints no token";
const malformedKeychainItem =
  "a keychain item that is not a Claude login is not kept, and leaves no copy and prints none of it";
const malformedAuthJson =
  "an auth.json that is not a ChatGPT login is not kept, and leaves no copy and prints none of it";
const interruptedConnect =
  "an interrupt while the client signs in stops the client, keeps nothing, leaves no copy and signs out";
const hungUpConnect =
  "a SIGHUP while the client signs in is an interrupt: it stops the client, keeps nothing, leaves no copy and signs out";
const leftBehind =
  "names each throwaway directory an earlier run left, and how to remove it and its keychain item, and removes none of them";
const loginNotTaken =
  "a login the hub does not decode is not kept, and leaves no copy and prints no token";
const olderHub =
  "stops before any client runs when the hub's list of pools is not the API's, as an older hub's may not be";
const ownersItemChanged =
  "a Claude sign-in that changes the owner's own keychain item is not kept: the script reads and deletes none of it, and says what to check";
const foreignItem =
  "a keychain item of the throwaway directory's name that was there before the sign-in is left alone, and no client runs";
const plainHttpRule =
  "sends over https to any host, and over plain http only to this machine as written";
const plainHttpRefused =
  "refuses to send the owner password over plain http to a host that is not this machine";
const anthropicReader = `${quotaModule}/04-infrastructure/readers/anthropic.ts`;
const chatGptReader = `${quotaModule}/04-infrastructure/readers/chatgpt.ts`;
const tokenEndpoint = `${quotaModule}/04-infrastructure/token-endpoints/token-endpoint.ts`;
const g3 =
  "G3: for any overlapping reads and keep-alive checks, no two refreshes of one quota login are in flight at once, and each sends the refresh token the previous good refresh returned, or the one given";
const g4 =
  "G4: once a token endpoint refuses a quota login's refresh, no refresh and no usage call is made with that login, across restarts, until a new one is given for its pool";
const g4Sqlite =
  "G4: over a SQLite store, restarted, a refused quota login is neither refreshed nor used until a new one is given";
const g5 =
  "G5: no usage call sends an access token that ends within 5 minutes of the call";
const g6 =
  "G6: a read makes at most two usage calls, and a second only after the first was answered 401 and the login was then refreshed";
const g7 =
  "G7: after any sequence of gives and refreshes whose writes succeed, the hub store holds the tokens of the latest good refresh, or the given ones when none followed, and a hub started on it reads with them";
const g7Sqlite =
  "G7: over a SQLite store, restarted, the store holds the tokens of the latest good refresh, or the given ones, and a hub started on it reads with them";
const g8 =
  "G8: at the hub's start and at every hour after it, every kept quota login that is not expired and whose access token ends within 5 minutes of that check is refreshed";
const readingKept =
  "keeps a pool's last good quota reading beside a failed read, waits its backoff before reading again, and logs the failure without the held key";
const admission = "apps/hub/src/modules/admission/03-domain/admission.ts";
const hubKey = "apps/hub/src/modules/admission/03-domain/hub-key.ts";
const identifyHubKey =
  "apps/hub/src/modules/admission/02-application/queries/identify-hub-key.query.ts";
const cost = "apps/hub/src/modules/request-log/03-domain/cost.ts";
const price = "apps/hub/src/shared/03-domain/price.ts";
const usage = "apps/hub/src/shared/03-domain/usage.ts";
const httpProvider =
  "apps/hub/src/modules/relay/04-infrastructure/provider/http-provider.ts";
const headers =
  "apps/hub/src/modules/relay/04-infrastructure/provider/headers.ts";
const tee = "apps/hub/src/lib/tee.ts";
const relay = "apps/hub/src/modules/relay/module.ts";
const forwardRequest =
  "apps/hub/src/modules/relay/02-application/commands/forward-request.command.ts";
const planCredential =
  "apps/hub/src/modules/relay/02-application/queries/plan-credential.query.ts";
const config = "apps/hub/src/config/config.ts";
const neverReported =
  "R7: a forwarded request's client is never a reported client, whatever its tag and user agent";
const observedRefusals =
  "refuses what an observed pool cannot have, an observed pool without its provider, a pool that is neither observed nor names its protocol, and a fallback pool that is observed";
const observedAtTheRelay =
  "L15: no request admitted by the relay names an observed pool: every hub key in x-cota-key is answered 403 cota_hub_key_scope there, as the bearer token or in x-api-key 403 cota_hub_key_rejected, and nothing is forwarded or recorded";
const anthropic =
  "apps/hub/src/modules/relay/04-infrastructure/protocols/anthropic-messages/anthropic-messages.ts";
const codex =
  "apps/hub/src/modules/relay/04-infrastructure/protocols/chatgpt-codex/chatgpt-codex.ts";
const conversation = "apps/hub/src/shared/03-domain/conversation.ts";
const storedItems =
  "apps/hub/src/modules/request-log/03-domain/stored-items.ts";
const inMemoryRequests =
  "apps/hub/src/modules/request-log/05-tests/fakes/in-memory-requests.repository.ts";
const finishedRequest =
  "apps/hub/src/modules/relay/03-domain/finished-request.ts";
const recordRequest =
  "apps/hub/src/modules/request-log/02-application/commands/record-request.command.ts";
const clickHouseRequests =
  "apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-requests.repository.ts";
const scrubber =
  "apps/hub/src/modules/recording/03-domain/scrubber/scrubber.ts";
const hubStore = "apps/hub/src/shared/04-infrastructure/hub-store/hub-store.ts";
const recordExchange =
  "apps/hub/src/modules/recording/02-application/commands/record-exchange.command.ts";

const bytesInBytesOut =
  "R1: For every forwarded request, the provider receives exactly the body the client sent, and the client receives exactly the body the provider sent.";
const secretsStay =
  "R2: A hub key and a tag never reach a provider. A held key and a kept login never reach a client. No hub key, held key, kept login or login reaches the request log or a log line.";
const subscriptionSpentOnlyByALogin =
  "R3: A request to a subscription pool reaches a provider with the credential it came with, or, when `Fallback` answered divert, with the fallback pool's kept login. It never reaches a provider with a held key.";
const keyedSeesNoClientCredential =
  "R4: A request to a keyed pool reaches the provider with the pool's held key or with none.";
const readingCannotBreakForwarding =
  "R5: Whatever the copy's reader or the recorder does (falls behind, fails, never finishes), the client receives the provider's full response.";
const recordedOncePerExchange =
  "R6: Every request the hub sends to a provider is recorded in the request log exactly once, whatever the outcome; a rejected request is not recorded.";

const aBodyComesBack =
  "L1: For every JSON object a protocol can split, joining what it was split into gives the same JSON value.";
const oncePerSession =
  "L2: Two items of one session that are the same JSON value once the overlay is out have the same digest, and are stored once.";
const writerOncePerSession =
  "stores an item once per session across batches and writers, and asks the store about a session once";
const nothingInvented =
  "L3: Every item stored is an element of a body the hub forwarded or was built from a response it relayed; a request whose body could not be read has no items, and says so by having no `request_items` row.";
const aBodyComesBackFromClickHouse = `${aBodyComesBack} Rebuilt from ClickHouse's three tables, for every exchange and a request with odd text.`;
const textIsWellFormed =
  "L4: The rows written for a request are its rows as sent with each lone surrogate in a text made U+FFFD, so that every text is well-formed; an item's content and a request's layout, overlay and params, which write one as its escape, are as sent.";
const textIsWellFormedInClickHouse = `${textIsWellFormed} Written to ClickHouse: a request whose body holds a lone surrogate is written, and so are the requests after it.`;
const oneRequestCannotStopTheWriter =
  "L5: When the repository declines every batch that holds certain requests and stores every other batch, each other request is stored once, with a body that comes back, and, once one of them is stored, each of those requests is dropped and counted once.";
const oneRequestCannotStopClickHouse = `${oneRequestCannotStopTheWriter} Written to ClickHouse, whose items decline a marked request: the requests of its batch and of a later one, of its session and another, are each written once and rebuilt, and it is dropped once.`;
const nothingDroppedWhileNothingStored =
  "L6: While the repository declines every batch, the writer drops no request for it, and once the repository stores batches again every request is stored once.";
const reportedTitleWellFormed =
  "keeps a reported title whose session, title and machine hold lone surrogates, each made U+FFFD";

const migratedOnce =
  "M1: opening a store that holds every step the hub lists runs no step and leaves every table as it was";
const migratedInOrder =
  "M2: after any sequence of starts, each with a list that begins with the one before, every step has run exactly once, and in the listed order";
const newerRefused =
  "M3: a store holding a step the hub does not list stops the start, and nothing in it changes";

const readerOpensNoPool =
  "A5: a request that presents a reader key is rejected, whatever pool it names";
const readMachine =
  "apps/hub/src/modules/admission/02-application/queries/read-machine.query.ts";
const priceLists =
  "apps/hub/src/modules/request-log/04-infrastructure/prices/prices.ts";
const opensExactly =
  "A7: the pools answered are exactly those whose kind is the caller's scope, in order of id: every pool for the owner and none for a reader key";
const ownPriceWins =
  "A8: a keyed pool's models are those of its price list and its own prices, with the list's limits and image input, each at the pool's own price when it has one, else the list's, every missing cache rate filled in; a subscription pool has none";
const identifiedAsConfigured =
  "A6: IdentifyHubKey gives the name and scope the policy gives the presented key's digest, and nothing for a key the policy does not know or a request that presents none";

const decideAgrees =
  "the shipped decide answers as the proved model does, for every history we generate";

const archiveDomain = `${requestLog}/03-domain/archive.ts`;
const archiveDays = `${requestLog}/02-application/commands/archive-days.command.ts`;
const decidedWhenDue =
  "B10: a day without a manifest is decided to be archived exactly when the log holds rows of it and an hour has passed since it ended";
const decidedAtTheHour =
  "B10: a day is decided to be archived at the instant an hour has passed since it ended, and not a millisecond before";
const decidedToWriteNothing =
  "B3: when every archived day's summary equals its manifest and no other day is due, the run is decided to write nothing";
const decidedChanged =
  "B4: a day whose manifest differs from the log's summary of it, and that the log holds rows of, is decided changed, to be checked and archived again";
const decidedNeverOver =
  "B5: a day with a manifest is never decided to be archived as a new day; one whose manifest cannot be read is left, and one the log holds no row of is missing";
const verifiedBeforeNamed =
  "B2: after runs whose exports, loads and checks fail, break off or disagree, and whose writes and renames fail, every table file with a final name or named by a manifest was loaded and found the log's count and checksum of its table and day";
const nothingWritten =
  "B3: a second run over a log that has not changed, with no other day due and no partial file, writes, renames and removes no file, whatever fails, left over or unreadable";
const archive = `${requestLog}/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts`;
const insertWaitedOn =
  "the restore's insert is stopped by ClickHouse at 10 minutes and waited on for 11";
const stalledExportEnds =
  "an export that sends some bytes and then nothing fails 11 minutes after it began";
const leftoverReplaced =
  "a day's export loads back to its count and checksum, its fingerprint is the summary's, and the session's tables behave as the archiver assumes";
const exportBreaksOff =
  "B2: an export that breaks off after its first bytes fails its stream, and never ends as a short file";
const nothingWrittenOverClickHouse =
  "B3: a second run over a log that has not changed writes, renames and removes no file";
const archivedAgainOverClickHouse =
  "B4: after a run, every day the log holds rows of has a manifest equal to its summary, and a late request gets its day archived again";
const onlySelectsAndInserts =
  "B8: a run sends the log's tables nothing but SELECT and INSERT, apart from its own temporary tables";
const archivedAgain =
  "B4: after a run in which nothing failed, every archived day that the log holds rows of, and whose archived rows it all holds, has a manifest equal to the log's summary of it";
const nothingGivenUp =
  "B5: a run never replaces, renames or removes the manifest of a day whose archived rows the log does not all hold, nor a file it names, whatever fails";
const restoreArchive = `${requestLog}/02-application/commands/restore-archive.command.ts`;
const archiveDirectory = `${requestLog}/04-infrastructure/archive/file-system-archive-directory.ts`;
const nothingThroughADay =
  "takes a day that is a symbolic link to a directory for one whose manifest cannot be read, and writes, commits and removes nothing through it";
const dayComesBack =
  "B1: every archived day restored into a log that holds none of its rows gives each table its rows of the day, by count and checksum";
const damagedRefused =
  "B6: a day whose manifest cannot be read, whose file is missing, cut short, changed by a byte or edited in its manifest, or whose log's columns differ, is refused and nothing of it is added";
const nothingTwice =
  "B7: restoring again adds nothing, and a restore into a log that holds part of a day adds only the rest";
const restoreExitCode =
  "prints a line per day and exits 1 when a day is refused, 0 when none is, and says a day restored again is already held";
const restoreOnlySelectsAndInserts =
  "B8: a restore sends the log's tables nothing but SELECT and INSERT, apart from prepare and its own temporary tables";
const itemsFirst =
  "B9: a restore adds every row it adds to a table before any row of the next table in the load order";
const neverBeforeTheHour =
  "B10: no run archives a day for the first time before an hour has passed since it ended, at any instant and whatever fails";

const webDomain = "apps/web/src/shared/domain";
const apportioning = `${webDomain}/blocks.ts`;
const meter = `${webDomain}/meter.ts`;
const columns = `${webDomain}/columns.ts`;
const quantities = `${webDomain}/quantities.ts`;
const hues = `${webDomain}/hues.ts`;
const snippet = `${webDomain}/snippet.ts`;
const pages = `${webDomain}/pages.ts`;
const context = `${webDomain}/context.ts`;
const pairs = `${webDomain}/pairs.ts`;
const text = `${webDomain}/text.ts`;
const headline = `${webDomain}/headline.ts`;
const sqlText = `${webDomain}/sql.ts`;
const grid = `${webDomain}/grid.ts`;
const tsv = `${webDomain}/tsv.ts`;
const names = `${webDomain}/names.ts`;
const userAgent = `${webDomain}/user-agent.ts`;
const palette = `${webDomain}/palette.ts`;
const waysIn = `${webDomain}/ways-in.ts`;
const setupCode = `${webDomain}/setup-code.ts`;
const newPassword = `${webDomain}/new-password.ts`;
const routeEdits = `${webDomain}/routes.ts`;
const poolOrder = `${webDomain}/pool-order.ts`;
const everyBlockGiven =
  "V1: when the total is above zero, the parts' blocks sum to the blocks given";
const eachPartItsShare =
  "V2: a part's blocks are its exact share of the blocks rounded down or up, so a part of zero gets none";
const blocksInOrder =
  "V5: a meter has twenty blocks: full ones, then at most one partial, then empty ones";
const nearTheLimit =
  "V8: a meter is near its limit from 80% used and full at 100%";
const oneUnit =
  "V10: the unit is the smallest of 1, 2 and 5 × 10ⁿ, no less than the least unit given, of which the tallest column's total is at most fourteen";
const columnBlocks =
  "V11: a column's blocks are its total over the unit, rounded, and at least one when its total is above zero";
const mergedToFit =
  "V13: merging to fit leaves at most the columns that fit, each over adjacent buckets in runs of one length, and keeps every part's total";
const spanRoundedDown =
  "V14: a span is written in its two largest units, rounded down, so that it never says more than the span nor less by one of its smaller unit";
const tokensCompact =
  "V15: a count of tokens under a thousand is written whole, and from there in K, M, B or T with at most one decimal, within half of that decimal";
const costWritten =
  "V16: a cost is $0 for nothing, <$0.01 above nothing and below a cent, within half a cent under $100 and within half a dollar from there";
const shareWritten =
  "V17: a share is written as a whole percentage within half a point, except that a share above nothing is never 0% and a share below all is never 100%";
const deltaWritten =
  "V19: a delta is none before from nothing, no change within half a percent, a share of the previous figure below double, and a multiple rounded down from double";
const agoWritten =
  "V20: an ago is just now under a minute, and otherwise the span it has been, followed by ago";
const piecesKeepTheSnippet =
  "V21: the marked and unmarked pieces of a snippet, put together, are the snippet unchanged";
const marksAreTheQuerysWords =
  "V22: a marked piece is a whole word of the snippet that matches a word of the search query under its tolerance, compared as the search spec compares words, and every such word is marked";
const pagesCoverTheRows =
  "V23: a page holds the rows from its offset on, at most the limit of them and none past the total; the pages are as many as the total needs, each following the one before, and none is offered past the last whose offset the hub takes";
const columnsCoverTheSession =
  "V24: the columns' stretches are consecutive and cover every request once, in order, each from a main request but the first, which starts with the session; a column's main requests, other requests, errors and diversions are those of its stretch";
const aSegmentStartsAColumn =
  "V25: a column's main requests are of one segment, and a segment's first main request is the first main request of a column";
const runsOfOneLength =
  "V26: within a segment every column but the last holds the run's number of main requests and the last at most that, and the run is the smallest for which the columns and a gap between each two segments fit, or the longest segment's length when none does";
const aColumnIsItsLargestPrompt =
  "V27: a column's blocks are the largest prompt size of its main requests over the unit, rounded, and at least one when above zero, the unit chosen for the session's largest prompt size as block columns choose one";
const eachResultWithItsCall =
  "V28: every entry appears once, in order, and a result is paired with the nearest earlier unpaired call of its call id, standing alone when there is none";
const splittingKeepsTheText =
  "V29: the pieces of a text, put together, are the text: its prose and fenced code, a prose's blocks, a line's inline pieces and a message's reminders";
const aHeadlineIsOneLine =
  "V30: a message's headline is one trimmed line, blank only when the message is: the first line that is not blank of the first message field of a message that begins as a JSON object, even one a cut left unclosed, when it has one, and otherwise the message's own";
const tokensKeepTheSql =
  "V31: the tokens of a text, put together, are the text, none of them empty; a string, a quoted name or a comment is one token from its opening to its closing or the end of the text, whatever keywords it holds";
const theStatementRun =
  "V32: the statement run is the selection when it holds anything but white space, and otherwise the whole text, without the white space at either end";
const everyRowInViewDrawn =
  "V33: every row in view is drawn, and at most the rows in view and the overscan on each side, all of them rows there are";
const tsvKeepsTheValues =
  "V34: a TSV has a line of the column names and a line per row, each a field per column; a tab or a line break inside a value never makes a field or a line, and a field's escapes read back give the value's text, a null alone written \\N";
const everyIdOneRow =
  "V35: every id seen and every name of the kind is one row, the ids seen first in their order with their requests, then the names of ids not seen in theirs; a row carries its id's name and where it comes from, and an id not seen has no requests when the ids seen are all there are, and an unknown count otherwise";
const userAgentNamed =
  "V36: a user agent is named by the first browser and the first system of the lists whose mark it holds, and by none whose mark it lacks; the connect script is named as itself";
const paletteLists =
  "V37: a candidate is listed when its name or its id holds the text, ignoring case, and once: first those whose name starts with it, then those whose name holds it, then those whose id alone does, each in the order given";
const paletteMarks =
  "V38: a found candidate's name and id, put together from their pieces, are unchanged, and the place the text first holds in each, ignoring case, is its one marked piece";
const theDoor =
  "V39: a hub that is not set up is led to setup; on one that is, the sign-in screen offers the password exactly when the hub takes one and a passkey exactly when the hub keeps one and this browser offers passkeys here, and says where a passkey works exactly when a passkey is the only way in and this browser cannot use one here";
const lastWayInKept =
  "V40: Settings offers turning off the password this hub keeps, and removing a passkey, exactly when the hub would allow it, a password or a passkey being left after it; turning off is offered for no other password, and while the kept password is the last way in, it says a passkey is wanted first";
const codeAsTheHubReadsIt =
  "V41: a setup code typed in any case, with any spaces and hyphens, and O for 0 and I or L for 1, sends its first twelve characters as the hub reads them, is written as those in groups of four joined by hyphens, which reads back the same, and is complete only with twelve";
const passwordAsTheHubCounts =
  "V42: a new owner password is counted as the hub counts it, by code points, and fits exactly when it has 12 to 1,024 of them";
const editingKeepsTheOthers =
  "V43: moving a route up or down takes it one place earlier or later, but at the end it is already at, removing takes out that route alone, and adding puts the new route after the last; every other route keeps its order";
const sentAsShown =
  "V44: what is sent is the routes as shown, the n-th at position n with its pattern and pool, the key of each beside it, and the default pool as shown, at the revision read; while a route has no pool nothing is sent, and the positions of those routes are named";
const refusalOnItsRow =
  "V45: each refusal is said once, on the row of the route sent at its position, which it follows as the route moves, the default pool's on the default pool, and one at a position nothing was sent at apart from the rows; a row's refusals keep the hub's order, and a shadowed route names the route sent at the position that shadows it";
const poolsThatFit =
  "V46: a select offers every pool of the configuration that speaks the client's protocol and no other, in the configuration's order, and the pool chosen beside them when it is not among them";
const poolsInOrder =
  "V47: the pools are each shown once, by usage, most first, then by the name shown ignoring case, then by id, or by name and id alone whatever their usage, and pools equal in all of these keep the order given";
const huesInOrder =
  "V18: pools take the hues in the order given, one each, and a pool beyond the set is neutral";
const dashboardRoutes =
  "apps/hub/src/modules/dashboard/01-presentation/dashboard.routes.ts";
const insideTheFolder =
  "P1: No path, however written, reads a file outside the dashboard's folder.";
const screenReloads =
  "P2: A path the build has no file for, outside the hub's own paths and without an extension, answers the index.";
const hubPathsStay =
  "P3: A path under /api, /pools or /health never answers the index, nor any built file.";
const cachedByKind =
  "P4: A file under /assets is cached for a year, and the index and every other file are asked for again each time.";

const routesModule = "apps/hub/src/modules/routes";
const projectPattern = `${routesModule}/03-domain/project-pattern.ts`;
const routeList = `${routesModule}/03-domain/route-list.ts`;
const sqliteRoutes = `${routesModule}/04-infrastructure/persistence/sqlite/sqlite-routes.repository.ts`;
const admissionModule = "apps/hub/src/modules/admission/module.ts";
const matchingTotal =
  "N1: for every list and project, matching gives exactly one of a route, the default pool or no route, and the same one every time";
const firstMatchWins =
  "N2: the route answered matches the project, and no route before it does";
const defaultWhenNothingMatches =
  "N3: the default pool is answered exactly when no route matches and the client has one, and no route exactly when it has neither";
const caseNeverMatters =
  "N4: a project gives the same answer as the same project lowercased";
const shadowingExact =
  "N5: a route is refused as shadowed, or as the same pattern, exactly when an earlier route of its list matches every project it matches";
const everyRouteCanWin =
  "N6: in every list the hub stores, each route is the first match of some project";
const onlyFittingPools =
  "N7: a list is stored only when each of its routes' pools, and its default pool, fits the client at that moment";
const neverSkipped =
  "N8: when the route or default pool that matching picks does not fit the client, the answer is route-pool-gone, never another pool";
const overrideNamesItsPool =
  "N9: with an override that fits the client, the answer is that pool, whatever the client's list";
const onePerRevision =
  "N10: of changes sent from the same revision, one at a time or together, exactly one is stored, and every stored list is exactly the routes and default pool of one change, in memory and in SQLite";
const routesOpenNothing =
  "N11: for any lists stored, every request to a pool is admitted or rejected as it would be with none";
const admissionModuleHead = `import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as MachineHandlers from "#modules/admission/01-presentation/machine.handlers.ts";
import * as AdmitRequest from "#modules/admission/02-application/queries/admit-request.query.ts";
import * as IdentifyHubKey from "#modules/admission/02-application/queries/identify-hub-key.query.ts";
import * as ReadMachine from "#modules/admission/02-application/queries/read-machine.query.ts";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";

/** Admission under the given policy: its hub keys, and its pools' kinds. */
export const layer = (
  policy: Admission.Policy,
): Layer.Layer<AdmitRequest.AdmitRequest | IdentifyHubKey.IdentifyHubKey> =>
  Layer.mergeAll(AdmitRequest.layer(policy), IdentifyHubKey.layer(policy)).pipe(`;

const importDomain = "apps/hub/src/modules/request-log/03-domain/import.ts";
const importSource =
  "apps/hub/src/modules/request-log/04-infrastructure/import-source/clickhouse-import-source.ts";
const importDays =
  "apps/hub/src/modules/request-log/02-application/commands/import-days.command.ts";
const logArchive =
  "apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts";
const z1 =
  "Z1: every statement an import or a dry run sends its source is a SELECT, or a read of system.columns";
const z2 =
  "Z2: an import sends the log's tables nothing but SELECT and INSERT, apart from prepare and its own temporary tables";
const z3 =
  "Z3: an import adds to each table exactly the built rows of the days it adds that the log does not hold";
const z4 =
  "Z4: importing a source that has not changed again, whole or any of its days, adds no row";
const z5 =
  "Z5: a source request always gives the same id, a UUID version 7 whose time is its start, and two different source ids never give one";
const z6 =
  "Z6: each source request of a day is built once, and each of its request items is built or counted under one reason not carried";
const z6Capped =
  "Z6: a source user whose settings profile caps an answer's rows, with an overflow that breaks, still gives every day whole";
const z6ReadCapped =
  "Z6: a source user whose settings profile caps the rows a query reads, with an overflow that breaks, fails the import loudly and adds nothing";
const z6LongKeys =
  "Z6: a day whose session keys and titles together pass 128 KiB as sent, each session with an item its own request did not send, is imported whole, and a second import adds nothing";
const z7 =
  "Z7: no request an import adds is held before every item its request_items row names is held by its session";
const z8 =
  "Z8: each imported request's items, in order, are the source's items for it, each the same JSON value as the source's content";
const z9 =
  "Z9: an imported request's token classes add up to the source's prompt and completion tokens, and its cost is the price lists' for them, never the source's";
const z10 =
  "Z10: a dry run sends the request log's tables no INSERT, and the counts it reports are those a real import of the same days adds";
const z11 =
  "Z11: a day is reported added only when every row built for it is held and the log gained the count and checksum of the rows it lacked";
const z12 =
  "Z12: an import sets a display name only for a kind and key the owner has not named, once, and never one the file does not give";
const z13 =
  "Z13: an imported title is never the latest report of a session a machine reported after the import's source ended";

export const mutants: ReadonlyArray<Mutant> = [
  {
    name: "a request without a login is diverted while any login is parked on its model",
    law: "F1",
    file: fallback,
    find: "        if (request.login === undefined) return keep;\n",
    replace: `        if (request.login === undefined) {
          const now = yield* DateTime.now;
          const anyParked = HashMap.findFirst(yield* Ref.get(parked), (reset, parking) => parking.model === request.model && DateTime.isGreaterThan(reset, now));
          const fallback = HashMap.get(policy, request.pool);
          if (Option.isSome(anyParked) && Option.isSome(fallback)) return { _tag: "Divert", fallbackPool: fallback.value, reset: anyParked.value[1] };
          return keep;
        }
`,
    killedBy:
      "F1: a request without a login is kept, whatever was refused before it",
  },
  {
    name: "a diverted request goes back to the pool it bills",
    law: "F2",
    file: fallback,
    find: "fallbackPool: fallbackPool.value,",
    replace: "fallbackPool: request.pool,",
    killedBy:
      "F2: a diverted request goes to the fallback pool of the pool it bills, and to no other",
  },
  {
    name: "a parked login on a pool with no fallback pool is diverted to its own pool",
    law: "F2",
    file: fallback,
    find: "        if (Option.isNone(fallbackPool)) return keep;\n",
    replace: `        if (Option.isNone(fallbackPool)) {
          const parkedReset = yield* parkedUntil(request.login, request.model);
          return Option.isSome(parkedReset) ? { _tag: "Divert", fallbackPool: request.pool, reset: parkedReset.value } : keep;
        }
`,
    killedBy:
      "F2: a diverted request goes to the fallback pool of the pool it bills, and to no other",
  },
  {
    name: "a login is parked on every model once one is refused",
    law: "F3",
    file: fallback,
    find: "        const reset = HashMap.get(yield* Ref.get(parked), { login, model });\n",
    replace:
      "        const reset = Option.map(HashMap.findFirst(yield* Ref.get(parked), (_, parking) => parking.login === login && model.length > 0), ([, reset]) => reset);\n",
    killedBy:
      "F3: recording a refusal for another login, or for another model, never changes the decision for a request",
  },
  {
    name: "every login on a model is parked once one is refused",
    law: "F3",
    file: fallback,
    find: "        const reset = HashMap.get(yield* Ref.get(parked), { login, model });\n",
    replace:
      "        const reset = Option.map(HashMap.findFirst(yield* Ref.get(parked), (_, parking) => parking.model === model && login.length > 0), ([, reset]) => reset);\n",
    killedBy:
      "F3: recording a refusal for another login, or for another model, never changes the decision for a request",
  },
  {
    name: "diverting carries on for five minutes past the reset",
    law: "F4",
    file: fallback,
    find: "DateTime.isGreaterThan(reset.value, now)",
    replace:
      "DateTime.isGreaterThan(DateTime.add(reset.value, { minutes: 5 }), now)",
    killedBy:
      "F4: a request is diverted only if a refusal for its own login and model was recorded with a reset after now",
  },
  {
    name: "a refusal without a reset parks for 20 minutes",
    law: "F4",
    file: fallback,
    find: "Duration.minutes(15)",
    replace: "Duration.minutes(20)",
    killedBy:
      "parks a refusal without a reset for 15 minutes from when it was recorded",
  },
  {
    name: "every service the layer builds shares what is parked",
    law: "F4",
    file: fallback,
    find: `export const layer = (policy: Policy): Layer.Layer<Fallback> =>
  Layer.effect(
    Fallback,
    Effect.gen(function* () {
      const parked = yield* Ref.make(HashMap.empty<Parking, DateTime.Utc>());
`,
    replace: `const shared = Ref.makeUnsafe(HashMap.empty<Parking, DateTime.Utc>());

export const layer = (policy: Policy): Layer.Layer<Fallback> =>
  Layer.effect(
    Fallback,
    Effect.gen(function* () {
      const parked = shared;
`,
    killedBy:
      "F4: a request is diverted only if a refusal for its own login and model was recorded with a reset after now",
  },
  {
    name: "a login is still diverted at the reset itself",
    law: "F5",
    file: fallback,
    find: "DateTime.isGreaterThan(reset.value, now)",
    replace: "DateTime.isGreaterThanOrEqualTo(reset.value, now)",
    killedBy:
      "F5: once now reaches the latest reset recorded for a login and model, that login's requests for that model are kept again",
  },
  {
    name: "a login and model are judged parked at the time the service was built",
    law: "F5",
    file: fallback,
    find: `      const parked = yield* Ref.make(HashMap.empty<Parking, DateTime.Utc>());

      const parkedUntil = Effect.fn("Fallback.parkedUntil")(function* (
        login: LoginFingerprint,
        model: ModelId,
      ): Effect.fn.Return<Option.Option<DateTime.Utc>> {
        const now = yield* DateTime.now;
`,
    replace: `      const parked = yield* Ref.make(HashMap.empty<Parking, DateTime.Utc>());
      const builtAt = yield* DateTime.now;

      const parkedUntil = Effect.fn("Fallback.parkedUntil")(function* (
        login: LoginFingerprint,
        model: ModelId,
      ): Effect.fn.Return<Option.Option<DateTime.Utc>> {
        const now = builtAt;
`,
    killedBy:
      "F5: once now reaches the latest reset recorded for a login and model, that login's requests for that model are kept again",
  },
  {
    name: "the last refusal recorded sets the reset",
    law: "F6",
    file: fallback,
    find: "? DateTime.max(recorded.value, reset)",
    replace: "? reset",
    killedBy:
      "F6: recording the same refusals in any order, and any number of times each, gives the same decisions",
  },
  {
    name: "the first refusal recorded sets the reset",
    law: "F6",
    file: fallback,
    find: "? DateTime.max(recorded.value, reset)",
    replace: "? recorded.value",
    killedBy:
      "F6: recording the same refusals in any order, and any number of times each, gives the same decisions",
  },
  {
    name: "forget also drops what resets in the next 15 minutes",
    law: "F7",
    file: fallback,
    find: "DateTime.isGreaterThan(reset, now)",
    replace:
      "DateTime.isGreaterThan(reset, DateTime.add(now, { minutes: 15 }))",
    killedBy: "F7: forget changes no decision made at or after the time it ran",
  },
  {
    name: "forget keeps what has reset and drops the rest",
    law: "F7",
    file: fallback,
    find: "DateTime.isGreaterThan(reset, now)",
    replace: "DateTime.isLessThanOrEqualTo(reset, now)",
    killedBy: "F7: forget changes no decision made at or after the time it ran",
  },
  {
    name: "a refusal without a reset parks for 5 minutes",
    file: fallback,
    find: "Duration.minutes(15)",
    replace: "Duration.minutes(5)",
    killedBy: decideAgrees,
  },
  {
    name: "a refusal without a reset parks for 15 minutes from when the service was built",
    file: fallback,
    find: `      const record = Effect.fn("Fallback.record")(function* (refusal: Refusal) {
        const now = yield* DateTime.now;
`,
    replace: `      const builtAt = yield* DateTime.now;
      const record = Effect.fn("Fallback.record")(function* (refusal: Refusal) {
        const now = builtAt;
`,
    killedBy: decideAgrees,
  },
  {
    name: "the earlier of two resets stands",
    file: fallback,
    find: "? DateTime.max(recorded.value, reset)",
    replace: "? DateTime.min(recorded.value, reset)",
    killedBy: decideAgrees,
  },
  {
    name: "a diverted request carries the time it was decided, not the reset",
    file: fallback,
    find: "reset: reset.value,",
    replace: "reset: yield* DateTime.now,",
    killedBy: decideAgrees,
  },
  {
    name: "a pool named as its own fallback pool keeps its requests",
    file: fallback,
    find: "if (Option.isNone(fallbackPool)) return keep;",
    replace:
      "if (Option.isNone(fallbackPool) || fallbackPool.value === request.pool) return keep;",
    killedBy: decideAgrees,
  },
  {
    name: "forget drops what has reset by the time the service was built",
    file: fallback,
    find: `      const forget = Effect.gen(function* () {
        const now = yield* DateTime.now;
`,
    replace: `      const builtAt = yield* DateTime.now;
      const forget = Effect.gen(function* () {
        const now = builtAt;
`,
    killedBy: "drops what resets at or before now and keeps what resets later",
  },
  {
    name: "elapsed is not held at 1 after the reset",
    law: "Q1",
    file: quota,
    find: "      Duration.toMillis(DateTime.distance(start, reset)),\n    1,\n",
    replace:
      "      Duration.toMillis(DateTime.distance(start, reset)),\n    Number.POSITIVE_INFINITY,\n",
    killedBy:
      "Q1: elapsed is between 0 and 1, and resets-in is never negative, for any now, before the span or after it",
  },
  {
    name: "resets-in goes below zero after the reset",
    law: "Q1",
    file: quota,
    find: "const resetsIn = nonNegative(DateTime.distance(now, reset));",
    replace: "const resetsIn = DateTime.distance(now, reset);",
    killedBy:
      "Q1: elapsed is between 0 and 1, and resets-in is never negative, for any now, before the span or after it",
  },
  {
    name: "the emptying time counts the used share again",
    law: "Q3",
    file: quota,
    find: "Duration.times(sinceStart, (100 - used) / used)",
    replace: "Duration.times(sinceStart, 100 / used)",
    killedBy:
      "Q3: when pace gives an emptying time, it is shorter than resets-in",
  },
  {
    name: "the emptying time is the time since the start",
    law: "Q3",
    file: quota,
    find: "Duration.times(sinceStart, (100 - used) / used)",
    replace: "sinceStart",
    killedBy:
      "Q3: when pace gives an emptying time, it is shorter than resets-in",
  },
  {
    name: "the on-pace band is 1 point",
    law: "Q4",
    file: quota,
    find: "const onPaceBand = 2;",
    replace: "const onPaceBand = 1;",
    killedBy:
      "Q4: in reserve and ahead of pace are always by at least 2 points",
  },
  {
    name: "only a lead of exactly zero is on pace",
    law: "Q4",
    file: quota,
    find: 'if (Math.abs(lead) < onPaceBand) return { _tag: "OnPace" };',
    replace: 'if (lead === 0) return { _tag: "OnPace" };',
    killedBy:
      "Q4: in reserve and ahead of pace are always by at least 2 points",
  },
  {
    name: "a lead of exactly 2 points is on pace",
    file: quota,
    find: "Math.abs(lead) < onPaceBand",
    replace: "Math.abs(lead) <= onPaceBand",
    killedBy:
      "is in reserve by as many points as usage trails the time gone, from 2 points on",
  },
  {
    name: "an emptying time is given before any time has passed",
    file: quota,
    find: '  if (Duration.isZero(sinceStart)) return { _tag: "AheadOfPace", points: lead };\n',
    replace: "",
    killedBy:
      "is ahead of pace without an emptying time before the span has started, or at its start",
  },
  {
    name: "a request without a hub key is admitted to a subscription pool",
    law: "A1",
    file: admission,
    find: '        if (request.hubKey === undefined) return rejected("NoHubKey");\n',
    replace: `        if (request.hubKey === undefined) {
          const open = HashMap.get(policy.pools, request.pool);
          if (Option.isSome(open) && open.value === "subscription") return { _tag: "Admitted", hubKey: HubKeyName.make("anonymous"), kind: open.value };
          return rejected("NoHubKey");
        }
`,
    killedBy:
      "A1: a request that presents no hub key, or one the policy does not know, is rejected, whatever pool it names",
  },
  {
    name: "a hub key the policy does not know opens subscription pools",
    law: "A1",
    file: admission,
    find: '        if (Option.isNone(hubKey)) return rejected("UnknownHubKey");\n',
    replace: `        if (Option.isNone(hubKey)) {
          const open = HashMap.get(policy.pools, request.pool);
          if (Option.isSome(open) && open.value === "subscription") return { _tag: "Admitted", hubKey: HubKeyName.make(request.hubKey), kind: open.value };
          return rejected("UnknownHubKey");
        }
`,
    killedBy:
      "A1: a request that presents no hub key, or one the policy does not know, is rejected, whatever pool it names",
  },
  {
    name: "a hub key's scope is never compared with the pool's kind",
    law: "A2",
    file: admission,
    find: `        if (!opens(hubKey.value.scope, kind.value)) {
          return rejected("WrongScope");
        }
`,
    replace: "",
    killedBy:
      "A2: a request is admitted only to a pool whose kind is its hub key's scope",
  },
  {
    name: "a subscription hub key opens keyed pools too",
    law: "A2",
    file: admission,
    find: "export const opens = (scope: Scope, kind: Kind): boolean => scope === kind;",
    replace:
      'export const opens = (scope: Scope, kind: Kind): boolean => scope === kind || scope === "subscription";',
    killedBy:
      "A2: a request is admitted only to a pool whose kind is its hub key's scope",
  },
  {
    name: "the pool is looked up before the hub key",
    law: "A3",
    file: admission,
    find: `        if (request.hubKey === undefined) return rejected("NoHubKey");
        const hubKey = HashMap.get(policy.hubKeys, request.hubKey);
        if (Option.isNone(hubKey)) return rejected("UnknownHubKey");
        const kind = HashMap.get(policy.pools, request.pool);
        if (Option.isNone(kind)) return rejected("UnknownPool");
`,
    replace: `        const kind = HashMap.get(policy.pools, request.pool);
        if (Option.isNone(kind)) return rejected("UnknownPool");
        if (request.hubKey === undefined) return rejected("NoHubKey");
        const hubKey = HashMap.get(policy.hubKeys, request.hubKey);
        if (Option.isNone(hubKey)) return rejected("UnknownHubKey");
`,
    killedBy:
      "A3: a request without a known hub key gets the same answer whether or not the pool it names exists",
  },
  {
    name: "an unknown hub key is told when its pool does not exist",
    law: "A3",
    file: admission,
    find: 'if (Option.isNone(hubKey)) return rejected("UnknownHubKey");',
    replace:
      'if (Option.isNone(hubKey)) return rejected(HashMap.has(policy.pools, request.pool) ? "UnknownHubKey" : "UnknownPool");',
    killedBy:
      "A3: a request without a known hub key gets the same answer whether or not the pool it names exists",
  },
  {
    name: "an admitted request is always said to be for a subscription pool",
    law: "A4",
    file: admission,
    find: "          kind: kind.value,\n",
    replace: '          kind: "subscription",\n',
    killedBy:
      "A4: an admitted request's answer carries the kind the policy gives its pool and the name the policy gives its hub key",
  },
  {
    name: "an admitted request names the first hub key of its scope",
    law: "A4",
    file: admission,
    find: "          hubKey: hubKey.value.name,\n",
    replace:
      "          hubKey: Option.getOrThrow(Option.map(HashMap.findFirst(policy.hubKeys, (key) => key.scope === kind.value), ([, key]) => key.name)),\n",
    killedBy:
      "A4: an admitted request's answer carries the kind the policy gives its pool and the name the policy gives its hub key",
  },
  {
    name: "a reader key opens every pool",
    law: "A5",
    file: admission,
    find: "export const opens = (scope: Scope, kind: Kind): boolean => scope === kind;",
    replace:
      'export const opens = (scope: Scope, kind: Kind): boolean => scope === kind || scope === "reader";',
    killedBy: readerOpensNoPool,
  },
  {
    name: "a reader key opens subscription pools",
    law: "A5",
    file: admission,
    find: "export const opens = (scope: Scope, kind: Kind): boolean => scope === kind;",
    replace:
      'export const opens = (scope: Scope, kind: Kind): boolean => scope === kind || (scope === "reader" && kind === "subscription");',
    killedBy: readerOpensNoPool,
  },
  {
    name: "an API request's bearer token is taken ahead of its x-cota-key",
    law: "A6",
    file: hubKey,
    find: 'return key === "" ? candidates.bearer : Option.some(key);',
    replace:
      'return Option.isSome(candidates.bearer) ? candidates.bearer : key === "" ? Option.none() : Option.some(key);',
    killedBy: identifiedAsConfigured,
  },
  {
    name: "an API request's x-cota-key is not trimmed",
    law: "A6",
    file: hubKey,
    find: 'return key === "" ? candidates.bearer : Option.some(key);',
    replace:
      'return key === "" ? candidates.bearer : Option.some(candidates.cotaKey ?? key);',
    killedBy: identifiedAsConfigured,
  },
  {
    name: "a blank x-cota-key hides an API request's bearer token",
    law: "A6",
    file: hubKey,
    find: 'return key === "" ? candidates.bearer : Option.some(key);',
    replace:
      'return candidates.cotaKey === undefined ? candidates.bearer : key === "" ? Option.none() : Option.some(key);',
    killedBy: identifiedAsConfigured,
  },
  {
    name: "a hub key the policy does not know is identified as the policy's first",
    law: "A6",
    file: identifyHubKey,
    find: "if (Option.isNone(digest)) return Option.none();",
    replace:
      "if (Option.isNone(digest)) return Option.fromUndefinedOr([...HashMap.values(policy.hubKeys)][0]);",
    killedBy: identifiedAsConfigured,
  },
  {
    name: "a reader key learns every pool",
    law: "A7",
    file: readMachine,
    find: "Admission.opens(caller.hubKey.scope, pool.kind),",
    replace:
      'caller.hubKey.scope === "reader" || Admission.opens(caller.hubKey.scope, pool.kind),',
    killedBy: opensExactly,
  },
  {
    name: "a subscription hub key learns the keyed pools too",
    law: "A7",
    file: readMachine,
    find: 'caller._tag === "Owner"\n              ? ordered',
    replace:
      'caller._tag === "Owner" || caller.hubKey.scope === "subscription"\n              ? ordered',
    killedBy: opensExactly,
  },
  {
    name: "the pools are answered in the configuration's order, not by id",
    law: "A7",
    file: readMachine,
    find: "const ordered = [...HashMap.values(pools)].sort((one, other) =>\n        compareText(one.id, other.id),\n      );",
    replace: "const ordered = [...HashMap.values(pools)];",
    killedBy: opensExactly,
  },
  {
    name: "a subscription pool is answered with the models of its prices",
    law: "A8",
    file: readMachine,
    find: 'pool.kind === "keyed"\n                ? yield* listPoolModels.execute(pool.id)',
    replace:
      "pool.kind !== undefined\n                ? yield* listPoolModels.execute(pool.id)",
    killedBy: ownPriceWins,
  },
  {
    name: "the list's price wins over the pool's own",
    law: "A8",
    file: priceLists,
    find: ": { ...listed, price },",
    replace: ": listed,",
    killedBy: ownPriceWins,
  },
  {
    name: "a model only the pool's own prices name is left out",
    law: "A8",
    file: priceLists,
    find: "for (const [id, price] of Object.entries(pool.ownPrices)) {",
    replace:
      "for (const [id, price] of Object.entries(pool.ownPrices).filter(([id]) => models.has(id))) {",
    killedBy: ownPriceWins,
  },
  {
    name: "a model's context limit is forgotten",
    law: "A8",
    file: priceLists,
    find: "contextTokens: Option.fromUndefinedOr(model.contextTokens),",
    replace: "contextTokens: Option.none(),",
    killedBy: ownPriceWins,
  },
  {
    name: "a model's tiers are priced at its base rates",
    law: "A8",
    file: cost,
    find: "    rates: filled(rates),\n",
    replace: "    rates: filled(price.base),\n",
    killedBy: ownPriceWins,
  },
  {
    name: "a hub key the policy does not know is reported as no hub key",
    file: admission,
    find: 'return rejected("UnknownHubKey");',
    replace: 'return rejected("NoHubKey");',
    killedBy:
      "rejects a hub key the policy does not know as UnknownHubKey, to a pool that exists or not",
  },
  {
    name: "a hub key of the wrong scope is reported as an unknown pool",
    file: admission,
    find: 'return rejected("WrongScope");',
    replace: 'return rejected("UnknownPool");',
    killedBy:
      "rejects a hub key whose scope is not the pool's kind as WrongScope, either way round",
  },
  {
    name: "no price is a cost of zero",
    law: "C1",
    file: cost,
    find: "if (Option.isNone(price)) return Option.none();",
    replace: "if (Option.isNone(price)) return Option.some(0n);",
    killedBy:
      "C1: without a price there is no cost, and with a price there always is one",
  },
  {
    name: "a usage without tokens has no cost",
    law: "C1",
    file: cost,
    find: "  if (Option.isNone(price)) return Option.none();\n",
    replace:
      "  if (Option.isNone(price)) return Option.none();\n  if (promptOf(usage) + BigInt(usage.output) === 0n) return Option.none();\n",
    killedBy:
      "C1: without a price there is no cost, and with a price there always is one",
  },
  {
    name: "a priced request is billed for at least one output token",
    law: "C2",
    file: cost,
    find: "BigInt(usage.output) * rates.output",
    replace: "BigInt(Math.max(usage.output, 1)) * rates.output",
    killedBy: "C2: usage of zero tokens costs zero",
  },
  {
    name: "a missing cache read rate is free",
    law: "C3",
    file: cost,
    find: "cacheRead: rates.cacheRead ?? rates.input,",
    replace: "cacheRead: rates.cacheRead ?? 0n,",
    killedBy:
      "C3: one token of one class, and nothing else, costs that class's rate in the tier that applies, after the fill-in of rule 4",
  },
  {
    name: "a missing long cache write rate takes the input rate",
    law: "C3",
    file: cost,
    find: "cacheWriteLong: rates.cacheWriteLong ?? cacheWriteShort,",
    replace: "cacheWriteLong: rates.cacheWriteLong ?? rates.input,",
    killedBy:
      "C3: one token of one class, and nothing else, costs that class's rate in the tier that applies, after the fill-in of rule 4",
  },
  {
    name: "a missing short cache write rate takes the cache read rate",
    law: "C3",
    file: cost,
    find: "const cacheWriteShort = rates.cacheWriteShort ?? rates.input;",
    replace:
      "const cacheWriteShort = rates.cacheWriteShort ?? rates.cacheRead ?? rates.input;",
    killedBy:
      "C3: one token of one class, and nothing else, costs that class's rate in the tier that applies, after the fill-in of rule 4",
  },
  {
    name: "output is billed at the input rate",
    law: "C3",
    file: cost,
    find: "BigInt(usage.output) * rates.output",
    replace: "BigInt(usage.output) * rates.input",
    killedBy:
      "C3: one token of one class, and nothing else, costs that class's rate in the tier that applies, after the fill-in of rule 4",
  },
  {
    name: "every request is billed one output token more",
    law: "C4",
    file: cost,
    find: "BigInt(usage.output) * rates.output",
    replace: "BigInt(usage.output + 1) * rates.output",
    killedBy:
      "C4: when two usages and their sum all fall under the same rates, the cost of the sum is the sum of the costs",
  },
  {
    name: "the input charge is rounded down to a thousand picodollars",
    law: "C4",
    file: cost,
    find: "BigInt(usage.input) * rates.input +",
    replace: "(BigInt(usage.input) * rates.input / 1000n) * 1000n +",
    killedBy:
      "C4: when two usages and their sum all fall under the same rates, the cost of the sum is the sum of the costs",
  },
  {
    name: "a tier applies at its threshold exactly",
    law: "C5",
    file: cost,
    find: "prompt > BigInt(tier.threshold)",
    replace: "prompt >= BigInt(tier.threshold)",
    killedBy:
      "C5: the rates used are those of the highest tier whose threshold the prompt is over, and cached tokens count towards the prompt",
  },
  {
    name: "only input tokens count towards the prompt",
    law: "C5",
    file: cost,
    find: "  BigInt(usage.input) +\n  BigInt(usage.cacheRead) +\n  BigInt(usage.cacheWriteShort) +\n  BigInt(usage.cacheWriteLong);\n",
    replace: "  BigInt(usage.input);\n",
    killedBy:
      "C5: the rates used are those of the highest tier whose threshold the prompt is over, and cached tokens count towards the prompt",
  },
  {
    name: "output tokens count towards the prompt",
    law: "C5",
    file: cost,
    find: "  BigInt(usage.cacheWriteLong);\n",
    replace: "  BigInt(usage.cacheWriteLong) +\n  BigInt(usage.output);\n",
    killedBy:
      "C5: the rates used are those of the highest tier whose threshold the prompt is over, and cached tokens count towards the prompt",
  },
  {
    name: "the first tier the prompt is over applies, not the highest",
    law: "C5",
    file: cost,
    find: "    if (prompt > BigInt(tier.threshold)) rates = tier.rates;\n",
    replace:
      "    if (prompt > BigInt(tier.threshold)) {\n      rates = tier.rates;\n      break;\n    }\n",
    killedBy:
      "C5: the rates used are those of the highest tier whose threshold the prompt is over, and cached tokens count towards the prompt",
  },
  {
    name: "cache reads are taken out of the input tokens",
    law: "C6",
    file: cost,
    find: "BigInt(usage.input) * rates.input +",
    replace: "BigInt(usage.input - usage.cacheRead) * rates.input +",
    killedBy:
      "C6: when no tier lowers any rate, adding tokens to any class never lowers the cost",
  },
  {
    name: "a tier applies to prompts under its threshold",
    law: "C6",
    file: cost,
    find: "prompt > BigInt(tier.threshold)",
    replace: "prompt < BigInt(tier.threshold)",
    killedBy:
      "C6: when no tier lowers any rate, adding tokens to any class never lowers the cost",
  },
  {
    name: "the input charge is worked out in floating point",
    file: cost,
    find: "BigInt(usage.input) * rates.input +",
    replace: "BigInt(usage.input * Number(rates.input)) +",
    killedBy: "prices the largest usage exactly, past what a float can hold",
  },
  {
    name: "tiers may share a threshold",
    file: price,
    find: "below.threshold < tier.threshold",
    replace: "below.threshold <= tier.threshold",
    killedBy: "refuse tiers that are not listed with rising thresholds",
  },
  {
    name: "a token count may be a fraction",
    file: usage,
    find: "export const Tokens = Schema.Natural;",
    replace:
      "export const Tokens = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));",
    killedBy:
      "refuse tokens that are negative or not whole, and negative rates",
  },
  {
    name: "the hub decompresses the provider's answer",
    law: "R1",
    file: relay,
    find: "  decompress: false,",
    replace: "  decompress: true,",
    killedBy: bytesInBytesOut,
  },
  {
    name: "the request body is forwarded as text",
    law: "R1",
    file: httpProvider,
    find: `        ? HttpBody.raw(outgoing.body, {
            contentType: start.headers["content-type"],
            contentLength: outgoing.body.byteLength,
          })`,
    replace: `        ? HttpBody.text(
            new TextDecoder().decode(outgoing.body),
            start.headers["content-type"],
          )`,
    killedBy: bytesInBytesOut,
  },
  {
    name: "x-cota-* headers are forwarded to the provider",
    law: "R2",
    file: headers,
    find: `if (name.startsWith("x-cota-") || name === "cookie") continue;`,
    replace: `if (name === "cookie") continue;`,
    killedBy: secretsStay,
  },
  {
    name: "a finished request logs the client's headers",
    law: "R2",
    file: httpProvider,
    find: "        readingComplete: ending.readingComplete,\n      }).pipe(Effect.annotateLogs(annotations));",
    replace:
      "        readingComplete: ending.readingComplete,\n        headers: start.headers,\n      }).pipe(Effect.annotateLogs(annotations));",
    killedBy: secretsStay,
  },
  {
    name: "the fingerprint of a login is the login itself",
    law: "R2",
    file: anthropic,
    find: `    LoginFingerprint.make(
      new Bun.CryptoHasher("sha256").update(login).digest("hex"),
    ),`,
    replace: "    LoginFingerprint.make(login),",
    killedBy: secretsStay,
  },
  {
    name: "an Anthropic request's authorization is kept among its headers",
    law: "R2",
    file: anthropic,
    find: `  "x-stainless-retry-count",\n];`,
    replace: `  "x-stainless-retry-count",\n  "authorization",\n];`,
    killedBy: secretsStay,
  },
  {
    name: "a diverted request goes out with the client's own login",
    law: "R3",
    file: planCredential,
    find: `credential: { _tag: "Kept", login: pool.keptLogin.value },`,
    replace: `credential: { _tag: "Client" },`,
    killedBy: subscriptionSpentOnlyByALogin,
  },
  {
    name: "a diverted request keeps the client's x-api-key beside the kept login",
    law: "R3",
    file: headers,
    find: `if (credential._tag !== "Client" && credentialHeaders.has(name)) continue;`,
    replace: `if (credential._tag === "Held" && credentialHeaders.has(name)) continue;`,
    killedBy: subscriptionSpentOnlyByALogin,
  },
  {
    name: "a parked login's request is kept until it is refused again",
    law: "R3",
    file: planCredential,
    find: "          if (Option.isSome(now)) return now.value;\n",
    replace: "",
    killedBy: subscriptionSpentOnlyByALogin,
  },
  {
    name: "every 429 from Anthropic is a refusal",
    law: "R3",
    file: anthropic,
    find: `    head.status === 429 &&
      head.headers["anthropic-ratelimit-unified-status"]?.trim() === "rejected"`,
    replace: "    head.status === 429",
    killedBy: subscriptionSpentOnlyByALogin,
  },
  {
    name: "a refusal of a diverted request is recorded with Fallback",
    file: forwardRequest,
    find: `        const first = yield* exchange(
          yield* planCredential.execute(
            pool,
            protocol,
            loginFingerprint,
            description.model,
          ),
          Option.none(),
        );
        if (first.result._tag !== "Diverted") {
          return { _tag: "Forwarded", answer: first.result };
        }
        const second = yield* exchange(
          first.result.plan,`,
    replace: `        const planned = yield* planCredential.execute(pool, protocol, loginFingerprint, description.model);
        const first = yield* exchange(planned, Option.none());
        if (first.result._tag !== "Diverted") {
          return { _tag: "Forwarded", answer: first.result };
        }
        const second = yield* exchange(
          { ...first.result.plan, onRefusal: planned.onRefusal },`,
    killedBy:
      "passes on a refusal from the fallback pool, and does not record it with Fallback",
  },
  {
    name: "the body is read before the request is admitted",
    file: forwardRequest,
    find: "        const decision = yield* admitRequest.execute({",
    replace: `        const early = yield* incoming.body;
        if (Option.isNone(early)) return { _tag: "BodyTooLarge" };
        const decision = yield* admitRequest.execute({`,
    killedBy:
      "rejects a request without a hub key before reading its body, so a body over the limit gets the 403",
  },
  {
    name: "a client's x-api-key reaches a keyed pool",
    law: "R4",
    file: headers,
    find: `  "x-api-key",\n  "api-key",`,
    replace: `  "api-key",`,
    killedBy: keyedSeesNoClientCredential,
  },
  {
    name: "a client's authorization reaches a keyed pool without a held key",
    law: "R4",
    file: headers,
    find: `  "authorization",\n  "x-api-key",`,
    replace: `  "x-api-key",`,
    killedBy: keyedSeesNoClientCredential,
  },
  {
    name: "a held key always goes out as a bearer token",
    file: headers,
    find: `(incoming["x-api-key"]?.trim() ?? "") === ""`,
    replace: "true",
    killedBy:
      "sends the held key in x-api-key when the hub key came in x-api-key, and never the hub key",
  },
  {
    name: "an empty x-api-key takes the held key",
    file: headers,
    find: `(incoming["x-api-key"]?.trim() ?? "") === ""`,
    replace: `incoming["x-api-key"] === undefined`,
    killedBy:
      "sends the held key as a bearer token when the hub key came as one beside an empty x-api-key",
  },
  {
    name: "a keyed pool's hub key is not taken from x-api-key",
    file: hubKey,
    find: `  return apiKey === "" ? Option.none() : Option.some(apiKey);`,
    replace: "  return Option.none();",
    killedBy:
      "sends the held key in x-api-key when the hub key came in x-api-key, and never the hub key",
  },
  {
    name: "a pool the hub does not have takes its hub key as a keyed pool does",
    law: "A3",
    file: hubKey,
    find: `if (!Option.contains(kind, "keyed")) return Option.none();`,
    replace: `if (Option.contains(kind, "subscription")) return Option.none();`,
    killedBy:
      "answers a request without a known hub key in x-cota-key to a pool the hub does not have as a subscription pool would (A3)",
  },
  {
    name: "a key does not make an anthropic-messages pool keyed",
    file: config,
    find: `pool.key !== undefined || pool.protocol === "openai-chat"`,
    replace: `pool.protocol === "openai-chat"`,
    killedBy:
      "reads an anthropic-messages pool that holds a key as a keyed pool, with Anthropic's defaults or the owner's own",
  },
  {
    name: "a chatgpt-codex pool may hold a key",
    file: config,
    find: `if (pool.protocol === "chatgpt-codex" && pool.key !== undefined) {`,
    replace: "if (false) {",
    killedBy:
      "reports every rule between pools and hub keys, and every secret it cannot read, at once, each with its path",
  },
  {
    name: "a pool that holds a key may be a fallback pool",
    file: config,
    find: "} else if (isKeyed(fallback)) {",
    replace: "} else if (false) {",
    killedBy:
      "reports every rule between pools and hub keys, and every secret it cannot read, at once, each with its path",
  },
  {
    name: "a forwarded request's tag may name a reported client",
    law: "R7",
    file: "apps/hub/src/shared/03-domain/client.ts",
    find: '  if (tag !== "" && !isReported(tag)) return { client: tag, version };',
    replace: '  if (tag !== "") return { client: tag, version };',
    killedBy: neverReported,
  },
  {
    name: "a forwarded request's user agent may name a reported client",
    law: "R7",
    file: "apps/hub/src/shared/03-domain/client.ts",
    find: '    client: name === undefined || isReported(name) ? "unknown" : name,',
    replace: '    client: name ?? "unknown",',
    killedBy: neverReported,
  },
  {
    name: "an observed pool may hold what only a forwarded pool has",
    file: config,
    find: "      if (pool[field] !== undefined) {",
    replace: "      if (false) {",
    killedBy: observedRefusals,
  },
  {
    name: "an observed pool need not name its provider",
    file: config,
    find: "    if (pool.provider === undefined) {",
    replace: "    if (false) {",
    killedBy: observedRefusals,
  },
  {
    name: "an observed pool may be a fallback pool",
    file: config,
    find: "    } else if (fallback.observed === true) {",
    replace: "    } else if (false) {",
    killedBy: observedRefusals,
  },
  {
    name: "the admission policy opens an observed pool to keyed hub keys",
    law: "L15",
    file: config,
    find: "  pools: HashMap.map(config.pools, ({ kind }) => kind),",
    replace:
      '  pools: HashMap.map(config.pools, ({ kind }) => (kind === "observed" ? "keyed" : kind)),',
    killedBy: observedAtTheRelay,
  },
  {
    name: "every hub key opens an observed pool",
    law: "L15",
    file: admission,
    find: "export const opens = (scope: Scope, kind: Kind): boolean => scope === kind;",
    replace:
      'export const opens = (scope: Scope, kind: Kind): boolean => scope === kind || kind === "observed";',
    killedBy:
      "L15: no request admitted by the relay names an observed pool, whatever hub key it presents",
  },
  {
    name: "the copy holds the client back when its reader falls behind",
    law: "R5",
    file: tee,
    find: "Queue.dropping<Uint8Array, Cause.Done>(options.capacity)",
    replace: "Queue.bounded<Uint8Array, Cause.Done>(options.capacity)",
    killedBy: readingCannotBreakForwarding,
  },
  {
    name: "the client's stream ends only once the reader has finished",
    law: "R5",
    file: tee,
    find: "Stream.onExit((exit) => settle(endOf(exit))),",
    replace:
      "Stream.onExit((exit) => settle(endOf(exit)).pipe(Effect.andThen(Fiber.await(reader)))),",
    killedBy: readingCannotBreakForwarding,
  },
  {
    name: "a provider that cannot be reached is not recorded",
    law: "R6",
    file: httpProvider,
    find: `      yield* record(
        FinishedRequest.unanswered(
          start,
          endedAt,
          "error",
          error.type,
          error.message,
        ),
      );`,
    replace: "          yield* Ref.set(recorded, true);",
    killedBy: recordedOncePerExchange,
  },
  {
    name: "a request the client abandons before the answer is not recorded",
    law: "R6",
    file: httpProvider,
    find: "        if (yield* Ref.get(owned)) return;",
    replace: "        if (!(yield* Ref.get(recorded))) return;",
    killedBy: recordedOncePerExchange,
  },
  {
    name: "a refusal dropped for a divert is not recorded",
    law: "R6",
    file: httpProvider,
    find: `        yield* record(yield* unread("refused", headRefusal.value.reset));`,
    replace: "        yield* Ref.set(recorded, true);",
    killedBy: recordedOncePerExchange,
  },
  {
    name: "a refusal dropped for a divert is recorded again when its request ends",
    law: "R6",
    file: httpProvider,
    find: `        yield* record(yield* unread("refused", headRefusal.value.reset));`,
    replace: `        yield* recordRequest.execute(FinishedRequest.of(start, yield* unread("refused", headRefusal.value.reset)));`,
    killedBy: recordedOncePerExchange,
  },
  {
    name: "an exchange answered without the copy is recorded twice",
    law: "R6",
    file: httpProvider,
    find: "      if (yield* Ref.getAndSet(recorded, true)) return;",
    replace: "      yield* Ref.set(recorded, true);",
    killedBy: recordedOncePerExchange,
  },
  {
    name: "joining a body leaves out what the overlay took out of its items",
    law: "L1",
    file: conversation,
    find: "    for (const taken of whole.overlay) {",
    replace: "    for (const taken of whole.overlay.slice(0, 0)) {",
    killedBy: aBodyComesBack,
  },
  {
    name: "a part that is a single value is joined back as a list of one",
    law: "L1",
    file: conversation,
    find: `      layout: Array.isArray(value) ? "list" : "single",`,
    replace: `      layout: "list",`,
    killedBy: aBodyComesBack,
  },
  {
    name: "a key taken out deep in an item is put back at the item's top",
    law: "L1",
    file: conversation,
    find: "      taken.push({ path: [...path, key], value: each });",
    replace: "      taken.push({ path: [key], value: each });",
    killedBy: aBodyComesBack,
  },
  {
    name: "an item's keys are written in the order they came",
    law: "L2",
    file: conversation,
    find: "    const keys = Object.keys(value).sort();",
    replace: "    const keys = Object.keys(value);",
    killedBy: oncePerSession,
  },
  {
    name: "Anthropic's cache markers are kept in its items",
    law: "L2",
    file: anthropic,
    find: `  takenOut: ["cache_control"],`,
    replace: "  takenOut: [],",
    killedBy: oncePerSession,
  },
  {
    name: "an item the session already has is written again",
    law: "L2",
    file: storedItems,
    find: "  const seen = new Set(known);",
    replace: "  const seen = new Set<Conversation.Digest>();",
    killedBy: oncePerSession,
  },
  {
    name: "an item another session has is not written for this one",
    law: "L2",
    file: inMemoryRequests,
    find: ".filter((item) => sessions.includes(item.session))",
    replace: ".filter(() => true)",
    killedBy: oncePerSession,
  },
  {
    name: "Anthropic's count_tokens carries a conversation",
    law: "L3",
    file: anthropic,
    find: `  conversation: (description) =>
    description.operation === "messages"
      ? Option.some(conversation)
      : Option.none(),`,
    replace: "  conversation: () => Option.some(conversation),",
    killedBy: nothingInvented,
  },
  {
    name: "a body that could not be read is recorded with an empty conversation",
    law: "L3",
    file: finishedRequest,
    find: `      Option.flatMap(start.body, (body) =>
        Conversation.read(rules, body, ending.reading.output),
      ),`,
    replace: `      Conversation.read(
        rules,
        Option.getOrElse(start.body, () => ({})),
        ending.reading.output,
      ),`,
    killedBy: nothingInvented,
  },
  {
    name: "a body over the decoded limit is read all the same",
    law: "L3",
    file: forwardRequest,
    find: "          limits.maxDecodedBodyBytes,",
    replace: "          Number.MAX_SAFE_INTEGER,",
    killedBy: nothingInvented,
  },
  {
    name: "an item's content is written with its lone surrogates made U+FFFD",
    law: "L1",
    file: conversation,
    find: "  return JSON.stringify(value);",
    replace:
      '  return JSON.stringify(typeof value === "string" ? value.toWellFormed() : value);',
    killedBy: aBodyComesBackFromClickHouse,
  },
  {
    name: "an item's text is written with its lone surrogates",
    law: "L4",
    file: storedItems,
    find: "  text: item.text.toWellFormed(),",
    replace: "  text: item.text,",
    killedBy: textIsWellFormed,
  },
  {
    name: "a request's session is written with its lone surrogates",
    law: "L4",
    file: storedItems,
    find: "  session: request.session.toWellFormed(),",
    replace: "  session: request.session,",
    killedBy: textIsWellFormed,
  },
  {
    name: "a request's error message is written with its lone surrogates",
    law: "L4",
    file: storedItems,
    find: "  errorMessage: request.errorMessage.toWellFormed(),",
    replace: "  errorMessage: request.errorMessage,",
    killedBy: textIsWellFormed,
  },
  {
    name: "the name of a rate limit is written with its lone surrogates",
    law: "L4",
    file: storedItems,
    find: "      name.toWellFormed(),",
    replace: "      name,",
    killedBy: textIsWellFormed,
  },
  {
    name: "the writer gives ClickHouse a request's texts as they came",
    law: "L4",
    file: recordRequest,
    find: "write(taken.map(StoredItems.wellFormed))",
    replace: "write(taken)",
    killedBy: textIsWellFormedInClickHouse,
  },
  {
    name: "Codex's response.completed does not end the answer",
    file: codex,
    find: `    case "response.completed":
    case "response.incomplete":
      return { ...withResponse(reading, response), finished: true };`,
    replace: `    case "response.completed":
      return withResponse(reading, response);
    case "response.incomplete":
      return { ...withResponse(reading, response), finished: true };`,
    killedBy:
      "closes the request as ok at response.completed when Codex hangs up there, while the provider still holds the stream open",
  },
  {
    name: "Codex's cache writes are counted as input as well",
    file: codex,
    find: "        input: Math.max(usage.input_tokens - cached - written, 0),",
    replace: "        input: Math.max(usage.input_tokens - cached, 0),",
    killedBy:
      "is finished at response.completed, with its usage in the request log's classes: cached and cache-write tokens taken out of input",
  },
  {
    name: "a ChatGPT login's fingerprint ignores the account-user claim",
    file: codex,
    find: `      onSome: (user) => sha256(\`\${account}\\n\${user}\`),`,
    replace: "      onSome: () => sha256(account),",
    killedBy:
      "joins the account id with the access token's account-user claim, so a refreshed token keeps its fingerprint",
  },
  {
    name: "a ChatGPT login's fingerprint changes when its token is refreshed",
    file: codex,
    find: `      onSome: (user) => sha256(\`\${account}\\n\${user}\`),`,
    replace: `      onSome: () => sha256(\`\${account}\\n\${login}\`),`,
    killedBy:
      "joins the account id with the access token's account-user claim, so a refreshed token keeps its fingerprint",
  },
  {
    name: "every Codex 429 is a refusal",
    file: codex,
    find: `  return Option.map(
    Option.flatMap(parseJson(answer.body), (body) => decode(UsageLimit, body)),
    ({ error }) => ({ reset: resetOf(error.resets_at) }),
  );`,
    replace: "  return Option.some({ reset: Option.none() });",
    killedBy:
      "is not a refusal for another 429, a usage limit that is not a 429, or a body that is not JSON",
  },
  {
    name: "a Codex usage limit is a refusal whatever its status",
    file: codex,
    find: "  if (answer.status !== 429) return Option.none();\n",
    replace: "",
    killedBy:
      "is not a refusal for another 429, a usage limit that is not a 429, or a body that is not JSON",
  },
  {
    name: "a Codex usage limit's resets_at is read as milliseconds",
    file: codex,
    find: "    ? DateTime.make(Math.round(resetsAt * 1000))",
    replace: "    ? DateTime.make(Math.round(resetsAt))",
    killedBy:
      "is a 429 whose error.type is usage_limit_reached, with its reset from error.resets_at in Unix seconds",
  },
  {
    name: "a ChatGPT account id is kept among the client's headers",
    law: "R2",
    file: codex,
    find: `  "x-codex-beta-features",
];`,
    replace: `  "x-codex-beta-features",
  accountHeader,
];`,
    killedBy: secretsStay,
  },
  {
    name: "a pool whose refusal is told from the body asks Fallback all the same",
    file: planCredential,
    find: `            Option.isNone(model) ||
            protocol.refusal._tag === "FromBody"
          ) {`,
    replace: `            Option.isNone(model)
          ) {`,
    killedBy:
      "asks Fallback about a request to a pool whose refusal is told from the head, and never about one told from the body",
  },
  {
    name: "the repository inserts a batch's requests before their items",
    file: clickHouseRequests,
    find: "for (const { table, rows } of insertsOf({ ...batch, requestItems })) {",
    replace:
      "for (const { table, rows } of insertsOf({ ...batch, requestItems }).reverse()) {",
    killedBy:
      "inserts a batch's new items, then its request_items, then its requests",
  },
  {
    name: "the command writes again the items a session already has",
    law: "L2",
    file: recordRequest,
    find: "items: StoredItems.newItems(session, request),",
    replace:
      "items: StoredItems.newItems(new Set<Conversation.Digest>(), request),",
    killedBy: writerOncePerSession,
  },
  {
    name: "the command asks the repository about a session it has written",
    file: recordRequest,
    find: "          if (digests === undefined) unseen.push(session);",
    replace: "          unseen.push(session);",
    killedBy: writerOncePerSession,
  },
  {
    name: "a batch tried again is given new tokens, so what was stored is stored twice",
    file: clickHouseRequests,
    find: 'insert_deduplication_token: [token, table].join("-"),',
    replace:
      'insert_deduplication_token: [crypto.randomUUID(), table].join("-"),',
    killedBy:
      "tries a batch again with the same rows and tokens, so an insert stored before its failure is not stored twice",
  },
  {
    name: "the command hands the repository a batch tried again under a new token",
    file: recordRequest,
    find: "          repository.store(made.batch, made.token),",
    replace:
      "          Effect.suspend(() => repository.store(made.batch, crypto.randomUUID())),",
    killedBy:
      "stores a batch's requests once when their insert was stored but answered with a failure",
  },
  {
    name: "the writer drops a request declined alone at once, without trying it again after it stores another",
    law: "L6",
    file: recordRequest,
    find: "          setAside.push({ request: alone, reason: result.failure.message });",
    replace:
      '          yield* drop(alone, "declined", { reason: result.failure.message });',
    killedBy: nothingDroppedWhileNothingStored,
  },
  {
    name: "the writer tries a declined batch again as it is, as it does a failed one, and never splits it",
    law: "L5",
    file: recordRequest,
    find: "          repository.store(made.batch, made.token),",
    replace:
      '          repository.store(made.batch, made.token).pipe(Effect.catchTag("RequestsRepositoryDeclined", ({ detail }) => Effect.fail(new RequestsRepositoryFailed({ detail })))),',
    killedBy: oneRequestCannotStopTheWriter,
  },
  {
    name: "the writer takes a declined batch's items as its sessions', so a request made again after a request set aside lacks the items that one brought",
    law: "L5",
    file: recordRequest,
    find: `        yield* persistently(
          repository.store(made.batch, made.token),
          "write a batch",
        );
        for (const session of made.trusted) {
          remember(session, made.known.get(session) ?? new Set());
        }`,
    replace: `        for (const session of made.trusted) {
          remember(session, made.known.get(session) ?? new Set());
        }
        yield* persistently(
          repository.store(made.batch, made.token),
          "write a batch",
        );`,
    killedBy: oneRequestCannotStopTheWriter,
  },
  {
    name: "the writer takes nothing from the queue while a batch's worth of requests is set aside",
    law: "L5",
    file: recordRequest,
    find: "Math.max(1, options.batchSize - setAside.length)",
    replace: "options.batchSize - setAside.length",
    killedBy: oneRequestCannotStopTheWriter,
  },
  {
    name: "the ClickHouse repository fails, and does not decline, when ClickHouse answers an exception with its code",
    law: "L5",
    file: clickHouseRequests,
    find: 'error.code === ""',
    replace: "true",
    killedBy: oneRequestCannotStopClickHouse,
  },
  {
    name: "the ClickHouse repository writes a request's request_items row again after a batch that did not finish",
    file: clickHouseRequests,
    find: "({ requestId }) => !unfinished.has(requestId),",
    replace: "() => true,",
    killedBy:
      "writes each request's request_items row once when ClickHouse declines a batch at its requests, after its items and request_items were written",
  },
  {
    name: "the command stores a request its repository cannot hold",
    file: recordRequest,
    find: "held: repository.holds(priced),",
    replace: "held: true,",
    killedBy:
      "loses a request its repository cannot hold, counts it, and stores the ones around it",
  },
  {
    name: "a request without usage is priced as if it used no tokens",
    file: recordRequest,
    find: "          onNone: () => Effect.succeedNone,",
    replace:
      "          onNone: () => Cost.of({ input: 0, cacheRead: 0, cacheWriteShort: 0, cacheWriteLong: 0, output: 0 }, prices.of({ ...request, ...request.origin })),",
    killedBy:
      "writes the cost of a request with usage exactly, and none without usage or without a price",
  },
  {
    name: "the scrubber keeps a string that is not one of its protocol's words",
    law: "S1",
    file: scrubber,
    find: "  if (rule?.(text)) return text;\n  return filler(text);\n",
    replace: "  return text;\n",
    killedBy:
      "replaces a string the protocol does not hold as one of its words by a filler that tells its length class, and keeps an empty one",
  },
  {
    name: "the scrubber keeps a login header",
    law: "S1",
    file: scrubber,
    find: '    case "Login":\n      return loginHeader(scrubbing, value);',
    replace: '    case "Login":\n      return value;',
    killedBy:
      "gives every login a fixed fake: the same login the same fake within a run, another login the next one",
  },
  {
    name: "the scrubber's made-up JWT carries the real JWT's claims",
    law: "S1",
    file: scrubber,
    find: "  const payload =\n    Object.keys(faked).length === 0 ? {} : { [authClaims]: faked };",
    replace: "  const payload = claims;",
    killedBy:
      "replaces a JWT login by a made-up JWT whose payload holds only the fakes of the claims the fingerprint reads",
  },
  {
    name: "the scrubber leaves the JSON inside a string as it is",
    law: "S1",
    file: scrubber,
    find: "          ? scrubJson(scrubbing, parsed, undefined)\n          : asContent(parsed),",
    replace: "          ? parsed\n          : parsed,",
    killedBy:
      "scrubs the JSON inside metadata.user_id, and gives its session the fake the session header gets",
  },
  {
    name: "the scrubber keeps the keys of a tool's input",
    law: "S1",
    file: scrubber,
    find: "      Object.values(value).map((each, at) => [\n        keyFiller(at + 1),\n",
    replace:
      "      Object.entries(value).map(([key, each]) => [\n        key,\n",
    killedBy:
      "keeps no key of a tool's input, schema or arguments, nor any tool name",
  },
  {
    name: "the scrubber keeps the key of a field the protocol does not define",
    law: "S1",
    file: scrubber,
    find: "        return [keyFiller(unknown), asContent(value)];",
    replace: "        return [key, asContent(value)];",
    killedBy:
      "replaces a field the protocol does not define, its key with it, and every key, string and number inside it",
  },
  {
    name: "the scrubber puts a tool's input spread over deltas back unscrubbed",
    law: "S1",
    file: scrubber,
    find: '      scrubNested(\n        scrubbing,\n        "content",\n        fragments.map(({ text }) => text).join(""),\n      ),',
    replace: '      Option.some(fragments.map(({ text }) => text).join("")),',
    killedBy:
      "scrubs a tool's input spread over stream deltas so that the deltas of each block still join into JSON of the same shape",
  },
  {
    name: "the scrubber keeps an identifier header",
    law: "S1",
    file: scrubber,
    find: '    case "Identifier":\n      return scrubbing.fakes.identifier(value);',
    replace: '    case "Identifier":\n      return value;',
    killedBy:
      "keeps a header only when the hub or a replay needs it, its value only when it is a word of the protocol, and drops every other header with its name",
  },
  {
    name: "the scrubber keeps Codex's turn metadata header as it is",
    law: "S1",
    file: scrubber,
    find: '    case "Json":\n      return Option.getOrElse(scrubNested(scrubbing, "protocol", value), () =>\n        filler(value),\n      );',
    replace: '    case "Json":\n      return value;',
    killedBy:
      "scrubs Codex's turn metadata inside, in its header and in the body, and keeps its request kind",
  },
  {
    name: "the scrubber keeps an event's name it has never heard of",
    law: "S1",
    file: scrubber,
    find: "        : { event: isWord?.(event) ? event : filler(event) }),",
    replace: "        : { event }),",
    killedBy:
      "replaces an event type the scrubber has never heard of, in the event's name and in its data",
  },
  {
    name: "the scrubber keeps a number under an identifier key",
    law: "S1",
    file: scrubber,
    find: "      ? scrubbing.fakes.number(value)\n      : value;",
    replace: "      ? value\n      : value;",
    killedBy:
      "replaces a number under an identifier key, and keeps token counts and times",
  },
  {
    name: "a fake identifier is computed from its real value",
    law: "S1",
    file: scrubber,
    find: "    const fake = fakeIdentifier(real, identifiers.size + 1);",
    replace:
      "    const fake = fakeIdentifier(real, Number(BigInt(Bun.hash(real)) % 100000n));",
    killedBy:
      "gives identifiers fakes counted in the order they are first seen, the same fake for the same value, with their prefix or UUID shape kept",
  },
  {
    name: "the recorder writes an exchange without scrubbing it",
    law: "S1",
    file: recordExchange,
    find: "              Scrubber.exchangeFileOf(request.protocol, exchange, fakes, date),",
    replace:
      '              { source: { kind: "recorded", date, client: "unknown", version: "" }, ...exchange, expects: { logged: null } },',
    killedBy:
      "records an exchange of each protocol as a file that replays, in every chunking, as the exchange did, and holds nothing real",
  },
  {
    name: "the tee waits for a recorder that falls behind",
    law: "R5",
    file: tee,
    find: "  const queue = yield* Queue.dropping<Uint8Array, TapOverflowed | Cause.Done>(",
    replace:
      "  const queue = yield* Queue.bounded<Uint8Array, TapOverflowed | Cause.Done>(",
    killedBy:
      "R5: a recorder that hangs after the first chunk of a long event stream holds back none of it",
  },
  {
    name: "an answer without a content-type is never read as an event stream",
    file: "apps/hub/src/modules/relay/04-infrastructure/provider/headers.ts",
    find: "if (type === undefined) return asked && answer.status < 400;",
    replace: "if (type === undefined) return false;",
    killedBy:
      "reads an answer without a content-type as an event stream when the request asked for one, as ChatGPT sends it",
  },
  {
    name: "a quota header's number is kept as it came",
    file: "apps/hub/src/modules/recording/03-domain/scrubber/vocabulary.ts",
    find: 'Number(value) >= firstUnixSecond ? "1800000000" : "0"',
    replace: "value",
    killedBy:
      "keeps only the shape of a quota header's value, which says what plan its owner has and how much of it is used, and the status a refusal is told by",
  },
  {
    name: "a quota header's word is kept as it came",
    file: "apps/hub/src/modules/recording/03-domain/scrubber/vocabulary.ts",
    find: "if (refusalStatusHeaders.has(name) && refusalStatus(value)) {",
    replace: "if (/^[a-z][a-z0-9_]{0,40}$/.test(value)) {",
    killedBy:
      "keeps only the shape of a quota header's value, which says what plan its owner has and how much of it is used, and the status a refusal is told by",
  },
  {
    name: "a model named after something every object has is given that as its price",
    file: "apps/hub/src/modules/request-log/04-infrastructure/prices/prices.ts",
    find: "  Object.hasOwn(record, key)",
    replace: "  true",
    killedBy:
      "gives no price to a model or a service tier named after something every object has",
  },
  {
    name: "a request whose values cannot be made stops the writer",
    file: recordRequest,
    find: "          const made = yield* Effect.exit(valuesOf(request, session));",
    replace:
      "          const made = Exit.succeed(yield* valuesOf(request, session));",
    killedBy:
      "loses only the request whose values it could not make, counts it, and writes the ones around it",
  },
  {
    name: "a code is kept wherever its key appears, as what a tool ran is",
    law: "S1",
    file: scrubber,
    find: "      if (needed !== undefined && !Object.hasOwn(object, needed)) {",
    replace: "      if (needed !== undefined && false) {",
    killedBy:
      "keeps a code only where it is an error's, beside a message, and not where it is what a tool ran",
  },
  {
    name: "a step the store already holds runs again",
    law: "M1",
    file: hubStore,
    find: "    if (applied.includes(step.name)) continue;\n",
    replace: "",
    killedBy: migratedOnce,
  },
  {
    name: "the steps run from the last listed to the first",
    law: "M2",
    file: hubStore,
    find: "for (const step of steps) {",
    replace: "for (const step of [...steps].reverse()) {",
    killedBy: migratedInOrder,
  },
  {
    name: "a start runs only the first step the store lacks",
    law: "M2",
    file: hubStore,
    find: "    if (applied.includes(step.name)) continue;\n",
    replace:
      "    if (applied.includes(step.name)) continue;\n    if (steps.indexOf(step) > applied.length) break;\n",
    killedBy: migratedInOrder,
  },
  {
    name: "a store a newer hub wrote is migrated anyway",
    law: "M3",
    file: hubStore,
    find: "if (unknown.length > 0) {",
    replace: "if (false) {",
    killedBy: newerRefused,
  },
  {
    name: "a newer store is told only by holding more steps than the hub lists",
    law: "M3",
    file: hubStore,
    find: "const unknown = applied.filter((name) => !listed.has(name));",
    replace: "const unknown = applied.length > listed.size ? applied : [];",
    killedBy: newerRefused,
  },
  {
    name: "the store is created with the process's default mode",
    law: "M4",
    file: hubStore,
    find: 'openSync(path, "wx", 0o600)',
    replace: 'openSync(path, "wx")',
    killedBy: "M4: a store the hub creates has mode 0600",
  },
  {
    name: "a store the hub cannot write is opened read-only",
    file: hubStore,
    find: "accessSync(path, constants.R_OK | constants.W_OK)",
    replace: "accessSync(path, constants.R_OK)",
    killedBy: "refuses a store the hub cannot write",
  },
  {
    name: "a step that fails keeps what it did before it failed",
    file: hubStore,
    find: "database.transaction(() => {",
    replace: "(() => {",
    killedBy:
      "stops at a step that fails, naming it, and keeps the steps before it and nothing of it",
  },
  {
    name: "a request with no caller is told it may not, not to sign in",
    law: "I1",
    file: access,
    find: 'if (Option.isNone(request.caller)) return { _tag: "SignInRequired" };',
    replace:
      'if (Option.isNone(request.caller)) return { _tag: "NotAllowed", scope: "none" };',
    killedBy: i1,
  },
  {
    name: "every hub key is taken for a reader key",
    law: "I2",
    file: access,
    find: "const { scope } = caller.hubKey;",
    replace: 'const scope = "reader";',
    killedBy:
      "I2: every endpoint but those anyone may call and those any hub key may call answers 403 to a subscription or keyed hub key",
  },
  {
    name: "a reader key may call what only the owner may",
    law: "I3",
    file: access,
    find: 'if (request.mayCall === "reader" && scope === "reader") {',
    replace: 'if (scope === "reader") {',
    killedBy:
      "I3: a reader key gets 403 from every endpoint kept for the owner",
  },
  {
    name: "a sign-in keeps the password as its user agent",
    law: "I4",
    file: signInOwner,
    find: "const signed = yield* begin(tokens, signIns, attempt.userAgent);",
    replace: "const signed = yield* begin(tokens, signIns, attempt.password);",
    killedBy: i4,
  },
  {
    name: "a setup keeps the setup code as its user agent",
    law: "I4",
    file: setUpHub,
    find: "return yield* begin(tokens, signIns, setup.userAgent);",
    replace: "return yield* begin(tokens, signIns, setup.code);",
    killedBy: i4,
  },
  {
    name: "the stored password is kept in the clear",
    law: "I4",
    file: setUpHub,
    find: "const hash = yield* hasher.hash(setup.password);",
    replace: "const hash = OwnerPassword.PasswordHash.make(setup.password);",
    killedBy: i4,
  },
  {
    name: "a sign-in still opens a caller at the instant it expires",
    law: "I5",
    file: signInEntity,
    find: "DateTime.isGreaterThan(signIn.expiresAt, now)",
    replace: "DateTime.isGreaterThanOrEqualTo(signIn.expiresAt, now)",
    killedBy: i5,
  },
  {
    name: "a revoked or expired sign-in still opens a caller",
    law: "I5",
    file: identifyOwner,
    find: "if (Option.isNone(found) || !(yield* SignIn.isLive(found.value))) {",
    replace: "if (Option.isNone(found)) {",
    killedBy: i5,
  },
  {
    name: "the SQLite store revokes every sign-in but the one named",
    law: "I6",
    file: sqliteSignIns,
    find: '"UPDATE sign_ins SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"',
    replace:
      '"UPDATE sign_ins SET revoked_at = ? WHERE id != ? AND revoked_at IS NULL"',
    killedBy: i6,
  },
  {
    name: "revoking one sign-in revokes them all",
    law: "I6",
    file: revokeSignIn,
    find: "yield* signIns.revoke([id], yield* DateTime.now);",
    replace:
      "yield* signIns.revoke((yield* signIns.all).map((each) => each.id), yield* DateTime.now);",
    killedBy: i6,
  },
  {
    name: "revoking the other sign-ins revokes the current one too",
    law: "I6",
    file: revokeOtherSignIns,
    find: "if (signIn.id !== current && (yield* SignIn.isLive(signIn))) {",
    replace: "if (yield* SignIn.isLive(signIn)) {",
    killedBy: i6,
  },
  {
    name: "the attempt limit lets an eleventh wrong password be compared",
    law: "I7",
    file: attempts,
    find: "if (recent.length >= limit) {",
    replace: "if (recent.length > limit) {",
    killedBy: i7,
  },
  {
    name: "a wrong password is never counted",
    law: "I7",
    file: attempts,
    find: 'return [{ _tag: "Taken" }, [...recent, place]];',
    replace: 'return [{ _tag: "Taken" }, recent];',
    killedBy: i7,
  },
  {
    name: "a failure exactly 10 minutes old still counts",
    law: "I7",
    file: attempts,
    find: "DateTime.isGreaterThan(at, since),",
    replace: "DateTime.isGreaterThanOrEqualTo(at, since),",
    killedBy: i7,
  },
  {
    name: "a wrong password is answered at once",
    law: "I8",
    file: attempts,
    find: "const answerAt = DateTime.addDuration(began, wrongGuessDelay);",
    replace: "const answerAt = began;",
    killedBy: i8,
  },
  {
    name: "a wrong setup code is answered at once",
    law: "I8",
    file: setUpHub,
    find: "return yield* failAfterTheDelay(\n            began,\n            new SetupCode.WrongSetupCode(),\n          );",
    replace: "return yield* new SetupCode.WrongSetupCode();",
    killedBy: i8,
  },
  {
    name: "a wrong setup code is not counted",
    law: "I7",
    file: setUpHub,
    find: "const right = yield* attempts.compare(\n          setupCode.opens((held) =>\n            codes.matches(held, SetupCode.normalised(setup.code)),\n          ),\n        );",
    replace:
      "const right = yield* setupCode.opens((held) =>\n          codes.matches(held, SetupCode.normalised(setup.code)),\n        );",
    killedBy: i7,
  },
  {
    name: "a wrong current password is not counted",
    law: "I7",
    file: changeOwnerPassword,
    find: "const right = yield* attempts.compare(\n          Option.match(change.current",
    replace:
      "const right = yield* Effect.suspend(() =>\n          Option.match(change.current",
    killedBy: i7,
  },
  {
    name: "a place in the count is taken after the comparison",
    law: "I7",
    file: attempts,
    find: 'return [{ _tag: "Taken" }, [...recent, place]];\n          },\n        );\n        if (outcome._tag === "Limited") {\n          const remaining =\n            DateTime.toEpochMillis(outcome.until) - DateTime.toEpochMillis(now);\n          return yield* new TooManyAttempts({\n            retryAfterSeconds: Math.ceil(remaining / 1000),\n          });\n        }\n        const right = yield* matches;\n        if (right) {\n          yield* Ref.update(places, (all) =>\n            all.filter((each) => each !== place),\n          );\n        }\n        return right;',
    replace:
      'return [{ _tag: "Taken" }, recent];\n          },\n        );\n        if (outcome._tag === "Limited") {\n          const remaining =\n            DateTime.toEpochMillis(outcome.until) - DateTime.toEpochMillis(now);\n          return yield* new TooManyAttempts({\n            retryAfterSeconds: Math.ceil(remaining / 1000),\n          });\n        }\n        const right = yield* matches;\n        if (!right) yield* Ref.update(places, (all) => [...all, place]);\n        return right;',
    killedBy: i7,
  },
  {
    name: "a right attempt keeps its place in the count",
    law: "I7",
    file: attempts,
    find: "if (right) {\n          yield* Ref.update(places, (all) =>\n            all.filter((each) => each !== place),\n          );\n        }\n",
    replace: "",
    killedBy: i7,
  },
  {
    name: "a setup code is compared as it was given",
    law: "I11",
    file: setUpHub,
    find: "codes.matches(held, SetupCode.normalised(setup.code))",
    replace: "codes.matches(held, setup.code)",
    killedBy: i11,
  },
  {
    name: "a setup code is read without Crockford's look-alikes",
    law: "I11",
    file: `${signIn}/03-domain/setup-code.ts`,
    find: '    .toUpperCase()\n    .replaceAll("O", "0")\n    .replaceAll(/[IL]/g, "1");',
    replace: "    .toUpperCase();",
    killedBy: i11,
  },
  {
    name: "a hub already set up is set up again",
    law: "I11",
    file: setUpHub,
    find: "if (yield* isSetUp(kept, passkeys.any)) {",
    replace: 'if (kept._tag === "Configuration") {',
    killedBy: i11,
  },
  {
    name: "the store keeps the latest of setups sent together",
    law: "I11",
    file: sqliteStoredPasswords,
    find: "ON CONFLICT (id) DO NOTHING",
    replace:
      "ON CONFLICT (id) DO UPDATE SET hash = excluded.hash, set_at = excluded.set_at",
    killedBy: i11,
  },
  {
    name: "the stored password is consulted when the configuration holds one",
    law: "I12",
    file: ownerPassword,
    find: 'if (configured) return { _tag: "Configuration" } as const;\n    const found = yield* stored;',
    replace:
      'const found = yield* stored;\n    if (configured && Option.isNone(found)) return { _tag: "Configuration" } as const;',
    killedBy: i12,
  },
  {
    name: "the browser changes a password the configuration holds",
    law: "I12",
    file: changeOwnerPassword,
    find: 'const kept = yield* OwnerPassword.keptBy(configured.isSet, stored.read);\n        if (kept._tag === "Configuration") {\n          return yield* new OwnerPassword.PasswordInConfiguration();',
    replace:
      'const kept = yield* OwnerPassword.keptBy(\n          configured.isSet && false,\n          stored.read,\n        );\n        if (kept._tag === "Configuration") {\n          return yield* new OwnerPassword.PasswordInConfiguration();',
    killedBy: i12,
  },
  {
    name: "a change leaves the other sign-ins live",
    law: "I13",
    file: changeOwnerPassword,
    find: "          return yield* failAfterTheDelay(began, new WrongPassword());\n        }\n        yield* revokeOtherSignIns.execute(change.signIn);\n      }),",
    replace:
      "          return yield* failAfterTheDelay(began, new WrongPassword());\n        }\n      }),",
    killedBy: i13,
  },
  {
    name: "a sign-in compared while the password changed is kept",
    law: "I13",
    file: signInOwner,
    find: "!Option.exists(current, ({ hash }) => hash === kept.stored.hash)",
    replace: "Option.isNone(current)",
    killedBy: i13,
  },
  {
    name: "a change replaces the stored hash whatever it compared",
    law: "I13",
    file: sqliteStoredPasswords,
    find: '"UPDATE owner_password SET hash = ?, set_at = ? WHERE id = 1 AND hash = ?"',
    replace:
      '"UPDATE owner_password SET hash = ?, set_at = ? WHERE id = 1 AND ? IS NOT NULL"',
    killedBy: i13,
  },
  {
    name: "a change keeps the old password",
    law: "I13",
    file: changeOwnerPassword,
    find: "const next = {\n          hash: yield* hasher.hash(change.password),",
    replace:
      "const next = {\n          hash: yield* hasher.hash(\n            Option.getOrElse(change.current, () => change.password),\n          ),",
    killedBy: i13,
  },
  {
    name: "a passkey sign-in is verified at the relying party it was asked at",
    law: "I16",
    file: signInWithPasskey,
    find: "relyingParty: passkey.value.relyingParty,",
    replace: "relyingParty: issued.value.relyingParty,",
    killedBy: i16,
  },
  {
    name: "a passkey sign-in does not need the user verified",
    law: "I16",
    file: simpleWebAuthn,
    find: "requireUserVerification: true,\n          }),\n        );\n        return Option.flatMap(verified, ({ verified, authenticationInfo })",
    replace:
      "requireUserVerification: false,\n          }),\n        );\n        return Option.flatMap(verified, ({ verified, authenticationInfo })",
    killedBy: i16,
  },
  {
    name: "a challenge issued for making a passkey signs in",
    law: "I16",
    file: signInWithPasskey,
    find: ' || issued.value.purpose !== "sign-in"',
    replace: "",
    killedBy: i16,
  },
  {
    name: "a challenge is not used up when it is taken",
    law: "I15",
    file: challengesFile,
    find: "all.filter((each) => each !== found),",
    replace: "all,",
    killedBy: i15,
  },
  {
    name: "a challenge lasts through the instant it expires",
    law: "I15",
    file: challengesFile,
    find: "DateTime.isGreaterThan(DateTime.addDuration(at, lifetime), now)",
    replace:
      "DateTime.isGreaterThanOrEqualTo(DateTime.addDuration(at, lifetime), now)",
    killedBy: i15,
  },
  {
    name: "challenges are never dropped",
    law: "I15",
    file: challengesFile,
    find: "].slice(-mostOutstanding),",
    replace: "].slice(-mostOutstanding - 1),",
    killedBy: i15,
  },
  {
    name: "an IPv4 address is taken for a host name",
    law: "I14",
    file: relyingParty,
    find: 'ipv4.test(hostname) || hostname.startsWith("[")',
    replace: 'ipv4.test(`[${hostname}]`) || hostname.startsWith("[")',
    killedBy: i14,
  },
  {
    name: "an IPv6 address is taken for a host name",
    law: "I14",
    file: relyingParty,
    find: 'ipv4.test(hostname) || hostname.startsWith("[")',
    replace: 'ipv4.test(hostname) || hostname.startsWith("[[")',
    killedBy: i14,
  },
  {
    name: "any localhost subdomain is taken over http",
    law: "I14",
    file: relyingParty,
    find: 'web && url.hostname === "localhost"',
    replace: 'web && url.hostname.endsWith("localhost")',
    killedBy: i14,
  },
  {
    name: "a passkey is removed in two store calls, after its check",
    law: "I17",
    file: sqlitePasskeys,
    find: '      remove: (id, passwordConfigured) =>\n        store.use((database) =>\n          database.transaction(() => {\n            const kept =\n              database.query("SELECT 1 FROM passkeys WHERE id = ?").get(id) !==\n              null;\n            if (!kept) return "NoSuchPasskey" as const;\n            const leavesAWayIn =\n              passwordConfigured ||\n              database.query("SELECT 1 FROM owner_password").get() !== null ||\n              database\n                .query("SELECT 1 FROM passkeys WHERE id != ? LIMIT 1")\n                .get(id) !== null;\n            if (!leavesAWayIn) return "LastWayIn" as const;\n            database.query("DELETE FROM passkeys WHERE id = ?").run(id);\n            return "Removed" as const;\n          })(),\n        ),\n',
    replace:
      '      remove: (id, passwordConfigured) =>\n        Effect.gen(function* () {\n          const verdict = yield* store.use((database) => {\n            const kept =\n              database.query("SELECT 1 FROM passkeys WHERE id = ?").get(id) !==\n              null;\n            if (!kept) return "NoSuchPasskey" as const;\n            const leavesAWayIn =\n              passwordConfigured ||\n              database.query("SELECT 1 FROM owner_password").get() !== null ||\n              database\n                .query("SELECT 1 FROM passkeys WHERE id != ? LIMIT 1")\n                .get(id) !== null;\n            return leavesAWayIn ? ("Removed" as const) : ("LastWayIn" as const);\n          });\n          if (verdict !== "Removed") return verdict;\n          yield* Effect.yieldNow;\n          yield* store.use((database) =>\n            database.query("DELETE FROM passkeys WHERE id = ?").run(id),\n          );\n          return verdict;\n        }),\n',
    killedBy: i17,
  },
  {
    name: "removing a passkey ignores the configuration's password",
    law: "I17",
    file: removePasskey,
    find: "passkeys.remove(id, configured.isSet)",
    replace: "passkeys.remove(id, false)",
    killedBy: i17,
  },
  {
    name: "a failed passkey sign-in is counted",
    law: "I7",
    file: signInWithPasskey,
    find: '  Challenges | Passkeys | WebAuthn | SignIns | SignInTokens\n> = Layer.effect(\n  SignInWithPasskey,\n  Effect.gen(function* () {\n    const challenges = yield* Challenges;\n    const passkeys = yield* Passkeys;\n    const webAuthn = yield* WebAuthn;\n    const signIns = yield* SignIns;\n    const tokens = yield* SignInTokens;\n    return SignInWithPasskey.of({\n      execute: Effect.fn("SignInWithPasskey.execute")(function* (\n        attempt: PasskeyAttempt,\n      ) {\n        const { response } = attempt;\n        const challenge = webAuthn.challengeOf(\n          response.response.clientDataJSON,\n        );\n        if (Option.isNone(challenge)) return yield* new PasskeyRefused();\n        const issued = yield* challenges.take(challenge.value);\n        if (Option.isNone(issued) || issued.value.purpose !== "sign-in") {\n          return yield* new PasskeyRefused();\n        }\n        const passkey = yield* passkeys.findByCredentialId(\n          CredentialId.make(response.id),\n        );\n        if (Option.isNone(passkey)) return yield* new PasskeyRefused();\n        const counter = yield* webAuthn.verifySignIn({\n          response,\n          challenge: challenge.value,\n          passkey: passkey.value,\n          relyingParty: passkey.value.relyingParty,\n        });\n        if (Option.isNone(counter)) return yield* new PasskeyRefused();',
    replace:
      '  | Challenges\n  | Passkeys\n  | WebAuthn\n  | SignIns\n  | SignInTokens\n  | import("#modules/sign-in/03-domain/attempts.ts").Attempts\n> = Layer.effect(\n  SignInWithPasskey,\n  Effect.gen(function* () {\n    const challenges = yield* Challenges;\n    const passkeys = yield* Passkeys;\n    const webAuthn = yield* WebAuthn;\n    const signIns = yield* SignIns;\n    const tokens = yield* SignInTokens;\n    const attempts = yield* (yield* Effect.promise(\n      () => import("#modules/sign-in/03-domain/attempts.ts"),\n    )).Attempts;\n    return SignInWithPasskey.of({\n      execute: Effect.fn("SignInWithPasskey.execute")(function* (\n        attempt: PasskeyAttempt,\n      ) {\n        const { response } = attempt;\n        const challenge = webAuthn.challengeOf(\n          response.response.clientDataJSON,\n        );\n        if (Option.isNone(challenge)) return yield* new PasskeyRefused();\n        const issued = yield* challenges.take(challenge.value);\n        if (Option.isNone(issued) || issued.value.purpose !== "sign-in") {\n          return yield* new PasskeyRefused();\n        }\n        const passkey = yield* passkeys.findByCredentialId(\n          CredentialId.make(response.id),\n        );\n        if (Option.isNone(passkey)) return yield* new PasskeyRefused();\n        const verifying = webAuthn.verifySignIn({\n          response,\n          challenge: challenge.value,\n          passkey: passkey.value,\n          relyingParty: passkey.value.relyingParty,\n        });\n        const right = yield* attempts\n          .compare(Effect.map(verifying, Option.isSome))\n          .pipe(Effect.catchTag("TooManyAttempts", () => Effect.succeed(false)));\n        const counter = right ? yield* verifying : Option.none<number>();\n        if (Option.isNone(counter)) return yield* new PasskeyRefused();',
    killedBy: i7Passkeys,
  },
  {
    name: "a request that does not decode is answered without a problem",
    law: "H1",
    file: signInApi,
    find: "  .middleware(HttpApiMiddleware.ProblemDetails)\n",
    replace: "",
    killedBy:
      "H1: every answer of an endpoint is its declared success or a problem it declares, never a 500, whoever calls it with whatever body",
  },
  {
    name: "GET /api/me fails to encode its answer to a hub key",
    law: "H1",
    file: `${signIn}/01-presentation/sign-in.handlers.ts`,
    find: 'caller: "hub-key" as const,',
    replace: `caller: JSON.parse('"hub_key"') as "hub-key",`,
    killedBy:
      "H1: every answer of an endpoint is its declared success or a problem it declares, never a 500, whoever calls it with whatever body",
  },
  {
    name: "signing in answers 200 where the definition says 204",
    law: "H2",
    file: signInCookie,
    find: "HttpServerResponse.empty({ status: 204 })",
    replace: "HttpServerResponse.empty({ status: 200 })",
    killedBy:
      "H2: signs the owner in and tells them who they are, through the typed client",
  },
  {
    name: "the definition changes and the committed document does not",
    law: "H3",
    file: "apps/hub/src/api.ts",
    find: '.annotate(OpenApi.Title, "Cota hub")',
    replace: '.annotate(OpenApi.Title, "Cota")',
    killedBy:
      "H3: the committed openapi.json is the definition's OpenAPI document, which the hub serves to anyone",
  },
  {
    name: "a signed-in request from a sibling site may change things",
    file: access,
    find: 'const otherSites = ["cross-site", "same-site"];',
    replace: 'const otherSites = ["cross-site"];',
    killedBy:
      "refuses a signed-in request that changes something from another site, or a sibling one",
  },
  {
    name: "the cookie is Secure only when the hub's own URL is https",
    file: signInCookie,
    find: 'request.originalUrl.startsWith("https:") ||',
    replace: 'request.originalUrl.startsWith("https:") &&',
    killedBy:
      "marks the cookie Secure when the owner's reverse proxy says the request came over HTTPS",
  },
  {
    name: "a passkey sign-in from another site is looked at",
    law: "I9",
    file: signInHandlers,
    find: '          yield* refusedFromAnotherSite(request, "/api/sign-in/passkey");\n',
    replace: "",
    killedBy:
      "refuses a passkey sign-in from another site, or a sibling one, before it is looked at",
  },
  {
    name: "a sign-in from another site is looked at",
    law: "I9",
    file: `${signIn}/01-presentation/sign-in.handlers.ts`,
    find: "if (Access.fromAnotherSite(fetchSite)) {",
    replace: "if (Access.fromAnotherSite(undefined)) {",
    killedBy:
      "I9: a sign-in from another site, or a sibling one, is refused 403 before its password is looked at, and counts as no attempt",
  },
  {
    name: "a setup from another site is looked at",
    law: "I9",
    file: signInHandlers,
    find: '          yield* refusedFromAnotherSite(request, "/api/setup");\n',
    replace: "",
    killedBy:
      "I9: a setup from another site, or a sibling one, is refused 403 before its code is looked at, and counts as no attempt",
  },
  {
    name: "a body with no content type is read as JSON",
    law: "I10",
    file: "apps/hub/src/shared/01-presentation/json-body.middleware.ts",
    find: 'contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";',
    replace:
      '(contentType ?? "application/json").split(";")[0]?.trim().toLowerCase() === "application/json";',
    killedBy:
      "I10: a sign-in whose body has no content type, or another than JSON, is refused 415 before it is decoded, and counts as no attempt",
  },
  {
    name: "a chunked body is not looked at",
    law: "I10",
    file: "apps/hub/src/shared/01-presentation/json-body.middleware.ts",
    find: '  Number(headers["content-length"] ?? 0) > 0 ||\n  headers["transfer-encoding"] !== undefined;',
    replace: '  Number(headers["content-length"] ?? 0) > 0;',
    killedBy:
      "I10: every endpoint answers 415 to a request whose body is not said to be JSON, before it decodes anything",
  },
  {
    name: "the API takes bodies of 4 MiB",
    file: "apps/hub/src/shared/01-presentation/json-body.middleware.ts",
    find: "export const maxBodyBytes = 1024 * 1024;",
    replace: "export const maxBodyBytes = 4 * 1024 * 1024;",
    killedBy:
      "answers a body over 1 MiB with a 413 problem, and closes the connection",
  },
  {
    name: "a stale cookie hides the hub key sent beside it",
    file: "apps/hub/src/modules/sign-in/01-presentation/caller.middleware.ts",
    find: 'cotaKey: request.headers["x-cota-key"],',
    replace:
      'cotaKey: SignInCookie.tokensOf(request).length === 0 ? request.headers["x-cota-key"] : undefined,',
    killedBy: "takes the hub key beside a cookie the hub does not know",
  },
  {
    name: "the request inspector is opened to any hub key",
    law: "I2",
    file: `${requestLog}/01-presentation/requests.api.ts`,
    find: '  error: [NoSuchRequestProblem, RequestLogProblem],\n}).annotateMerge(mayCall("reader"));',
    replace:
      '  error: [NoSuchRequestProblem, RequestLogProblem],\n}).annotateMerge(mayCall("any-hub-key"));',
    killedBy:
      "I2: every endpoint but those anyone may call and those any hub key may call answers 403 to a subscription or keyed hub key",
  },
  {
    name: "giving a display name is opened to reader keys",
    law: "I3",
    file: "apps/hub/src/modules/display-names/01-presentation/display-names.api.ts",
    find: '  payload: Schema.Struct({ name: Name }),\n  success: DisplayName,\n}).annotateMerge(mayCall("owner"));',
    replace:
      '  payload: Schema.Struct({ name: Name }),\n  success: DisplayName,\n}).annotateMerge(mayCall("reader"));',
    killedBy:
      "I3: a reader key gets 403 from every endpoint kept for the owner",
  },
  {
    name: "only the first sign-in cookie is tried",
    file: "apps/hub/src/modules/sign-in/01-presentation/sign-in-cookie.ts",
    find: "    .slice(0, mostTried);",
    replace: "    .slice(0, 1);",
    killedBy:
      "opens the owner's sign-in behind cookies of the same name that a sibling site planted before it",
  },
  {
    name: "every sign-in cookie of a request is tried",
    file: "apps/hub/src/modules/sign-in/01-presentation/sign-in-cookie.ts",
    find: "    .slice(0, mostTried);",
    replace: "    .slice(0);",
    killedBy:
      "opens the owner's sign-in behind cookies of the same name that a sibling site planted before it",
  },
  {
    name: "a model listing is traffic",
    law: "H4",
    file: traffic,
    find: 'request.operation !== "models";',
    replace: 'request.operation !== "models" || true;',
    killedBy: h4,
  },
  {
    name: "ClickHouse counts model listings",
    law: "H9",
    file: reader,
    find: `const traffic = "operation != 'models'";`,
    replace: `const traffic = "1";`,
    killedBy: h9,
  },
  {
    name: "the overview counts the previous window as the window",
    law: "H5",
    file: `${requestLog}/02-application/queries/read-overview.query.ts`,
    find: "reader.overview(selection, previous)",
    replace: "reader.overview({ ...selection, window: previous }, previous)",
    killedBy: h5,
  },
  {
    name: "a breakdown in ClickHouse keeps two rows whatever its limit",
    law: "H5",
    file: reader,
    find: "GROUP BY key ORDER BY requests DESC, key LIMIT {limit:UInt32}",
    replace: "GROUP BY key ORDER BY requests DESC, key LIMIT 2",
    killedBy: `${h5}, in ClickHouse`,
  },
  {
    name: "the previous window ends where the window ends",
    law: "H6",
    file: traffic,
    find: "    window.from,\n    DateTime.distance(window.from, window.to),",
    replace: "    window.to,\n    DateTime.distance(window.from, window.to),",
    killedBy:
      "H6: the previous window ends where the window starts, and is as long",
  },
  {
    name: "a facet keeps its own dimension's filter",
    law: "H7",
    file: traffic,
    find: "      dimension === except ||",
    replace: "      false ||",
    killedBy: h7,
  },
  {
    name: "a facet in ClickHouse keeps its own dimension's filter",
    law: "H7",
    file: reader,
    find: "filtered(dimension)})`,",
    replace: "filtered()})`,",
    killedBy: `${h7}, in ClickHouse`,
  },
  {
    name: "weeks in ClickHouse start on a Thursday",
    law: "H9",
    file: reader,
    find: '"toDateTime(toMonday(started_at, {zone:String}), {zone:String})"',
    replace: '"toStartOfInterval(started_at, INTERVAL 7 DAY, {zone:String})"',
    killedBy: h9,
  },
  {
    name: "ClickHouse cuts an error's message at 500 bytes",
    law: "H9",
    file: reader,
    find: "substringUTF8(error_message, 1,",
    replace: "substring(error_message, 1,",
    killedBy: h9,
  },
  {
    name: "roles are read in the order the requests were given, not the session's",
    law: "T1",
    file: requestRole,
    find: "    .sort(byStart)\n",
    replace: "\n",
    killedBy: t1LatestFirst,
  },
  {
    name: "the client's subagent header gives way to structure",
    law: "T2",
    file: requestRole,
    find: 'return Option.some("subagent");',
    replace: "return Option.none();",
    killedBy: t2,
  },
  {
    name: "a purpose of main gives way to structure",
    law: "T2",
    file: requestRole,
    find: "if (said !== undefined) return Option.some(said);",
    replace:
      'if (said !== undefined && said !== "main") return Option.some(said);',
    killedBy: t2,
  },
  {
    name: "a title request is one whose schema requires a name",
    law: "T2",
    file: requestRole,
    find: 'required[0] === "title"',
    replace: 'required[0] === "name"',
    killedBy: t2,
  },
  {
    name: "every thread with tools is main",
    law: "T3",
    file: requestRole,
    find: "    Option.contains(\n      Option.flatMap(request.conversation, threadKeyOf),\n      main.key,\n    );",
    replace:
      "    Option.isSome(Option.flatMap(request.conversation, threadKeyOf));",
    killedBy:
      "T3: the requests that rule 6 makes main all have the same thread key",
  },
  {
    name: "the last segment is dropped",
    law: "T4",
    file: segment,
    find: "  return open.map(({ startedBy, requests }, index) => ({",
    replace:
      "  return open.slice(0, -1).map(({ startedBy, requests }, index) => ({",
    killedBy:
      "T4: the segments are non-empty runs of consecutive main requests, in order, and every main request is in exactly one",
  },
  {
    name: "a prompt of exactly half the previous one begins a segment",
    law: "T5",
    file: segment,
    find: "  2 * size < previous;",
    replace: "  2 * size <= previous;",
    killedBy: t5,
  },
  {
    name: "a failed request's prompt size cuts a segment",
    law: "T5",
    file: segment,
    find: 'request.outcome === "ok" ? request.promptSize : Option.none<number>();',
    replace: "request.promptSize;",
    killedBy: t5,
  },
  {
    name: "a segment compares each prompt with its first, not with the previous one",
    law: "T6",
    file: segment,
    find: "    if (Option.isSome(size)) current.sized = size;",
    replace: "    if (Option.isNone(current.sized)) current.sized = size;",
    killedBy:
      "T6: within a segment, no ok request with a prompt size but a compaction its client named has one under half of the previous such request's",
  },
  {
    name: "a compaction its client names begins no segment",
    law: "T5",
    file: segment,
    find: "    if (current === undefined || compacted || dropped) {",
    replace: "    if (current === undefined || dropped) {",
    killedBy: t5,
  },
  {
    name: "a compaction that did not end ok begins a segment",
    law: "T5",
    file: segment,
    find: '      before.outcome === "ok" &&\n',
    replace: "",
    killedBy: t5,
  },
  {
    name: "a forwarded request whose purpose says compaction begins a segment",
    law: "T5",
    file: segment,
    find: '  isRecordForm(request.protocol) && request.purpose === "compaction";',
    replace: '  request.purpose === "compaction";',
    killedBy: t5,
  },
  {
    name: "a named compaction's own call begins a segment by size, so one compaction begins two",
    law: "T5",
    file: segment,
    find: "      !namesCompaction(request) &&\n",
    replace: "",
    killedBy: t5,
  },
  {
    name: "a reported compaction's call is stored without its purpose",
    law: "L13",
    file: reportDomain,
    find: '      purpose: AntigravitySteps.isCompaction(checked.output)\n        ? "compaction"\n        : "",',
    replace: '      purpose: "",',
    killedBy: l13,
  },
  {
    name: "a reported request's purpose is not written to its columns",
    law: "L13",
    file: storedItems,
    find: "    purpose: origin.purpose,\n",
    replace: "",
    killedBy: reportedSegments,
  },
  {
    name: "a segment's tip is its last request, ok or not",
    law: "T7",
    file: segment,
    find: '    request.outcome === "ok" || tip.outcome !== "ok" ? request : tip,',
    replace: "    request,",
    killedBy:
      "T7: a segment's tip is its last ok request, or its last request when none is ok",
  },
  {
    name: "the sessions list passes over a session's report",
    law: "T8",
    file: listSessions,
    find: "              title: Title.shownOf(reported, generated),",
    replace: "              title: Title.shownOf(Option.none(), generated),",
    killedBy: t8,
  },
  {
    name: "an empty report does not clear the reported title",
    law: "T8",
    file: title,
    find: '  const reported = Option.filter(latest, ({ title }) => title !== "");',
    replace: "  const reported = latest;",
    killedBy: t8,
  },
  {
    name: "only the latest title request is tried",
    law: "T8",
    file: title,
    find: "    .reverse();",
    replace: "    .reverse()\n    .slice(0, 1);",
    killedBy: t8,
  },
  {
    name: "reports at the same instant are not told apart by machine",
    law: "T9",
    file: title,
    find: "  compareText(one.machine, other.machine) ||\n",
    replace: "",
    killedBy: t9,
  },
  {
    name: "ClickHouse keeps the earliest report's title",
    law: "T9",
    file: sessionTitles,
    find: "argMax(title, key) AS title",
    replace: "argMin(title, key) AS title",
    killedBy: `${t9}, in ClickHouse`,
  },
  {
    name: "the first prompt comes from the first request with a conversation, whatever its role",
    law: "T12",
    file: `${requestLog}/03-domain/first-prompt.ts`,
    find: '          requestRole === "main" && Option.isSome(request.conversation),',
    replace: "          Option.isSome(request.conversation),",
    killedBy: t12,
  },
  {
    name: "the first prompt is read from the first main request's output",
    law: "T12",
    file: listSessions,
    find: '                parts: ["input"],',
    replace: '                parts: ["output"],',
    killedBy: t12,
  },
  {
    name: "an Anthropic message whose content is empty gives no entry",
    law: "T10",
    file: `${transcripts}/anthropic-messages.ts`,
    find: "  return said.length > 0 ? said : [Transcript.message(role, [])];",
    replace: "  return said;",
    killedBy: t10,
  },
  {
    name: "an OpenAI Chat message with no content, reasoning or calls gives no entry",
    law: "T10",
    file: `${transcripts}/openai-chat.ts`,
    find: "  return said.length > 0 ? said : [Transcript.message(role, [])];",
    replace: "  return said;",
    killedBy: t10,
  },
  {
    name: "a transcript leaves out the output part",
    law: "T10",
    file: transcriptRules,
    find: "  for (const part of parts) {",
    replace: "  for (const part of parts.slice(0, 2)) {",
    killedBy: t10,
  },
  {
    name: "Codex reasoning is shown as its JSON",
    law: "T10",
    file: `${transcripts}/chatgpt-codex.ts`,
    find: '  if (type === "reasoning") return [reasoningOf(item)];',
    replace: '  if (type === "reasoning") return [Transcript.other(item)];',
    killedBy: t10Replayed,
  },
  {
    name: "a cut counts UTF-16 code units, not characters",
    law: "T11",
    file: transcriptRules,
    find: "    cut: points.length - length,",
    replace: "    cut: value.length - length,",
    killedBy: t11,
  },
  {
    name: "a tool call's cut input says nothing was left out",
    law: "T11",
    file: transcriptRules,
    find: "      return { ...said, input: kept, cut };",
    replace: "      return { ...said, input: kept, cut: 0 };",
    killedBy: t11,
  },
  {
    name: "a page of sessions comes in reverse",
    law: "H8",
    file: listSessions,
    find: "        const read = rows.map((row) => {",
    replace: "        const read = [...rows].reverse().map((row) => {",
    killedBy: h8,
  },
  {
    name: "a page of sessions in ClickHouse holds one more than its limit",
    law: "H9",
    file: reader,
    find: "LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
    replace: "LIMIT {limit:UInt32} + 1 OFFSET {offset:UInt32}",
    killedBy: h9,
  },
  {
    name: "the sessions list in ClickHouse counts model listings",
    law: "H9",
    file: reader,
    find: `WHERE \${traffic} AND session IN`,
    replace: "WHERE 1 AND session IN",
    killedBy: h9,
  },
  {
    name: "a session's total in ClickHouse is its own requests",
    law: "H9",
    file: reader,
    find: "count() OVER () AS total",
    replace: "count() AS total",
    killedBy: h9,
  },
  {
    name: "ClickHouse reads a request's last input item as its first",
    law: "H9",
    file: reader,
    find: "arraySlice(ri.input, 1, 1)",
    replace: "arraySlice(ri.input, -1, 1)",
    killedBy: h9,
  },
  {
    name: "ClickHouse lists a request's input types whether it has them or not",
    law: "H9",
    file: reader,
    find: "hasAny(ri.input, each.2)",
    replace: "1",
    killedBy: h9,
  },
  {
    name: "a select of the hub's own user runs on in ClickHouse after the hub stops waiting",
    file: clickHouseClient,
    find: '  readonly: "1",\n',
    replace: "",
    killedBy: abandoned,
  },
  {
    name: "ClickHouse lets a select of the hub's own user run past 30 seconds",
    file: clickHouseClient,
    find: "  max_execution_time: String(Duration.toSeconds(longestQuery)),\n",
    replace: "",
    killedBy: overTime,
  },
  {
    name: "ClickHouse begins its answer to a select of the hub's own user before the query has ended",
    file: clickHouseClient,
    find: '  http_wait_end_of_query: "1",\n',
    replace: "",
    killedBy: failsLate,
  },
  {
    name: "a select ClickHouse stopped at its time limit answers as a failed query",
    file: reader,
    find: "error.status === 0 || error.code === timeoutExceeded",
    replace: "error.status === 0",
    killedBy: overTime,
  },
  {
    name: "ClickHouse gives a request's parts asked for under another session, or for another request",
    law: "H9",
    file: reader,
    find: "(session, toString(request_id), each.1)",
    replace:
      "(session, toString(request_id), each.1) OR each.1 IN {parts:Array(String)}",
    killedBy: h9,
  },
  {
    name: "ClickHouse gives a request's items in the order of their digests",
    law: "H9",
    file: reader,
    find: "ORDER BY request, part, w.position",
    replace: "ORDER BY request, part, w.digest",
    killedBy: h9,
  },
  {
    name: "ClickHouse reads every request of a session for the role rules, not its latest",
    law: "H9",
    file: reader,
    find: "     LIMIT {limit:UInt32} BY session\n",
    replace: "",
    killedBy: h9,
  },
  {
    name: "the session detail reads the role rules over one request more than its latest 10,000",
    file: readSession,
    find: "            Session.mostListedRequests,\n          )).get(",
    replace: "            Session.mostListedRequests + 1,\n          )).get(",
    killedBy: pastTheCap,
  },
  {
    name: "the sessions list reads the role rules over one request more than its latest 10,000",
    file: listSessions,
    find: "          Session.mostListedRequests,\n        );",
    replace: "          Session.mostListedRequests + 1,\n        );",
    killedBy: pastTheCap,
  },
  {
    name: "the inspector reads the role rules over one request more than its session's latest 10,000",
    file: inspectRequest,
    find: "            Session.mostListedRequests,\n          )).get(",
    replace: "            Session.mostListedRequests + 1,\n          )).get(",
    killedBy: pastTheCap,
  },
  {
    name: "the inspector calls a request older than its session's latest 10,000 a utility request",
    file: inspectRequest,
    find: ": Traffic.isTraffic(record.request)",
    replace: ": !Traffic.isTraffic(record.request)",
    killedBy: pastTheCap,
  },
  {
    name: "ClickHouse lists a session's oldest requests, not its latest",
    law: "H9",
    file: reader,
    find: "ORDER BY started_at DESC, toString(id) DESC\n   LIMIT {limit:UInt32}`;",
    replace: "ORDER BY started_at, toString(id)\n   LIMIT {limit:UInt32}`;",
    killedBy: h9,
  },
  {
    name: "ClickHouse counts none of a session's requests",
    law: "H9",
    file: reader,
    find: "count() OVER () AS session_requests",
    replace: "toUInt64(0) AS session_requests",
    killedBy: h9,
  },
  {
    name: "ClickHouse says a request is followed by itself",
    law: "H9",
    file: reader,
    find: "argMin(toString(id), (started_at, toString(id)))",
    replace: "argMin(toString(follows), (started_at, toString(id)))",
    killedBy: h9,
  },
  {
    name: "a reported title is kept as sent",
    file: `${requestLog}/02-application/commands/report-session-titles.command.ts`,
    find: "              title: Title.keptOf(title),",
    replace: "              title,",
    killedBy: sessionsContract,
  },
  {
    name: "a reported session is kept with its lone surrogates",
    file: `${requestLog}/02-application/commands/report-session-titles.command.ts`,
    find: "              session: session.toWellFormed(),",
    replace: "              session,",
    killedBy: reportedTitleWellFormed,
  },
  {
    name: "a title is kept with its lone surrogates",
    file: title,
    find: "  cut(text.toWellFormed().trim(), longest);",
    replace: "  cut(text.trim(), longest);",
    killedBy: reportedTitleWellFormed,
  },
  {
    name: "a display name is kept with its lone surrogates",
    file: `${displayNames}/02-application/commands/set-display-name.command.ts`,
    find: "name: given.name.toWellFormed() }",
    replace: "name: given.name }",
    killedBy:
      "keeps a name that holds a lone surrogate with U+FFFD in its place, and the characters around it as they were",
  },
  {
    name: "an item matches when any word of the search query is among its words",
    law: "K1",
    file: search,
    find: "  return wordsOf(query).every((word) => words.has(word));",
    replace: "  return wordsOf(query).some((word) => words.has(word));",
    killedBy: k1,
  },
  {
    name: "an underscore joins two words into one",
    law: "K2",
    file: search,
    find: "  point > 0x7f ||",
    replace: "  point > 0x7f ||\n  point === 0x5f ||",
    killedBy: `${k2}, for fetch in fetch_user_id`,
  },
  {
    name: "search reads the window but not the filters",
    law: "K3",
    file: searchItems,
    find: "          { window: from.window, filters: asked.filters },",
    replace: "          { window: from.window, filters: Traffic.noFilters },",
    killedBy: k3,
  },
  {
    name: "ClickHouse searches the items of every session, selected or not",
    law: "K3",
    file: reader,
    find: `hitsIn(\`session IN (\${selectedSessions})\`)`,
    replace: 'hitsIn("1")',
    killedBy: k3InClickHouse,
  },
  {
    name: "the next page begins after the hit past the page, not after its last",
    law: "K4",
    file: searchItems,
    find: "              ? Option.some(Search.cursorOf(key, from.window, last))",
    replace:
      "              ? Option.some(Search.cursorOf(key, from.window, read[limit] ?? last))",
    killedBy: k4,
  },
  {
    name: "a word ended by punctuation or a space keeps its capitals",
    law: "K5",
    file: search,
    find: "      placed.push({ word: word.toLowerCase(), at: start });",
    replace: "      placed.push({ word, at: start });",
    killedBy: k5,
  },
  {
    name: "DEL is taken for a letter, not a separator",
    law: "K6",
    file: search,
    find: "  point > 0x7f ||",
    replace: "  point >= 0x7f ||",
    killedBy: k6,
  },
  {
    name: "the text index lowercases the text before splitting it, which a scan does not",
    law: "K7",
    file: schema,
    find: "postprocessor = lowerUTF8(text)",
    replace: "preprocessor = lowerUTF8(text)",
    killedBy: k7,
  },
  {
    name: "a merge of items keeps an item's copy last written, not its earliest",
    law: "K8",
    file: schema,
    find: 'const itemsEngine = "ReplacingMergeTree(version)";',
    replace: 'const itemsEngine = "ReplacingMergeTree";',
    killedBy: k8,
  },
  {
    name: "prepare says nothing of an items table made without its version",
    file: schema,
    find: "!table.engine_full.startsWith(itemsEngine)",
    replace: "false",
    killedBy:
      "says in one log line, every time it prepares, that an items table made without its version keeps an item's latest copy, and leaves the table as it is",
  },
  {
    name: "a hit in ClickHouse names the latest request that carried its item",
    law: "K8",
    file: reader,
    find: "argMin(toString(request_id), (first_seen, toString(request_id))) AS request",
    replace:
      "argMax(toString(request_id), (first_seen, toString(request_id))) AS request",
    killedBy: k8,
  },
  {
    name: "a larger fuzziness widens a word to the neighbours of its most edits only",
    law: "K9",
    file: search,
    find: "if (distance <= edits) neighbours.push",
    replace: "if (distance === edits) neighbours.push",
    killedBy: k9,
  },
  {
    name: "the in-memory reader widens a word to one completion past the bound",
    law: "K10",
    file: search,
    find: ".slice(0, bounded.completions)",
    replace: ".slice(0, bounded.completions + 1)",
    killedBy: k10,
  },
  {
    name: "ClickHouse widens a word to its first completions by text, not by length",
    law: "K10",
    file: reader,
    find: "ORDER BY lengthUTF8(word), word",
    replace: "ORDER BY word",
    killedBy: k10InClickHouse,
  },
  {
    name: "ClickHouse passes over a neighbour whose characters differ by as many as its edits allow twice",
    law: "K10",
    file: reader,
    find: "<= 2 * {k",
    replace: "<= {k",
    killedBy: k10InClickHouse,
  },
  {
    name: "the hub counts a character replaced as two edits",
    law: "K11",
    file: search,
    find: "(character === target ? 0 : 1)",
    replace: "(character === target ? 0 : 2)",
    killedBy: k11,
  },
  {
    name: "a fuzziness's edits are rounded down, not halves up",
    file: search,
    find: "Math.min(mostEdits, Math.round(",
    replace: "Math.min(mostEdits, Math.floor(",
    killedBy:
      "allows a query word round(length × fuzzy) edits, halves up, at most two: at 0.2, none to 1 or 2 characters, one to 3 to 7, two from 8",
  },
  {
    name: "ClickHouse orders hits of the same instant by session, last first",
    law: "H9",
    file: reader,
    find: 'const hitOrder = "ORDER BY at DESC, session, toUInt128(item)";',
    replace:
      'const hitOrder = "ORDER BY at DESC, session DESC, toUInt128(item)";',
    killedBy: h9,
  },
  {
    name: "ClickHouse begins the next page of hits at the last hit of the page",
    law: "H9",
    file: reader,
    find: "(-at_millis, session, toUInt128(item)) > (",
    replace: "(-at_millis, session, toUInt128(item)) >= (",
    killedBy: h9,
  },
  {
    name: "ClickHouse gives a session's two newest hits, the older kept",
    law: "H9",
    file: reader,
    find: "  LIMIT 1 BY session`;",
    replace: "  LIMIT 2 BY session`;",
    killedBy: h9,
  },
  {
    name: "ClickHouse gives an item's content for every session asked, its own or not",
    law: "H9",
    file: reader,
    find: "    AND has(arrayZip({sessions:Array(String)}, {items:Array(UInt128)}), (session, digest))\n",
    replace: "",
    killedBy: h9,
  },
  {
    name: "a searched sessions list in ClickHouse holds sessions outside the window",
    law: "H9",
    file: reader,
    find: `FROM items WHERE session IN (\${selectedSessions}) AND`,
    replace: "FROM items WHERE",
    killedBy: h9,
  },
  {
    name: "SQL runs as the hub's own ClickHouse user",
    law: "X1",
    file: sqlConsole,
    find: "return now.sql;",
    replace: "return hub;",
    killedBy: x1,
  },
  {
    name: "the SQL user's profile lets a query change its settings",
    law: "X2",
    file: sqlConsole,
    find: '["readonly", "1"],',
    replace: '["readonly", "2"],',
    killedBy: x2,
  },
  {
    name: "the SQL user may read every database",
    law: "X3",
    file: sqlConsole,
    find: `GRANT SELECT ON \${backquoted(hub.database)}.* TO`,
    replace: "GRANT SELECT ON *.* TO",
    killedBy: x3,
  },
  {
    name: "an answer keeps a 5,001st row",
    law: "X4",
    file: sqlDomain,
    find: "kept.rows < limits.rows",
    replace: "kept.rows <= limits.rows",
    killedBy: x4,
  },
  {
    name: "an answer leaves out a row that fills 16 MiB exactly",
    law: "X4",
    file: sqlDomain,
    find: "kept.bytes + bytes <= limits.rowBytes",
    replace: "kept.bytes + bytes < limits.rowBytes",
    killedBy: x4,
  },
  {
    name: "an answer that stops in a row too long to keep is not truncated",
    law: "X5",
    file: sqlAnswer,
    find: "    truncated = true;\n    return false;\n",
    replace: "    return false;\n",
    killedBy: x5,
  },
  {
    name: "the SQL user's grants are not checked",
    law: "X6",
    file: sqlConsole,
    find: "if (granted.length !== 1 || granted[0] !== only) {",
    replace: "if (granted.length === 0) {",
    killedBy: x6,
  },
  {
    name: "a setting missing from the SQL user's is taken for the profile's",
    law: "X6",
    file: sqlConsole,
    find: "return found === wanted\n",
    replace: "return found === wanted || found === undefined\n",
    killedBy: x6,
  },
  {
    name: "an answer in a format the query named is read as the hub's own",
    file: sqlConsole,
    find: 'streamed.format !== "" &&',
    replace: "false &&",
    killedBy:
      "answers a query that names its own format as format-not-allowed, and one that names the hub's own as any other",
  },
  {
    name: "the SQL user's answers are sent as ClickHouse makes them",
    file: sqlConsole,
    find: '  ["http_response_buffer_size", String(answerBufferOf(limits))],\n',
    replace: "",
    killedBy:
      "has ClickHouse hold the SQL user's answer until it is longer than the hub reads, or the query ends",
  },
  {
    name: "the SQL user's time limit is the default, whatever the owner set",
    file: sqlConsole,
    find: '["max_execution_time", String(Duration.toSeconds(limits.queryTime))],',
    replace: '["max_execution_time", "30"],',
    killedBy: startedAgain,
  },
  {
    name: "the SQL user's memory limit is the default, whatever the owner set",
    file: sqlConsole,
    find: '["max_memory_usage", String(limits.memoryBytes)],',
    replace: '["max_memory_usage", "4000000000"],',
    killedBy: startedAgain,
  },
  {
    name: "the SQL user's threads are the default, whatever the owner set",
    file: sqlConsole,
    find: '["max_threads", String(limits.threads)],',
    replace: '["max_threads", "4"],',
    killedBy: startedAgain,
  },
  {
    name: "the SQL user's queries at once are the default, whatever the owner set",
    file: sqlConsole,
    find: '["max_concurrent_queries_for_user", String(limits.concurrentQueries)],',
    replace: '["max_concurrent_queries_for_user", "4"],',
    killedBy: startedAgain,
  },
  {
    name: "ClickHouse's row limit for the SQL user is the default, whatever the owner set",
    file: sqlConsole,
    find: '["max_result_rows", String(limits.rows + 1)],',
    replace: '["max_result_rows", "5001"],',
    killedBy: startedAgain,
  },
  {
    name: "ClickHouse holds back an answer by the default size, whatever the owner set",
    file: sqlConsole,
    find: "3 * limits.rowBytes + 1024 * 1024",
    replace: "3 * 16 * 1024 * 1024 + 1024 * 1024",
    killedBy: startedAgain,
  },
  {
    name: "the SQL console reads answers within the default caps, whatever the owner set",
    file: sqlConsole,
    find: "streamed.exceptionTag,\n              limits,",
    replace:
      "streamed.exceptionTag,\n              { ...limits, rows: 5000, rowBytes: 16 * 1024 * 1024 },",
    killedBy: ownersLimits,
  },
  {
    name: "the hub waits 35 seconds for an answer, whatever the query's time",
    file: sqlConsole,
    find: "Duration.sum(limits.queryTime, Duration.seconds(5))",
    replace: "Duration.seconds(35)",
    killedBy:
      "waits for an answer five seconds past the query's time, then answers that ClickHouse did not finish",
  },
  {
    name: "the line reader keeps rows within the default caps, whatever limits it is given",
    law: "X4",
    file: sqlAnswer,
    find: "if (!Sql.fits(limits, kept, bytes.length)) {",
    replace: "if (!Sql.fits(Sql.defaults, kept, bytes.length)) {",
    killedBy:
      "X4: with any limits, the line reader keeps the longest prefix of rows within them, and reads at most the caps and two chunks",
  },
  {
    name: "[sql] max_query_time is ignored",
    file: config,
    find: "queryTime: sql?.max_query_time ?? Sql.defaults.queryTime,",
    replace: "queryTime: Sql.defaults.queryTime,",
    killedBy: sqlFromConfig,
  },
  {
    name: "[sql] max_memory_bytes is ignored",
    file: config,
    find: "memoryBytes: sql?.max_memory_bytes ?? Sql.defaults.memoryBytes,",
    replace: "memoryBytes: Sql.defaults.memoryBytes,",
    killedBy: sqlFromConfig,
  },
  {
    name: "[sql] max_threads is ignored",
    file: config,
    find: "threads: sql?.max_threads ?? Sql.defaults.threads,",
    replace: "threads: Sql.defaults.threads,",
    killedBy: sqlFromConfig,
  },
  {
    name: "[sql] max_concurrent_queries is ignored",
    file: config,
    find: "sql?.max_concurrent_queries ?? Sql.defaults.concurrentQueries,",
    replace: "Sql.defaults.concurrentQueries,",
    killedBy: sqlFromConfig,
  },
  {
    name: "[sql] max_answer_rows is ignored",
    file: config,
    find: "rows: sql?.max_answer_rows ?? Sql.defaults.rows,",
    replace: "rows: Sql.defaults.rows,",
    killedBy: sqlFromConfig,
  },
  {
    name: "[sql] max_answer_mib is ignored",
    file: config,
    find: ": sql.max_answer_mib * mebibyte,",
    replace: ": Sql.defaults.rowBytes,",
    killedBy: sqlFromConfig,
  },
  {
    name: "a query time over 10 minutes is taken",
    file: config,
    find: "millis <= Duration.toMillis(longestQueryTime)) ||",
    replace: "true) ||",
    killedBy: sqlBounds,
  },
  {
    name: "an answer size over 256 MiB is taken",
    file: config,
    find: "max_answer_mib: Schema.optionalKey(between(1, 256)),",
    replace: "max_answer_mib: Schema.optionalKey(between(1, 100_000)),",
    killedBy: sqlBounds,
  },
  {
    name: "an exception after rows keeps its length and tag",
    file: clickHouseClient,
    find: '.replace(/\\n\\d+$/, "")',
    replace: "",
    killedBy:
      "fails with ClickHouse's message, without its version, when an exception follows rows",
  },
  {
    name: "a second name for a key is ignored, so the first set wins",
    law: "D1",
    file: sqliteDisplayNames,
    find: "ON CONFLICT (kind, key) DO UPDATE SET name = excluded.name, set_at = excluded.set_at",
    replace: "ON CONFLICT (kind, key) DO NOTHING",
    killedBy:
      "D1: a key's owner name is the one last set, for a key named twice, in memory and in SQLite",
  },
  {
    name: "removing a name removes every name of its kind",
    law: "D1",
    file: sqliteDisplayNames,
    find: '"DELETE FROM display_names WHERE kind = ? AND key = ?"',
    replace: '"DELETE FROM display_names WHERE kind = ? AND ? IS NOT NULL"',
    killedBy:
      "D1: removing a key's owner name leaves the other names of its kind, and a name equal to its key removes the owner's, in memory and in SQLite",
  },
  {
    name: "a name equal to its key is kept as the owner's name",
    law: "D1",
    file: displayName,
    find: "boolean => name.name === name.key;",
    replace: "boolean => false;",
    killedBy:
      "D1: removing a key's owner name leaves the other names of its kind, and a name equal to its key removes the owner's, in memory and in SQLite",
  },
  {
    name: "an owner name hides the built-in names of every key of its kind",
    law: "D2",
    file: displayName,
    find: "one.kind === other.kind && one.key === other.key;",
    replace: "one.kind === other.kind;",
    killedBy:
      "D2: a model keeps its built-in name while another model has an owner name",
  },
  {
    name: "setting a display name writes it over the sign-ins' user agents",
    law: "D3",
    file: sqliteDisplayNames,
    find: ".run(name.kind, name.key, name.name, DateTime.formatIso(at));",
    replace:
      '.run(name.kind, name.key, name.name, DateTime.formatIso(at));\n            database.query("UPDATE sign_ins SET user_agent = ?").run(name.name);',
    killedBy:
      "D3: setting or removing display names changes no answer of any reading endpoint but GET /api/display-names and GET /api/machine",
  },
  {
    name: "an owner name is listed beside the built-in name it replaces",
    law: "D4",
    file: displayName,
    find: "...builtIn.filter((name) => !owner.some((each) => sameKey(each, name))),",
    replace: "...builtIn,",
    killedBy: "D4: a model with an owner name is listed once, under that name",
  },
  {
    name: "a length in characters is counted in UTF-16 code units",
    file: "apps/hub/src/shared/03-domain/text.ts",
    find: "export const charactersOf = (text: string): number => [...text].length;",
    replace:
      "export const charactersOf = (text: string): number => text.length;",
    killedBy: keysInPaths,
  },
  {
    name: "a filter value's length is counted in UTF-16 code units",
    file: `${requestLog}/01-presentation/filters.ts`,
    find: "const Value = Schema.String.check(isCharactersBetween(0, 255));",
    replace: "const Value = Schema.String.check(Schema.isMaxLength(255));",
    killedBy:
      "counts a filter value's characters, not its UTF-16 units: 255 crabs are a value, 256 are a 400",
  },
  {
    name: "the router's own limit on a path parameter's length holds",
    file: "apps/hub/src/hub.ts",
    find: "routerConfig: { maxParamLength: Number.MAX_SAFE_INTEGER },",
    replace: "",
    killedBy: keysInPaths,
  },
  {
    name: "a name is kept untrimmed",
    file: displayName,
    find: "export const Name = Schema.Trim.check(",
    replace: "export const Name = Schema.String.check(",
    killedBy:
      "sets the owner's name, trimmed, in place of a built-in one, replaces it, and shows the built-in name again once it is removed",
  },
  {
    name: "a key of any length is taken",
    file: displayName,
    find: "export const Key = Schema.String.check(\n  isCharactersBetween(1, limits.longestKey),\n);",
    replace: "export const Key = Schema.String;",
    killedBy:
      "refuses with a 400 a name empty once trimmed or over 80 characters, a key over 255 characters, and a kind it does not know",
  },
  {
    name: "removing a name the owner never gave answers 204",
    file: `${displayNames}/02-application/commands/remove-display-name.command.ts`,
    find: "if (!(yield* repository.remove(kind, key))) {",
    replace:
      "if (!(yield* repository.remove(kind, key)) && kind === undefined) {",
    killedBy:
      "sets the owner's name, trimmed, in place of a built-in one, replaces it, and shows the built-in name again once it is removed",
  },
  {
    name: "a name equal to its key answers the key, never the built-in name",
    file: `${displayNames}/02-application/commands/set-display-name.command.ts`,
    find: "builtIn.of(name.kind, name.key),",
    replace: "Option.none(),",
    killedBy:
      "takes a name equal to its key, once trimmed, as removing the owner's name, and answers the built-in name, or the key itself",
  },
  {
    name: "headers observed at the same instant as the reading win the tie",
    law: "W1",
    file: sources,
    find: "DateTime.isGreaterThan(window.observedAt, held.observedAt)",
    replace:
      "DateTime.isGreaterThanOrEqualTo(window.observedAt, held.observedAt)",
    killedBy: w1Fixed,
  },
  {
    name: "the first current observation of a scope and length wins, not the latest",
    law: "W1",
    file: sources,
    find: "DateTime.isGreaterThan(window.observedAt, held.observedAt)",
    replace: "false",
    killedBy: w1,
  },
  {
    name: "quota headers are read back only 48 hours",
    law: "W1",
    file: readPools,
    find: "DateTime.subtractDuration(now, Sources.headersFor)",
    replace: "DateTime.subtract(now, { hours: 48 })",
    killedBy: w1OverTheLog,
  },
  {
    name: "a percentage over 100 or under 0 is answered unclamped",
    law: "W2",
    file: quotaHeaders,
    find: "(percentage) => Math.min(100, Math.max(0, percentage)),",
    replace: "(percentage) => percentage,",
    killedBy: w2OverTheLog,
  },
  {
    name: "a fraction is answered as given, and a percentage as a fraction",
    law: "W2",
    file: quotaHeaders,
    find: "rule.fraction ?",
    replace: "!rule.fraction ?",
    killedBy: w2OverTheLog,
  },
  {
    name: "a window that resets at the answer's time is answered",
    law: "W4",
    file: sources,
    find: "DateTime.isGreaterThan(window.span.reset, now)",
    replace: "DateTime.isGreaterThanOrEqualTo(window.span.reset, now)",
    killedBy: w4Fixed,
  },
  {
    name: "a window without a reset observed exactly its length ago is answered",
    law: "W4",
    file: sources,
    find: "DateTime.toEpochMillis(window.observedAt) <\n",
    replace: "DateTime.toEpochMillis(window.observedAt) <=\n",
    killedBy: w4Fixed,
  },
  {
    name: "a pool's windows are read from every pool's quota headers",
    law: "W5",
    file: readPools,
    find: ".filter((each) => each.pool === pool.id)",
    replace: ".filter(() => true)",
    killedBy: w5,
  },
  {
    name: "Codex's secondary window takes the primary window's minutes",
    law: "W5",
    file: quotaHeaders,
    find: "minutesIn(`x-codex-",
    replace:
      'minutesIn(which === "secondary" ? "x-codex-primary-window-minutes" : `x-codex-',
    killedBy: w5,
  },
  {
    name: "every window of a pool stands as its first does",
    law: "W6",
    file: readPools,
    find: "standing: yield* Quota.standing(window)",
    replace: "standing: yield* Quota.standing(quota.windows[0] ?? window)",
    killedBy: w6,
  },
  {
    name: "ClickHouse reads a pool's quota headers from its earliest answer that holds the name",
    law: "H9",
    file: reader,
    find: "argMax(rate_limits, (started_at, toString(id))) AS headers",
    replace: "argMin(rate_limits, (started_at, toString(id))) AS headers",
    killedBy: h9Quota,
  },
  {
    name: "ClickHouse reads quota headers of names no one asked for",
    law: "H9",
    file: reader,
    find: "AND has(arrayZip({pools:Array(String)}, {names:Array(String)}), (toString(pool), toString(name)))",
    replace: "",
    killedBy: h9Quota,
  },
  {
    name: "the pools are answered in the configuration's order, not by id",
    law: "W7",
    file: readPools,
    find: "const ordered = [...HashMap.values(pools)].sort((one, other) =>\n        compareText(one.id, other.id),\n      );",
    replace: "const ordered = [...HashMap.values(pools)];",
    killedBy: w7,
  },
  {
    name: "a pool no quota headers report on is left out",
    law: "W7",
    file: readPools,
    find: "for (const [index, pool] of ordered.entries()) {",
    replace:
      "for (const [index, pool] of [...ordered.entries()].filter(([, { id }]) => latest.some((each) => each.pool === id))) {",
    killedBy: w7,
  },
  {
    name: "a window in reserve is answered as ahead of pace",
    file: `${quotaModule}/01-presentation/pools.handlers.ts`,
    find: 'case "InReserve":\n      return "in-reserve";',
    replace: 'case "InReserve":\n      return "ahead-of-pace";',
    killedBy: poolsAnswered,
  },
  {
    name: "a window's observation time is answered as its reset",
    file: `${quotaModule}/01-presentation/pools.handlers.ts`,
    find: "observedAt: window.observedAt,",
    replace: "observedAt: window.span?.reset ?? window.observedAt,",
    killedBy: poolsAnswered,
  },
  {
    name: "a window as long as a number the hub cannot hold exactly is a window",
    law: "H1",
    file: quota,
    find: "Number.isSafeInteger(ms) && ms > 0",
    replace: "Number.isFinite(ms) && ms > 0",
    killedBy: hugeWindow,
  },
  {
    name: "an ask while a read of the pool runs starts another read",
    law: "U1",
    file: readings,
    find: "if (Option.isSome(entry.running)) {",
    replace: "if (Option.isSome(entry.running) && entry.failures < 0) {",
    killedBy: u1,
  },
  {
    name: "an ask while a read runs answers what is kept without waiting for it",
    law: "U1",
    file: readings,
    find: "return [Effect.asSome(entry.running.value.start), map] as const;",
    replace: "return [Effect.succeedNone, map] as const;",
    killedBy: u1Fixed,
  },
  {
    name: "a read is abandoned when every asker stops waiting for it",
    law: "U2",
    file: readings,
    find: "Effect.forkIn(run(pool, period, read, token), scope),",
    replace: "Effect.forkChild(run(pool, period, read, token)),",
    killedBy: abandonedAsks,
  },
  {
    name: "a read is cut when one of its askers stops waiting",
    law: "U2",
    file: readings,
    find: "if (Option.isSome(running)) yield* Fiber.join(running.value);",
    replace:
      "if (Option.isSome(running)) yield* Fiber.join(running.value).pipe(Effect.onInterrupt(() => Fiber.interrupt(running.value)));",
    killedBy: logFailsWhileRead,
  },
  {
    name: "a pool is read again only after its next read's time, not at it",
    law: "U2",
    file: readings,
    find: "onSome: (nextAt) => DateTime.isGreaterThanOrEqualTo(now, nextAt),",
    replace: "onSome: (nextAt) => DateTime.isGreaterThan(now, nextAt),",
    killedBy: u2Fixed,
  },
  {
    name: "a good reading is read again at once, without waiting its period",
    law: "U2",
    file: readings,
    find: "nextAt: Option.some(DateTime.addDuration(at, period)),",
    replace: "nextAt: Option.some(at),",
    killedBy: u2,
  },
  {
    name: "the wait after failed reads does not double",
    law: "U3",
    file: readings,
    find: "Duration.times(period, 2 ** (failures - 1))",
    replace: "Duration.times(period, 1)",
    killedBy: u3,
  },
  {
    name: "the wait after failed reads is not capped at 15 minutes",
    law: "U3",
    file: readings,
    find: "Duration.min(Duration.times(period, 2 ** (failures - 1)), longestBackoff)",
    replace: "Duration.times(period, 2 ** (failures - 1))",
    killedBy: u3Waits,
  },
  {
    name: "a 429's retry-after is not honoured",
    law: "U3",
    file: readings,
    find: "onSome: (retryAt) => DateTime.max(waited, retryAt),",
    replace: "onSome: () => waited,",
    killedBy: u3RetryAfter,
  },
  {
    name: "a good reading does not end the run of failures",
    law: "U3",
    file: readings,
    find: "  failures: 0,\n  nextAt: Option.some(DateTime.addDuration(at, period)),",
    replace:
      "  failures: 1,\n  nextAt: Option.some(DateTime.addDuration(at, period)),",
    killedBy: u3,
  },
  {
    name: "a failed read forgets the last good reading",
    law: "U4",
    file: readings,
    find: "last: entry.last,",
    replace: "last: Option.none(),",
    killedBy: u4,
  },
  {
    name: "a failed read keeps the first failure since the reading, not the latest",
    law: "U4",
    file: readings,
    find: "failure: Option.some({ failure, at }),",
    replace:
      "failure: Option.orElse(entry.failure, () => Option.some({ failure, at })),",
    killedBy: u4,
  },
  {
    name: "an expired quota login keeps the pool's state",
    law: "U4",
    file: readings,
    find: 'if (outcome.failure._tag === "QuotaLoginExpired") return empty;',
    replace:
      'if (outcome.failure._tag === "QuotaLoginExpired") return { ...entry, running: Option.none() };',
    killedBy: u4Fixed,
  },
  {
    name: "a retry-after is read as any date the runtime can parse",
    law: "U3",
    file: usageEndpoint,
    find: "if (!imfFixdate.test(trimmed)) return Option.none();",
    replace: 'if (trimmed === "") return Option.none();',
    killedBy: retryAfterRead,
  },
  {
    name: "a retry-after in seconds is honoured however far ahead",
    law: "U3",
    file: usageEndpoint,
    find: "Duration.min(Duration.seconds(Number(trimmed)), longestRetry),",
    replace: "Duration.seconds(Number(trimmed)),",
    killedBy: retryAfterRead,
  },
  {
    name: "a retry-after date is honoured however far ahead",
    law: "U3",
    file: usageEndpoint,
    find: "(at) => DateTime.min(at, latest)",
    replace: "(at) => at",
    killedBy: retryAfterRead,
  },
  {
    name: "an answer that gives no window is a reading without windows",
    law: "U5",
    file: usageEndpoint,
    find: "if (reading.success.windows.length === 0) {",
    replace: "if (reading.success.windows.length < 0) {",
    killedBy: u5NoWindow,
  },
  {
    name: "a Z.ai entry is read without decoding it",
    law: "U5",
    file: zaiReader,
    find: "const entry = ProviderCall.decodeAt(Entry, value, at);",
    replace: "const entry = Result.succeed(value as Entry);",
    killedBy: u5,
  },
  {
    name: "an OpenCode Go reset that is a date without a time gives a window",
    law: "U5",
    file: openCodeGoReader,
    find: "Schema.Struct({ percent: Schema.Finite, resetsAt: Schema.NullOr(Instant) }),",
    replace:
      "Schema.Struct({ percent: Schema.Finite, resetsAt: Schema.NullOr(Schema.DateTimeUtcFromString) }),",
    killedBy: u5Each,
  },
  {
    name: "Z.ai's exact counts lose to its rounded percentage",
    law: "U5",
    file: zaiReader,
    find: 'typeof entry.usage === "number" &&\n    entry.usage > 0 &&',
    replace: 'typeof entry.usage === "number" &&\n    entry.usage < 0 &&',
    killedBy: u5Fixtures,
  },
  {
    name: "Z.ai's reset is read as Unix seconds, not milliseconds",
    law: "U5",
    file: zaiReader,
    find: "resetMs: Option.fromNullishOr(entry.success.nextResetTime),",
    replace:
      "resetMs: Option.map(Option.fromNullishOr(entry.success.nextResetTime), (time) => time * 1000),",
    killedBy: u5Fixtures,
  },
  {
    name: "a usage call traces the ChatGPT account id in plain text",
    law: "G1",
    file: usageEndpoint,
    find: "      ...Object.keys(call.headers ?? {}),\n",
    replace: "",
    killedBy:
      "names the account id in no span attribute, as it names the access token in none, even when the client records headers",
  },
  {
    name: "a usage call sends the client library's user agent",
    law: "U6",
    file: usageEndpoint,
    find: 'HttpClientRequest.setHeader("user-agent", userAgent),',
    replace: 'HttpClientRequest.setHeader("x-user-agent", userAgent),',
    killedBy: u6,
  },
  {
    name: "a usage call is abandoned only after 30 seconds",
    law: "U6",
    file: providerCall,
    find: "export const longestCall = Duration.seconds(10);",
    replace: "export const longestCall = Duration.seconds(30);",
    killedBy: u6,
  },
  {
    name: "a pool's quota reading is not given to its windows",
    file: readPools,
    find: "reading: Option.flatMap(reading, ({ last }) =>",
    replace:
      "reading: Option.flatMap(Option.none<Readings.Kept>(), ({ last }) =>",
    killedBy: poolsAnswered,
  },
  {
    name: "a pool's failed read is answered without its failure",
    file: `${quotaModule}/01-presentation/pools.handlers.ts`,
    find: "Option.map(kept.failure, ({ failure, at }) => ({",
    replace:
      "Option.map(Option.none<Readings.Failed>(), ({ failure, at }) => ({",
    killedBy: readingKept,
  },
  {
    name: "a refresh asked for while one of the same login runs starts another",
    law: "G3",
    file: `${quotaModule}/03-domain/refreshes.ts`,
    find: "if (Option.isSome(entry)) return [entry.value.start, map] as const;",
    replace:
      "if (Option.isSome(entry) && map === undefined) return [entry.value.start, map] as const;",
    killedBy: g3,
  },
  {
    name: "a refreshed login keeps the refresh token the provider rotated away",
    law: "G3",
    file: refreshQuotaLogin,
    find: "refreshToken: Option.getOrElse(\n          refreshed.refreshToken,\n          () => login.refreshToken,\n        ),",
    replace: "refreshToken: login.refreshToken,",
    killedBy: g3,
  },
  {
    name: "a refused refresh does not make the login expired",
    law: "G4",
    file: refreshQuotaLogin,
    find: "yield* write(\n          replacing(held, { ...login, expiredAt: Option.some(now) }),\n        );",
    replace: "yield* Effect.void;",
    killedBy: g4,
  },
  {
    name: "the hub holds one unwritten refreshed login per pool, the last one held",
    law: "G4",
    file: `${quotaModule}/03-domain/refreshes.ts`,
    find: "HashMap.set(\n              heldOf(map, replacement.next.pool),\n              replacement.next.generation,",
    replace:
      "HashMap.set(\n              HashMap.empty(),\n              replacement.next.generation,",
    killedBy: g4SameMillisecond,
  },
  {
    name: "the SQLite store does not write a login's expiry",
    law: "G4",
    file: sqliteQuotaLogins,
    find: "isoOrNull(next.expiredAt),\n                next.pool,",
    replace: "null,\n                next.pool,",
    killedBy: g4Sqlite,
  },
  {
    name: "an access token that ends exactly 5 minutes from now is not refreshed first",
    law: "G5",
    file: `${quotaModule}/03-domain/quota-login.ts`,
    find: "DateTime.isLessThanOrEqualTo(",
    replace: "DateTime.isLessThan(",
    killedBy: g5,
  },
  {
    name: "a refreshed access token that ends within 5 minutes is sent",
    law: "G5",
    file: refreshQuotaLogin,
    find: "if (QuotaLogin.isDue(next, now)) {",
    replace:
      "if (QuotaLogin.isDue(next, now) && Option.isNone(next.refreshedAt)) {",
    killedBy: g5,
  },
  {
    name: "a read is retried after any failure, not only a 401",
    law: "G6",
    file: readQuota,
    find: 'first.failure._tag === "ReadFailure" &&\n          first.failure.kind === "refused"',
    replace: 'first.failure._tag === "ReadFailure"',
    killedBy: g6,
  },
  {
    name: "a read is retried again after a second 401",
    law: "G6",
    file: readQuota,
    find: "return yield* quotaReader.read(pool, { ...reader, login: refreshed });",
    replace:
      "return yield* quotaReader.read(pool, { ...reader, login: refreshed }).pipe(Effect.catch(() => quotaReader.read(pool, { ...reader, login: refreshed })));",
    killedBy: g6,
  },
  {
    name: "a read is retried after a 401 with the token that was refused",
    law: "G6",
    file: readQuota,
    find: "const refreshed = yield* refreshQuotaLogin.execute(\n            pool,\n            Option.some(login.accessToken),\n          );",
    replace: "const refreshed = login;",
    killedBy: g6,
  },
  {
    name: "a refreshed login whose row was forgotten meanwhile is still used",
    file: refreshQuotaLogin,
    find: "onSuccess: (written) =>\n            refreshes.written(replacement.next).pipe(Effect.as(written)),",
    replace:
      "onSuccess: () =>\n            refreshes.written(replacement.next).pipe(Effect.as(true)),",
    killedBy: forgottenWhileRefreshed,
  },
  {
    name: "the hub store leaves deleted rows in its free pages",
    file: "apps/hub/src/shared/04-infrastructure/hub-store/hub-store.ts",
    find: 'database.run("PRAGMA secure_delete = ON");',
    replace: 'database.run("PRAGMA secure_delete = OFF");',
    killedBy:
      "opens the store in WAL mode, with foreign keys on, a busy timeout of 5 seconds and deleted rows overwritten",
  },
  {
    name: "a forgotten quota login stays in the write-ahead log",
    file: sqliteQuotaLogins,
    find: 'database.run("PRAGMA wal_checkpoint(TRUNCATE)");',
    replace: 'database.run("PRAGMA optimize");',
    killedBy:
      "leaves no token of a quota login forgotten or replaced in the store's files, its write-ahead log included",
  },
  {
    name: "a store its group can read is not warned of",
    file: "apps/hub/src/shared/04-infrastructure/hub-store/hub-store.ts",
    find: "if ((mode & 0o077) !== 0) {",
    replace: "if ((mode & 0o007) !== 0) {",
    killedBy:
      "warns, naming the file and its mode, when the store it opens can be read by others than its user, and opens it",
  },
  {
    name: "a refreshed login is held in memory instead of written",
    law: "G7",
    file: refreshQuotaLogin,
    find: "if (!(yield* write(replacing(held, next)))) {",
    replace:
      "if (!(yield* refreshes.hold(replacing(held, next)).pipe(Effect.as(true)))) {",
    killedBy: g7,
  },
  {
    name: "the SQLite store keeps the old refresh token when a login is refreshed",
    law: "G7",
    file: sqliteQuotaLogins,
    find: "Redacted.value(next.refreshToken),\n                iso(next.endsAt),",
    replace:
      "Redacted.value(over[0] ?? next.refreshToken),\n                iso(next.endsAt),",
    killedBy: g7Sqlite,
  },
  {
    name: "the keep-alive checks every two hours",
    law: "G8",
    file: `${quotaModule}/module.ts`,
    find: "Schedule.fixed(Duration.hours(1))",
    replace: "Schedule.fixed(Duration.hours(2))",
    killedBy: g8,
  },
  {
    name: "the keep-alive does not check when the hub starts",
    law: "G8",
    file: `${quotaModule}/module.ts`,
    find: "keep.execute.pipe(Effect.repeat(",
    replace:
      "keep.execute.pipe(Effect.delay(Duration.hours(1)), Effect.repeat(",
    killedBy: g8,
  },
  {
    name: "the keep-alive refreshes the logins that are not due, not those that are",
    law: "G8",
    file: keepAlive,
    find: "!QuotaLogin.isDue(stored, now))",
    replace: "QuotaLogin.isDue(stored, now))",
    killedBy: g8,
  },
  {
    name: "a ChatGPT access token without a readable exp is taken to last one day",
    file: quotaLoginDomain,
    find: "const assumedLife = Duration.days(8);",
    replace: "const assumedLife = Duration.days(1);",
    killedBy: chatGptEnds,
  },
  {
    name: "a ChatGPT access token without a readable exp is taken to end now",
    file: quotaLoginDomain,
    find: "Option.getOrElse(() => DateTime.addDuration(now, assumedLife)),",
    replace: "Option.getOrElse(() => now),",
    killedBy: chatGptEnds,
  },
  {
    name: "a token that is refused names itself in the problem",
    law: "G1",
    file: quotaLoginDomain,
    find: "`${what}: 1 to ${longest} characters, none of them whitespace or a control character`,",
    replace:
      "`${what} ${text}: 1 to ${longest} characters, none of them whitespace or a control character`,",
    killedBy: g1Contract,
  },
  {
    name: "a token endpoint's failure repeats its answer's body",
    law: "G1",
    file: `${quotaModule}/04-infrastructure/token-endpoints/token-endpoint.ts`,
    find: "`${call.provider}'s token endpoint answered ${status}.`,",
    replace:
      "`${call.provider}'s token endpoint answered ${status}: ${text}.`,",
    killedBy: g1Echoes,
  },
  {
    name: "an expired quota login is logged with its refresh token",
    law: "G1",
    file: refreshQuotaLogin,
    find: 'Effect.logWarning("quota login expired").pipe(\n          Effect.annotateLogs({ pool: pool.id }),',
    replace:
      'Effect.logWarning("quota login expired").pipe(\n          Effect.annotateLogs({ pool: pool.id, refresh: Redacted.value(login.refreshToken) }),',
    killedBy: g1Echoes,
  },
  {
    name: "a keyed pool that speaks anthropic-messages takes a Claude login",
    law: "G9",
    file: quotaLoginDomain,
    find: 'if (pool.kind !== "subscription") return Option.none();',
    replace:
      'if (pool.kind === "observed" || (pool.kind !== "subscription" && pool.protocol !== "anthropic-messages")) return Option.none();',
    killedBy: g9,
  },
  {
    name: "a subscription pool takes the other provider's login",
    law: "G9",
    file: giveQuotaLogin,
    find: "if (!Option.contains(takes, given.provider)) {",
    replace: "if (Option.isNone(takes)) {",
    killedBy: g9,
  },
  {
    name: "Anthropic's usage endpoint is read at the pool's base URL",
    law: "G2",
    file: `${quotaModule}/04-infrastructure/readers/readers.ts`,
    find: "? Anthropic.read(http, options.anthropic, login)",
    replace:
      '? Anthropic.read(http, `${_pool.kind === "observed" ? "" : _pool.baseUrl}/api/oauth/usage`, login)',
    killedBy: g2,
  },
  {
    name: "a model's weekly limit is read without decoding it",
    law: "U5",
    file: anthropicReader,
    find: "const limit = ProviderCall.decodeAt(Limit, value, `limits[${index}]`);",
    replace: "const limit = Result.succeed(value as typeof Limit.Type);",
    killedBy: u5Each,
  },
  {
    name: "Anthropic's utilization is read as a fraction",
    law: "U5",
    file: anthropicReader,
    find: "used: window.utilization,",
    replace: "used: window.utilization * 100,",
    killedBy: u5Fixtures,
  },
  {
    name: "a ChatGPT reset is read as Unix milliseconds, not seconds",
    law: "U5",
    file: chatGptReader,
    find: "resetMs: Option.some(window.reset_at * 1000),",
    replace: "resetMs: Option.some(window.reset_at),",
    killedBy: u5Fixtures,
  },
  {
    name: "a named ChatGPT limit is read without decoding it",
    law: "U5",
    file: chatGptReader,
    find: "const extra = ProviderCall.decodeAt(Additional, value, path);",
    replace: "const extra = Result.succeed(value as typeof Additional.Type);",
    killedBy: u5Each,
  },
  {
    name: "a Claude plan is named without its multiple",
    law: "U5",
    file: `${quotaModule}/03-domain/plan.ts`,
    find: "onSome: (times) => `${capitalised(type)} ${times}x`,",
    replace: "onSome: () => capitalised(type),",
    killedBy: u5Fixtures,
  },
  {
    name: "a token endpoint call sends the client library's user agent",
    law: "U6",
    file: tokenEndpoint,
    find: 'HttpClientRequest.setHeader("user-agent", userAgent),',
    replace: 'HttpClientRequest.setHeader("x-user-agent", userAgent),',
    killedBy: u6Tokens,
  },
  {
    name: "a token endpoint call is abandoned only after 30 seconds",
    law: "U6",
    file: tokenEndpoint,
    find: "duration: longestCall,",
    replace: 'duration: "30 seconds",',
    killedBy: u6Tokens,
  },
  {
    name: "a quota login is made by the first client on PATH, cota's shim of it included",
    file: connectScript,
    find: "    if (!isShim(head)) return path;",
    replace: "    if (head !== undefined) return path;",
    killedBy:
      "runs the real client on a joined machine, never cota's shim of it that comes first on PATH",
  },
  {
    name: "the keychain item is read with the terminal, which shows the login",
    file: connectScript,
    find: 'const item = yield* ranCaptured(\n    security,\n    ["find-generic-password", "-s", service, "-w"],',
    replace:
      'const item = yield* ranInTerminal(\n    security,\n    ["find-generic-password", "-s", service, "-w"],',
    killedBy: connectsClaude,
  },
  {
    name: "a keychain item that is not a Claude login is printed",
    file: connectScript,
    find: '`the keychain item "${service}" does not hold a Claude login: claudeAiOauth with accessToken, refreshToken and expiresAt.`,',
    replace:
      '`the keychain item "${service}" does not hold a Claude login: claudeAiOauth with accessToken, refreshToken and expiresAt, not ${item.stdout}.`,',
    killedBy: malformedKeychainItem,
  },
  {
    name: "an auth.json that is not a ChatGPT login is printed",
    file: connectScript,
    find: '"Codex\'s auth.json does not hold a ChatGPT login: tokens with access_token and refresh_token.",',
    replace:
      "`Codex's auth.json does not hold a ChatGPT login: tokens with access_token and refresh_token, not ${text.value}.`,",
    killedBy: malformedAuthJson,
  },
  {
    name: "the provider's client is given the owner password",
    file: connectScript,
    find: 'passed.includes(name) || name.startsWith("LC_");',
    replace:
      'passed.includes(name) || name.startsWith("LC_") || name.startsWith("COTA_");',
    killedBy: connectsClaude,
  },
  {
    name: "the provider's client is given the script's whole environment",
    file: connectScript,
    find: "value !== undefined && isPassed(name) ? [[name, value]] : [],",
    replace: "value !== undefined ? [[name, value]] : [],",
    killedBy: connectsClaude,
  },
  {
    name: "the throwaway directory is kept",
    file: connectScript,
    find: "(directory) => removed(directory, left),",
    replace: "() => Effect.void,",
    killedBy: connectsClaude,
  },
  {
    name: "the throwaway directory is removed only when the login was sent",
    file: connectScript,
    find: "(directory) => removed(directory, left),",
    replace:
      '(directory, exit) => exit._tag === "Success" ? removed(directory, left) : Effect.void,',
    killedBy: failedClaudeSignIn,
  },
  {
    name: "the keychain item is deleted only after a sign-in that succeeded",
    file: connectScript,
    find: "  yield* Effect.addFinalizer(() =>\n    keychainItemDeleted(security, service, left),\n  );\n  const env = environmentWith({ CLAUDE_CONFIG_DIR: directory });\n",
    replace:
      '  const env = environmentWith({ CLAUDE_CONFIG_DIR: directory });\n  yield* Effect.addFinalizer((exit) =>\n    exit._tag === "Success" ? keychainItemDeleted(security, service, left) : Effect.void,\n  );\n',
    killedBy: failedClaudeSignIn,
  },
  {
    name: "an interrupt ends the script without its cleanup",
    file: connectScript,
    find: "BunRuntime.runMain(main, { disableErrorReporting: true });",
    replace: "Effect.runFork(main);",
    killedBy: interruptedConnect,
  },
  {
    name: "the login is sent as the script holds it, unchecked by the API's schema",
    file: connectScript,
    find: "const body = yield* encodeLogin(login).pipe(",
    replace: "const body = yield* Effect.succeed(JSON.stringify(login)).pipe(",
    killedBy: loginNotTaken,
  },
  {
    name: "the list of pools is read with a copy of the API's schema that reads only a pool's id and quota login",
    file: connectScript,
    find: "Schema.fromJsonString(PoolsApi.Pools),",
    replace:
      'Schema.fromJsonString(Schema.Struct({ pools: Schema.Array(Schema.Struct({ id: Schema.String, quotaLogin: Schema.NullOr(Schema.Struct({ provider: Schema.Literals(["anthropic", "chatgpt"]) })) })) })),',
    killedBy: olderHub,
  },
  {
    name: "the owner's own keychain item is not looked at again after the sign-in",
    file: connectScript,
    find: "  const ownersAfter = yield* attributesOf(security, ownersItem);",
    replace: "  const ownersAfter = ownersBefore;",
    killedBy: ownersItemChanged,
  },
  {
    name: "the owner's own keychain item is compared only by whether it is there",
    file: connectScript,
    find: "  if (ownersAfter !== ownersBefore) {",
    replace: "  if ((ownersAfter === null) !== (ownersBefore === null)) {",
    killedBy: ownersItemChanged,
  },
  {
    name: "a keychain item that was there before the sign-in is taken for this run's",
    file: connectScript,
    find: "  if ((yield* attributesOf(security, service)) !== null) {",
    replace: '  if ((yield* attributesOf(security, service)) === "never") {',
    killedBy: foreignItem,
  },
  {
    name: "a hang-up ends the script without its cleanup",
    file: connectScript,
    find: 'for (const signal of ["SIGHUP", "SIGQUIT"] as const) {',
    replace: 'for (const signal of ["SIGQUIT"] as const) {',
    killedBy: hungUpConnect,
  },
  {
    name: "a throwaway directory an earlier run left is not named",
    file: connectScript,
    find: "      yield* leftBehindNamed();\n",
    replace: "",
    killedBy: leftBehind,
  },
  {
    name: "a throwaway directory an earlier run left is removed by the next",
    file: connectScript,
    find: "    yield* Console.error(\n      `${directory} was left by a run",
    replace:
      "    rmSync(directory, { recursive: true, force: true });\n    yield* Console.error(\n      `${directory} was left by a run",
    killedBy: leftBehind,
  },
  {
    name: "a script interrupted while the client signs in leaves the client running",
    file: connectScript,
    find: 'child.kill("SIGTERM");\n    const late = setTimeout(() => child.kill("SIGKILL"), 5_000);',
    replace: "const late = setTimeout(() => undefined, 5_000);",
    killedBy: interruptedConnect,
  },
  {
    name: "plain http is sent to any host",
    file: connectScript,
    find: 'url.protocol === "https:" ||\n    allowPlainHttp ||',
    replace: 'url.protocol.startsWith("http") ||\n    allowPlainHttp ||',
    killedBy: plainHttpRefused,
  },
  {
    name: "plain http is sent to a private address, as it was before only this machine took it",
    file: connectScript,
    find: '  hostname === "[::1]" ||\n',
    replace:
      '  hostname === "[::1]" ||\n  hostname.startsWith("192.168.") ||\n',
    killedBy: plainHttpRule,
  },
  {
    name: "plain http is sent to any name that starts as a loopback address does",
    file: connectScript,
    find: "/^127\\.\\d+\\.\\d+\\.\\d+$/.test(hostname)",
    replace: 'hostname.startsWith("127.")',
    killedBy: plainHttpRule,
  },
  {
    name: "a day is due as soon as it ends, without its hour",
    law: "B10",
    file: archiveDomain,
    find: "DateTime.add(endOf(day), { hours: 1 })",
    replace: "endOf(day)",
    killedBy: decidedWhenDue,
  },
  {
    name: "a day is due only once its hour has passed, not at the instant it does",
    law: "B10",
    file: archiveDomain,
    find: "!DateTime.isLessThan(now, DateTime.add(endOf(day), { hours: 1 }))",
    replace:
      "DateTime.isGreaterThan(now, DateTime.add(endOf(day), { hours: 1 }))",
    killedBy: decidedAtTheHour,
  },
  {
    name: "a day the log holds no row of is archived once it is due",
    file: archiveDomain,
    find: "return holdsRows(summary) && isDue(day, now)",
    replace: "return isDue(day, now)",
    killedBy: decidedWhenDue,
  },
  {
    name: "a due day whose manifest cannot be read is archived over it",
    law: "B5",
    file: archiveDomain,
    find: '    return { _tag: "Unreadable", why: reading.why };\n',
    replace:
      '    return isDue(day, now) ? { _tag: "Archive" } : { _tag: "Unreadable", why: reading.why };\n',
    killedBy: decidedNeverOver,
  },
  {
    name: "a day the log holds no row of is decided changed, not missing",
    law: "B5",
    file: archiveDomain,
    find: '  if (!holdsRows(summary)) return { _tag: "Missing" };\n',
    replace: "",
    killedBy: decidedNeverOver,
  },
  {
    name: "only the days the log holds rows of are decided",
    law: "B5",
    file: archiveDomain,
    find: "[...new Set([...summaries.keys(), ...manifests.keys()])]",
    replace: "[...new Set([...summaries.keys()])]",
    killedBy: decidedNeverOver,
  },
  {
    name: "a day is compared with the log by its counts alone",
    law: "B4",
    file: archiveDomain,
    find: "rows === summary[table].rows &&\n      fingerprint === summary[table].fingerprint",
    replace: "rows === summary[table].rows",
    killedBy: decidedChanged,
  },
  {
    name: "a day whose summary equals its manifest is decided changed",
    law: "B3",
    file: archiveDomain,
    find: "if (matches(reading.manifest, summary)) return",
    replace:
      "if (matches(reading.manifest, summary) && !holdsRows(summary)) return",
    killedBy: decidedToWriteNothing,
  },
  {
    name: "a day's files are verified by their counts alone",
    law: "B2",
    file: archiveDomain,
    find: "file.rows === log.rows && file.checksum === log.checksum",
    replace: "file.rows === log.rows",
    killedBy: verifiedBeforeNamed,
  },
  {
    name: "a day's files are named and its manifest written though they do not load to the log's rows",
    law: "B2",
    file: archiveDays,
    find: "if (differences.length > 0) {",
    replace: "if (differences.length > 4) {",
    killedBy: verifiedBeforeNamed,
  },
  {
    name: "the run reads no manifest, and archives every archived day again",
    law: "B3",
    file: archiveDays,
    find: "          manifests.success,\n",
    replace: "          new Map(),\n",
    killedBy: nothingWritten,
  },
  {
    name: "a changed day whose archived rows the log all holds is never archived again",
    law: "B4",
    file: archiveDays,
    find: "const total = sum(Archive.tables.map((table) => lacking[table]));",
    replace:
      "const total = 1 + sum(Archive.tables.map((table) => lacking[table]));",
    killedBy: archivedAgain,
  },
  {
    name: "an archive is replaced whenever its day changed",
    law: "B5",
    file: archiveDays,
    find: "if (total > 0) {",
    replace: "if (total < 0) {",
    killedBy: nothingGivenUp,
  },
  {
    name: "only the items the log lacks are counted",
    law: "B5",
    file: archiveDays,
    find: "if (file === null || file === undefined) return 0;",
    replace:
      'if (file === null || file === undefined || table !== "items") return 0;',
    killedBy: nothingGivenUp,
  },
  {
    name: "a day not yet due is archived",
    law: "B10",
    file: archiveDays,
    find: 'if (decision._tag === "Archive") {',
    replace:
      'if (decision._tag === "Archive" || decision._tag === "Nothing") {',
    killedBy: neverBeforeTheHour,
  },
  {
    name: "an export that breaks off ends as a short answer",
    law: "B2",
    file: clickHouseClient,
    find: '    const answered = response.stream.pipe(\n      Stream.mapError(() => failure(0, "the answer ended early")),\n    );',
    replace:
      '    const answered = response.stream.pipe(\n      Stream.mapError(() => failure(0, "the answer ended early")),\n      Stream.catchTag("ClickHouseError", () => Stream.empty),\n    );',
    killedBy: exportBreaksOff,
  },
  {
    name: "the log's summary is not the fingerprint a load gives",
    law: "B3",
    file: archive,
    find: '             FROM ${table}${table === "items" ? " FINAL" : ""} GROUP BY day`,',
    replace:
      '             FROM ${table}${table === "items" ? " FINAL" : ""} GROUP BY day`.replace("cityHash64(", "cityHash64(1, "),',
    killedBy: nothingWrittenOverClickHouse,
  },
  {
    name: "the log's summaries count every copy of an item",
    law: "B4",
    file: archive,
    find: '${table === "items" ? " FINAL" : ""} GROUP BY day',
    replace: " GROUP BY day",
    killedBy: archivedAgainOverClickHouse,
  },
  {
    name: "the restore's insert is abandoned at 35 seconds",
    file: archive,
    find: "{ settings: addSettings, wait: longestTransfer },",
    replace: "{ settings: addSettings },",
    killedBy: insertWaitedOn,
  },
  {
    name: "the restore's insert is not stopped by ClickHouse",
    file: archive,
    find: '  max_execution_time: "600",\n  min_insert_block_size_rows: "65536",',
    replace: '  min_insert_block_size_rows: "65536",',
    killedBy: insertWaitedOn,
  },
  {
    name: "a load fails on a temporary table its session still holds",
    file: archive,
    find: "  inSession\n    .command(`DROP TEMPORARY TABLE IF EXISTS archive_${table}`)\n    .pipe(\n      Effect.andThen(",
    replace:
      "  inSession\n    .command(`SELECT 1`)\n    .pipe(\n      Effect.andThen(",
    killedBy: leftoverReplaced,
  },
  {
    name: "a stalled export is waited on for ever",
    file: clickHouseClient,
    find: "began + Duration.toMillis(wait) - now",
    replace: "began + Duration.toMillis(Duration.days(365)) - now",
    killedBy: stalledExportEnds,
  },
  {
    name: "a loaded file's table is made in the log's database",
    law: "B8",
    file: archive,
    find: "`CREATE TEMPORARY TABLE archive_${table} ENGINE",
    replace: "`CREATE TABLE IF NOT EXISTS archive_${table} ENGINE",
    killedBy: onlySelectsAndInserts,
  },
  {
    name: "the restore leaves out a day's titles",
    law: "B1",
    file: restoreArchive,
    find: "if (entry === undefined || file === null || file === undefined) return 0;",
    replace:
      'if (entry === undefined || file === null || file === undefined || table === "session_titles") return 0;',
    killedBy: dayComesBack,
  },
  {
    name: "a day whose file differs from its manifest's SHA-256 is accepted",
    law: "B6",
    file: restoreArchive,
    find: "if (found.value.sha256 !== entry.sha256) {",
    replace: "if (found.value.sha256 !== found.value.sha256) {",
    killedBy: damagedRefused,
  },
  {
    name: "a day whose file loads to its manifest's count but another checksum is accepted",
    law: "B6",
    file: restoreArchive,
    find: "          : measure.checksum !== entry.checksum",
    replace: "          : false",
    killedBy: damagedRefused,
  },
  {
    name: "a day whose files load to other rows than its manifest's is refused only in the table that differs",
    law: "B6",
    file: restoreArchive,
    find: "            : loadRefusal(session, manifest, source),",
    replace: "            : Effect.succeed(Option.none<string>()),",
    killedBy: damagedRefused,
  },
  {
    name: "a day the log holds whole is reported as restored with nothing added, not as already held",
    file: restoreArchive,
    find: '      if (Archive.matches(manifest, summary)) return { _tag: "Held" };',
    replace: "",
    killedBy: restoreExitCode,
  },
  {
    name: "the restore inserts every loaded row, held or not",
    law: "B7",
    file: archive,
    find: "             SELECT ${named} FROM archive_${table} WHERE ${notHeld[table]}`,",
    replace: "             SELECT ${named} FROM archive_${table}`,",
    killedBy: nothingTwice,
  },
  {
    name: "the restore merges the table it adds to",
    law: "B8",
    file: archive,
    find: '        const named = columns.map((column) => `\\`${column}\\``).join(", ");',
    replace:
      '        yield* inSession.command(`OPTIMIZE TABLE ${table} FINAL`);\n        const named = columns.map((column) => `\\`${column}\\``).join(", ");',
    killedBy: restoreOnlySelectsAndInserts,
  },
  {
    name: "a day whose rows are still not all held after the add is reported as added",
    file: restoreArchive,
    find: "        if (still > 0) {",
    replace: "        if (false) {",
    killedBy:
      "reports a day failed, not added, when the log still lacks some of its rows after they were added",
  },
  {
    name: "the requests are restored before their items",
    law: "B9",
    file: restoreArchive,
    find: "        for (const table of Archive.tables) {",
    replace: "        for (const table of [...Archive.tables].reverse()) {",
    killedBy: itemsFirst,
  },
  {
    name: "the restore exits 0 when a day was refused or failed",
    file: "apps/hub/src/restore-archive.ts",
    find: '  return count("Refused") + count("Failed") > 0 ? 1 : 0;',
    replace: '  return count("Refused") + count("Failed") > 0 ? 0 : 0;',
    killedBy: restoreExitCode,
  },
  {
    name: "a day that is a symbolic link is written through",
    file: archiveDirectory,
    find: "      Effect.map(Option.exists((stats) => stats.isDirectory())),",
    replace: "      Effect.map(Option.isSome),",
    killedBy: nothingThroughADay,
  },
  {
    name: "the sweep removes a directory named as a partial file",
    file: archiveDirectory,
    find: '      if (!(entry.isFile() && entry.name.endsWith(".partial"))) continue;',
    replace: '      if (!entry.name.endsWith(".partial")) continue;',
    killedBy:
      "sweeps and discards past a directory named as a partial file, and leaves it",
  },
  {
    name: "the blocks left over go to the smallest remainders",
    law: "V2",
    file: apportioning,
    find: ".sort((a, b) => b.remainder - a.remainder)",
    replace: ".sort((a, b) => a.remainder - b.remainder)",
    killedBy: eachPartItsShare,
  },
  {
    name: "the blocks left over are never given",
    law: "V1",
    file: apportioning,
    find: ".slice(0, left);",
    replace: ".slice(0, 0);",
    killedBy: everyBlockGiven,
  },
  {
    name: "a meter rounds its full blocks to the nearest",
    law: "V5",
    file: meter,
    find: "const full = Math.floor(held / perBlock);",
    replace: "const full = Math.round(held / perBlock);",
    killedBy: blocksInOrder,
  },
  {
    name: "a meter is near its limit only from 90%",
    law: "V8",
    file: meter,
    find: 'used >= 80 ? "near"',
    replace: 'used >= 90 ? "near"',
    killedBy: nearTheLimit,
  },
  {
    name: "a column's unit skips 2 × 10ⁿ",
    law: "V10",
    file: columns,
    find: "const steps = [1, 2, 5];",
    replace: "const steps = [1, 5];",
    killedBy: oneUnit,
  },
  {
    name: "a column under half a unit draws nothing",
    law: "V11",
    file: columns,
    find: "  if (placed > 0 || running <= 0) return blocks;",
    replace: "  return blocks;",
    killedBy: columnBlocks,
  },
  {
    name: "a column's parts are rounded each on its own",
    law: "V11",
    file: columns,
    find: "    const given = upTo - placed;",
    replace: "    const given = Math.round(part / unit);",
    killedBy: columnBlocks,
  },
  {
    name: "merging to fit rounds its runs down",
    law: "V13",
    file: columns,
    find: "const run = Math.ceil(buckets.length / Math.max(1, capacity));",
    replace: "const run = Math.floor(buckets.length / Math.max(1, capacity));",
    killedBy: mergedToFit,
  },
  {
    name: "a span rounds its minutes to the nearest",
    law: "V14",
    file: quantities,
    find: "const minutes = Math.floor(Math.max(0, milliseconds) / minute);",
    replace: "const minutes = Math.round(Math.max(0, milliseconds) / minute);",
    killedBy: spanRoundedDown,
  },
  {
    name: "a count of tokens that rounds up to a thousand of its suffix keeps the suffix",
    law: "V15",
    file: quantities,
    find: "index === magnitudes.length - 1 || tenths(count / size) < 1000,",
    replace: "index === magnitudes.length - 1 || count / size < 1000,",
    killedBy: tokensCompact,
  },
  {
    name: "a cost just under $100 is written as $100.00",
    law: "V16",
    file: quantities,
    find: "if (cents < 100 * 100)",
    replace: "if (dollars < 100)",
    killedBy: costWritten,
  },
  {
    name: "a share just under all is written 100%",
    law: "V17",
    file: quantities,
    find: '  if (percent < 100 && percent >= 99.5) return "99%";\n',
    replace: "",
    killedBy: shareWritten,
  },
  {
    name: "a delta rounds a multiple to the nearest tenth",
    law: "V19",
    file: quantities,
    find: "String(Math.floor(ratio * 10) / 10)",
    replace: "String(Math.round(ratio * 10) / 10)",
    killedBy: deltaWritten,
  },
  {
    name: "a delta writes a fall of almost everything as 100%",
    law: "V19",
    file: quantities,
    find: "text: `↓${share(-change)}`",
    replace: "text: `↓${Math.round(-change * 100)}%`",
    killedBy: deltaWritten,
  },
  {
    name: "an ago says just now for anything under five minutes",
    law: "V20",
    file: quantities,
    find: 'milliseconds < minute ? "just now"',
    replace: 'milliseconds < 5 * minute ? "just now"',
    killedBy: agoWritten,
  },
  {
    name: "pools beyond the set take the hues again",
    law: "V18",
    file: hues,
    find: 'hues[index] ?? "neutral"',
    replace: 'hues[index % hues.length] ?? "neutral"',
    killedBy: huesInOrder,
  },
  {
    name: "marking drops what follows the last marked word",
    law: "V21",
    file: snippet,
    find: "  if (from < snippet.length) {\n    pieces.push({ text: snippet.slice(from), marked: false });\n  }\n",
    replace: "",
    killedBy: piecesKeepTheSnippet,
  },
  {
    name: "the search query is split at spaces only, and not lowercased",
    law: "V22",
    file: snippet,
    find: "const asked = wordsOf(query);",
    replace: 'const asked = query.split(" ");',
    killedBy: marksAreTheQuerysWords,
  },
  {
    name: "a letter beyond ASCII ends a word",
    law: "V22",
    file: snippet,
    find: "  point > 0x7f ||\n",
    replace: "",
    killedBy: marksAreTheQuerysWords,
  },
  {
    name: "a word of the query allows one edit more than its tolerance",
    law: "V22",
    file: snippet,
    find: "Math.min(2, Math.round([...word].length * fuzzy))",
    replace: "Math.min(2, Math.round([...word].length * fuzzy) + 1)",
    killedBy: marksAreTheQuerysWords,
  },
  {
    name: "the pages are as many as the total fills, the last partial one left out",
    law: "V23",
    file: pages,
    find: "Math.ceil(total / limit)",
    replace: "Math.floor(total / limit)",
    killedBy: pagesCoverTheRows,
  },
  {
    name: "the page at the greatest offset is not offered",
    law: "V23",
    file: pages,
    find: "Math.floor(most / limit) + 1",
    replace: "Math.floor(most / limit)",
    killedBy: pagesCoverTheRows,
  },
  {
    name: "the last page is said to run a whole limit past the total",
    law: "V23",
    file: pages,
    find: "const last = Math.min(offset + limit, total);",
    replace: "const last = offset + limit;",
    killedBy: pagesCoverTheRows,
  },
  {
    name: "the first column starts at its first main request, leaving the requests before it out",
    law: "V24",
    file: context,
    find: "const from = index === 0 ? 0 : first;",
    replace: "const from = first;",
    killedBy: columnsCoverTheSession,
  },
  {
    name: "a stretch ends a request before the next column's",
    law: "V24",
    file: context,
    find: "const to = starts[index + 1]?.first ?? requests.length;",
    replace:
      "const to = (starts[index + 1]?.first ?? requests.length + 1) - 1;",
    killedBy: columnsCoverTheSession,
  },
  {
    name: "only the main requests' errors are counted on a column",
    law: "V24",
    file: context,
    find: "errors: stretch.filter((request) => request.error).length,",
    replace: "errors: main.filter((request) => request.error).length,",
    killedBy: columnsCoverTheSession,
  },
  {
    name: "a new segment does not start a new run",
    law: "V25",
    file: context,
    find: "if (last === undefined || request.segment !== current) {",
    replace: "if (last === undefined) {",
    killedBy: aSegmentStartsAColumn,
  },
  {
    name: "every column is said to open its segment",
    law: "V25",
    file: context,
    find: ".map((first, at) => ({ first, opens: at === 0 })),",
    replace: ".map((first) => ({ first, opens: true })),",
    killedBy: aSegmentStartsAColumn,
  },
  {
    name: "the gaps between segments are not counted against the capacity",
    law: "V26",
    file: context,
    find: "if (columns + lengths.length - 1 <= capacity) return run;",
    replace: "if (columns <= capacity) return run;",
    killedBy: runsOfOneLength,
  },
  {
    name: "a column never holds one main request alone",
    law: "V26",
    file: context,
    find: "for (let run = 1; run < longest; run += 1) {",
    replace: "for (let run = 2; run < longest; run += 1) {",
    killedBy: runsOfOneLength,
  },
  {
    name: "a column's prompt sizes are summed",
    law: "V27",
    file: context,
    find: "const peak = largest(main.map((request) => request.promptSize));",
    replace:
      "const peak = main.reduce<number | null>((sum, request) => request.promptSize === null ? sum : (sum ?? 0) + request.promptSize, null);",
    killedBy: aColumnIsItsLargestPrompt,
  },
  {
    name: "a column under half a block draws none",
    law: "V27",
    file: context,
    find: "peak === null || peak <= 0 ? 0 : Math.max(1, Math.round(peak / unit)),",
    replace: "peak === null || peak <= 0 ? 0 : Math.round(peak / unit),",
    killedBy: aColumnIsItsLargestPrompt,
  },
  {
    name: "a result takes the earliest unpaired call of its id",
    law: "V28",
    file: pairs,
    find: "const row = waiting.get(callId)?.pop();",
    replace: "const row = waiting.get(callId)?.shift();",
    killedBy: eachResultWithItsCall,
  },
  {
    name: "a result takes a waiting call of any id",
    law: "V28",
    file: pairs,
    find: "const row = waiting.get(callId)?.pop();",
    replace:
      "const row = [...waiting.values()].find((calls) => calls.length > 0)?.pop();",
    killedBy: eachResultWithItsCall,
  },
  {
    name: "a paired result is also a row of its own",
    law: "V28",
    file: pairs,
    find: "        call.result = at;\n        return;\n",
    replace: "        call.result = at;\n",
    killedBy: eachResultWithItsCall,
  },
  {
    name: "a closed fence's last line is left out",
    law: "V29",
    file: text,
    find: "text.slice(open.start, next),",
    replace: "text.slice(open.start, line),",
    killedBy: splittingKeepsTheText,
  },
  {
    name: "a fence a cut left open loses its code",
    law: "V29",
    file: text,
    find: "pieces.push(code(text.slice(open.start), open.language, text.slice(body)));",
    replace:
      'pieces.push(code(text.slice(open.start, body), open.language, ""));',
    killedBy: splittingKeepsTheText,
  },
  {
    name: "the blank lines between blocks are dropped",
    law: "V29",
    file: text,
    find: '.filter((raw) => raw !== "")',
    replace: '.filter((raw) => raw.trim() !== "")',
    killedBy: splittingKeepsTheText,
  },
  {
    name: "what follows a line's last inline piece is dropped",
    law: "V29",
    file: text,
    find: '  if (last < text.length) pieces.push({ kind: "text", raw: text.slice(last) });\n  return pieces;\n};\n\nexport type Reminded',
    replace: "  return pieces;\n};\n\nexport type Reminded",
    killedBy: splittingKeepsTheText,
  },
  {
    name: "a reminder's tags are left out of its piece",
    law: "V29",
    file: text,
    find: 'pieces.push({ kind: "reminder", raw: match[0], text: match[1] ?? "" });',
    replace:
      'pieces.push({ kind: "reminder", raw: match[1] ?? "", text: match[1] ?? "" });',
    killedBy: splittingKeepsTheText,
  },
  {
    name: "a JSON message's own message field is never read",
    law: "V30",
    file: headline,
    find: 'if (message.trimStart().startsWith("{")) {',
    replace: "if (message.length < 0) {",
    killedBy: aHeadlineIsOneLine,
  },
  {
    name: "a message field the cut left unclosed is not read",
    law: "V30",
    file: headline,
    find: '(?:"|\\\\?$)/;',
    replace: '"/;',
    killedBy: aHeadlineIsOneLine,
  },
  {
    name: "a blank message field is the headline",
    law: "V30",
    file: headline,
    find: 'if (line !== "") return line;',
    replace: "if (field !== undefined) return line;",
    killedBy: aHeadlineIsOneLine,
  },
  {
    name: "a message field's escapes are left in",
    law: "V30",
    file: headline,
    find: "firstLineOf(unescaped(field))",
    replace: "firstLineOf(field)",
    killedBy: aHeadlineIsOneLine,
  },
  {
    name: "a blank first line is the headline",
    law: "V30",
    file: headline,
    find: '.find((line) => line !== "") ?? ""',
    replace: '.find(() => true) ?? ""',
    killedBy: aHeadlineIsOneLine,
  },
  {
    name: "a line is not trimmed",
    law: "V30",
    file: headline,
    find: ".map((line) => line.trim())",
    replace: ".map((line) => line)",
    killedBy: aHeadlineIsOneLine,
  },
  {
    name: "a carriage return or a line separator does not end a line",
    law: "V30",
    file: headline,
    find: "const lineBreak = /\\r\\n|[\\n\\r\\u2028\\u2029]/;",
    replace: "const lineBreak = /\\n/;",
    killedBy: aHeadlineIsOneLine,
  },
  {
    name: "a doubled quote ends a string",
    law: "V31",
    file: sqlText,
    find: "      if (text[at + 1] === quote) {",
    replace: '      if (quote === "") {',
    killedBy: tokensKeepTheSql,
  },
  {
    name: "a backslash escapes nothing in a string or a quoted name",
    law: "V31",
    file: sqlText,
    find: '    if (character === "\\\\") {',
    replace: '    if (character === "") {',
    killedBy: tokensKeepTheSql,
  },
  {
    name: "a string is not read as one, so a keyword inside it is a keyword",
    law: "V31",
    file: sqlText,
    find: '    } else if (character === "\'") {\n      take("string", quotedEnd(text, at, "\'"));\n',
    replace: "",
    killedBy: tokensKeepTheSql,
  },
  {
    name: "a block comment's closing is left out of it",
    law: "V31",
    file: sqlText,
    find: 'take("comment", close === -1 ? text.length : close + 2);',
    replace: 'take("comment", close === -1 ? text.length : close);',
    killedBy: tokensKeepTheSql,
  },
  {
    name: "a line comment takes the line break after it",
    law: "V31",
    file: sqlText,
    find: 'take("comment", lineEnd === -1 ? text.length : at + lineEnd);',
    replace:
      'take("comment", lineEnd === -1 ? text.length : at + lineEnd + 1);',
    killedBy: tokensKeepTheSql,
  },
  {
    name: "the selection is never run alone",
    law: "V32",
    file: sqlText,
    find: 'selected.trim() === "" ? text : selected',
    replace: 'selected.trim() === "" ? text : text',
    killedBy: theStatementRun,
  },
  {
    name: "a selection of white space alone is run",
    law: "V32",
    file: sqlText,
    find: 'selected.trim() === "" ? text',
    replace: 'selected === "" ? text',
    killedBy: theStatementRun,
  },
  {
    name: "the statement keeps the white space at its ends",
    law: "V32",
    file: sqlText,
    find: ": selected).trim();",
    replace: ": selected);",
    killedBy: theStatementRun,
  },
  {
    name: "the row at the foot of the view, partly shown, is not drawn",
    law: "V33",
    file: grid,
    find: "Math.ceil((top + height) / rowHeight)",
    replace: "Math.floor((top + height) / rowHeight)",
    killedBy: everyRowInViewDrawn,
  },
  {
    name: "twice the overscan is drawn below the view",
    law: "V33",
    file: grid,
    find: "Math.ceil((top + height) / rowHeight) + overscan",
    replace: "Math.ceil((top + height) / rowHeight) + 2 * overscan",
    killedBy: everyRowInViewDrawn,
  },
  {
    name: "the first row drawn may be before the first row",
    law: "V33",
    file: grid,
    find: "Math.max(0, Math.floor(top / rowHeight) - overscan)",
    replace: "Math.floor(top / rowHeight) - overscan",
    killedBy: everyRowInViewDrawn,
  },
  {
    name: "rows past the last are drawn",
    law: "V33",
    file: grid,
    find: "Math.min(rows, Math.ceil((top + height) / rowHeight) + overscan)",
    replace: "Math.ceil((top + height) / rowHeight) + overscan",
    killedBy: everyRowInViewDrawn,
  },
  {
    name: "a tab inside a value is written as it is",
    law: "V34",
    file: tsv,
    find: '  "\\t": "\\\\t",\n',
    replace: "",
    killedBy: tsvKeepsTheValues,
  },
  {
    name: "a carriage return inside a value is written as it is",
    law: "V34",
    file: tsv,
    find: '  "\\r": "\\\\r",\n',
    replace: "",
    killedBy: tsvKeepsTheValues,
  },
  {
    name: "a backslash inside a value is written as it is",
    law: "V34",
    file: tsv,
    find: '  "\\\\": "\\\\\\\\",\n',
    replace: "",
    killedBy: tsvKeepsTheValues,
  },
  {
    name: "a null is written NULL, as the string is",
    law: "V34",
    file: tsv,
    find: 'value === null ? "\\\\N"',
    replace: 'value === null ? "NULL"',
    killedBy: tsvKeepsTheValues,
  },
  {
    name: "the column names are not escaped",
    law: "V34",
    file: tsv,
    find: "[columns.map(escaped), ",
    replace: "[columns, ",
    killedBy: tsvKeepsTheValues,
  },
  {
    name: "a name whose id was seen is listed again",
    law: "V35",
    file: names,
    find: ".filter((named) => !seenKeys.has(named.key))",
    replace: ".filter(() => true)",
    killedBy: everyIdOneRow,
  },
  {
    name: "a name whose id was not seen is left out",
    law: "V35",
    file: names,
    find: ".filter((named) => !seenKeys.has(named.key))",
    replace: ".filter(() => false)",
    killedBy: everyIdOneRow,
  },
  {
    name: "an id not seen counts no requests though the ids seen are cut",
    law: "V35",
    file: names,
    find: "row(named.key, whole ? 0 : null)",
    replace: "row(named.key, 0)",
    killedBy: everyIdOneRow,
  },
  {
    name: "an id seen loses its name",
    law: "V35",
    file: names,
    find: "...seen.map((each) => row(each.value, each.requests)),",
    replace:
      "...seen.map((each) => ({ ...row(each.value, each.requests), name: null })),",
    killedBy: everyIdOneRow,
  },
  {
    name: "Edge is not known, so it reads as Chrome",
    law: "V36",
    file: userAgent,
    find: '  ["Edge", /\\bEdg(?:e|A|iOS)?\\//],\n',
    replace: "",
    killedBy: userAgentNamed,
  },
  {
    name: "the last browser whose mark it holds is named",
    law: "V36",
    file: userAgent,
    find: "marks.find(([, mark]) => mark.test(userAgent))",
    replace: "marks.findLast(([, mark]) => mark.test(userAgent))",
    killedBy: userAgentNamed,
  },
  {
    name: "Android reads as Linux",
    law: "V36",
    file: userAgent,
    find: '  ["Android", /\\bAndroid\\b/],\n',
    replace: "",
    killedBy: userAgentNamed,
  },
  {
    name: "Firefox on an iPhone is not known",
    law: "V36",
    file: userAgent,
    find: "/\\b(?:Firefox|FxiOS)\\//",
    replace: "/\\bFirefox\\//",
    killedBy: userAgentNamed,
  },
  {
    name: "the connect script is read as a browser",
    law: "V36",
    file: userAgent,
    find: 'if (connectScript.test(userAgent)) return "The quota:connect script";',
    replace: "",
    killedBy: userAgentNamed,
  },
  {
    name: "a system alone is not said",
    law: "V36",
    file: userAgent,
    find: "if (system !== null) return `A browser on ${system}`;",
    replace: "",
    killedBy: userAgentNamed,
  },
  {
    name: "case is not ignored",
    law: "V37",
    file: palette,
    find: "return Array.from(lower).length === 1 ? lower : character;",
    replace: "return character;",
    killedBy: paletteLists,
  },
  {
    name: "a name that starts with the text is not listed first",
    law: "V37",
    file: palette,
    find: "if (inName === 0) return startsTheName;",
    replace: "if (inName === 0) return inTheName;",
    killedBy: paletteLists,
  },
  {
    name: "a candidate whose id alone holds the text is left out",
    law: "V37",
    file: palette,
    find: "return firstAt(folded(candidate.id), asked) === -1 ? null : inTheId;",
    replace: "return null;",
    killedBy: paletteLists,
  },
  {
    name: "an id that holds the text comes before a name that holds it",
    law: "V37",
    file: palette,
    find: "[startsTheName, inTheName, inTheId].flatMap",
    replace: "[startsTheName, inTheId, inTheName].flatMap",
    killedBy: paletteLists,
  },
  {
    name: "a candidate is listed again under every rank",
    law: "V37",
    file: palette,
    find: ".filter((each) => each.rank === rank)",
    replace: ".filter((each) => each.rank <= rank)",
    killedBy: paletteLists,
  },
  {
    name: "the whole text is lowercased at once, so a letter whose lowercase is longer moves every place after it",
    law: "V38",
    file: palette,
    find: "Array.from(text, (character) => {",
    replace: "Array.from(text.toLowerCase(), (character) => {",
    killedBy: paletteMarks,
  },
  {
    name: "the last place the text holds is marked",
    law: "V38",
    file: palette,
    find: "for (let at = 0; at + asked.length <= text.length; at++) {",
    replace: "for (let at = text.length - asked.length; at >= 0; at--) {",
    killedBy: paletteMarks,
  },
  {
    name: "the mark takes one character more than the text",
    law: "V38",
    file: palette,
    find: "const end = at + asked.length;",
    replace: "const end = at + asked.length + 1;",
    killedBy: paletteMarks,
  },
  {
    name: "an id that holds the text is not marked",
    law: "V38",
    file: palette,
    find: "id: piecesOf(candidate.id, asked),",
    replace: "id: piecesOf(candidate.id, []),",
    killedBy: paletteMarks,
  },
  {
    name: "a hub that keeps only a passkey is offered the password",
    law: "V39",
    file: waysIn,
    find: "password: ways.password,",
    replace: "password: ways.password || ways.passkey,",
    killedBy: theDoor,
  },
  {
    name: "a passkey is offered where this browser cannot use one",
    law: "V39",
    file: waysIn,
    find: "passkey: ways.passkey && passkeysHere,",
    replace: "passkey: ways.passkey,",
    killedBy: theDoor,
  },
  {
    name: "where a passkey works is said beside the password",
    law: "V39",
    file: waysIn,
    find: "passkeyElsewhere: ways.passkey && !passkeysHere && !ways.password,",
    replace: "passkeyElsewhere: ways.passkey && !passkeysHere,",
    killedBy: theDoor,
  },
  {
    name: "a hub not set up whose answer says a password is offered the password",
    law: "V39",
    file: waysIn,
    find: 'if (!ways.setUp) return { _tag: "SetUp" };',
    replace: 'if (!ways.setUp && !ways.password) return { _tag: "SetUp" };',
    killedBy: theDoor,
  },
  {
    name: "turning the password off is offered with no passkey",
    law: "V40",
    file: waysIn,
    find: ": passkeys > 0",
    replace: ": passkeys >= 0",
    killedBy: lastWayInKept,
  },
  {
    name: "the last passkey of a hub with no password is offered for removal",
    law: "V40",
    file: waysIn,
    find: 'removePasskey: passkeys > 1 || (passkeys === 1 && source !== "none"),',
    replace: "removePasskey: passkeys > 0,",
    killedBy: lastWayInKept,
  },
  {
    name: "the last passkey is never offered, even beside a password",
    law: "V40",
    file: waysIn,
    find: 'removePasskey: passkeys > 1 || (passkeys === 1 && source !== "none"),',
    replace: "removePasskey: passkeys > 1,",
    killedBy: lastWayInKept,
  },
  {
    name: "turning off is offered for the configuration's password",
    law: "V40",
    file: waysIn,
    find: 'source !== "hub-store"',
    replace: 'source === "none"',
    killedBy: lastWayInKept,
  },
  {
    name: "spaces are kept in the code sent",
    law: "V41",
    file: setupCode,
    find: '.replaceAll(/[-\\s]/g, "")',
    replace: '.replaceAll(/-/g, "")',
    killedBy: codeAsTheHubReadsIt,
  },
  {
    name: "a code typed in lower case is sent so",
    law: "V41",
    file: setupCode,
    find: "      .toUpperCase()\n",
    replace: "",
    killedBy: codeAsTheHubReadsIt,
  },
  {
    name: "O is sent as typed, not read as 0",
    law: "V41",
    file: setupCode,
    find: '      .replaceAll("O", "0")\n',
    replace: "",
    killedBy: codeAsTheHubReadsIt,
  },
  {
    name: "a code is cut at sixteen characters",
    law: "V41",
    file: setupCode,
    find: ".slice(0, codeLength)",
    replace: ".slice(0, codeLength + 4)",
    killedBy: codeAsTheHubReadsIt,
  },
  {
    name: "a code is written in groups of three",
    law: "V41",
    file: setupCode,
    find: "/.{1,4}/gu",
    replace: "/.{1,3}/gu",
    killedBy: codeAsTheHubReadsIt,
  },
  {
    name: "a password is counted in UTF-16 units",
    law: "V42",
    file: newPassword,
    find: "const length = [...text].length;",
    replace: "const length = text.length;",
    killedBy: passwordAsTheHubCounts,
  },
  {
    name: "a password of 11 characters fits",
    law: "V42",
    file: newPassword,
    find: "length >= shortest",
    replace: "length >= shortest - 1",
    killedBy: passwordAsTheHubCounts,
  },
  {
    name: "a password has no most",
    law: "V42",
    file: newPassword,
    find: " && length <= longest",
    replace: "",
    killedBy: passwordAsTheHubCounts,
  },
  {
    name: "a route moved takes its neighbour's place and drops it at the end",
    law: "V43",
    file: routeEdits,
    find: "[...list.slice(0, at), second, first, ...list.slice(at + 2)]",
    replace: "[...list.slice(0, at), second, ...list.slice(at + 2), first]",
    killedBy: editingKeepsTheOthers,
  },
  {
    name: "moving a route down moves it up",
    law: "V43",
    file: routeEdits,
    find: "  swapped(list, index);",
    replace: "  swapped(list, index - 1);",
    killedBy: editingKeepsTheOthers,
  },
  {
    name: "removing a route takes the one after it too",
    law: "V43",
    file: routeEdits,
    find: "list.filter((_, at) => at !== index)",
    replace: "list.filter((_, at) => at !== index && at !== index + 1)",
    killedBy: editingKeepsTheOthers,
  },
  {
    name: "an added route goes first",
    law: "V43",
    file: routeEdits,
    find: "[...list, route]",
    replace: "[route, ...list]",
    killedBy: editingKeepsTheOthers,
  },
  {
    name: "a list is sent though a route has no pool",
    law: "V44",
    file: routeEdits,
    find: "if (chosen.length < routes.length) {",
    replace: "if (chosen.length === 0 && routes.length > 0) {",
    killedBy: sentAsShown,
  },
  {
    name: "the default pool is not sent",
    law: "V44",
    file: routeEdits,
    find: "body: { revision, routes: chosen, defaultPool },",
    replace: "body: { revision, routes: chosen, defaultPool: null },",
    killedBy: sentAsShown,
  },
  {
    name: "the keys sent are in the wrong order",
    law: "V44",
    file: routeEdits,
    find: "keys: routes.map((route) => route.key),",
    replace: "keys: routes.map((route) => route.key).reverse(),",
    killedBy: sentAsShown,
  },
  {
    name: "a route with no pool is named by its index",
    law: "V44",
    file: routeEdits,
    find: "route.pool === null ? [index + 1] : []",
    replace: "route.pool === null ? [index] : []",
    killedBy: sentAsShown,
  },
  {
    name: "the default pool's refusal is said nowhere",
    law: "V45",
    file: routeEdits,
    find: "if (refusal.position === null) {",
    replace: "if (refusal.position === 0) {",
    killedBy: refusalOnItsRow,
  },
  {
    name: "a refusal is said on the row after its own",
    law: "V45",
    file: routeEdits,
    find: "const key = keyAt(refusal.position);",
    replace: "const key = keyAt(refusal.position + 1);",
    killedBy: refusalOnItsRow,
  },
  {
    name: "a shadowed route names a position, not the route sent there",
    law: "V45",
    file: routeEdits,
    find: "shadowedBy: keyAt(refusal.shadowedBy) ?? null,",
    replace: "shadowedBy: refusal.shadowedBy,",
    killedBy: refusalOnItsRow,
  },
  {
    name: "a refusal at a position nothing was sent at is dropped",
    law: "V45",
    file: routeEdits,
    find: "unplaced.push(refusal);",
    replace: "void refusal;",
    killedBy: refusalOnItsRow,
  },
  {
    name: "a select offers pools of every protocol",
    law: "V46",
    file: routeEdits,
    find: "pools.filter((pool) => pool.protocol === protocolOf(client))",
    replace: "pools.filter(() => true)",
    killedBy: poolsThatFit,
  },
  {
    name: "Codex is offered Claude Code's pools",
    law: "V46",
    file: routeEdits,
    find: 'client === "claude-code" ? "anthropic-messages" : "chatgpt-codex"',
    replace: '"anthropic-messages"',
    killedBy: poolsThatFit,
  },
  {
    name: "the pools are offered last first",
    law: "V46",
    file: routeEdits,
    find: "const fitting = pools.filter(",
    replace: "const fitting = [...pools].reverse().filter(",
    killedBy: poolsThatFit,
  },
  {
    name: "a chosen pool that does not fit is not kept",
    law: "V46",
    file: routeEdits,
    find: "        : chosen,",
    replace: "        : null,",
    killedBy: poolsThatFit,
  },
  {
    name: "the last pool is not shown",
    law: "V47",
    file: poolOrder,
    find: "[...pools].sort(orderings[order])",
    replace: "[...pools].sort(orderings[order]).slice(0, -1)",
    killedBy: poolsInOrder,
  },
  {
    name: "the pool with the least usage comes first",
    law: "V47",
    file: poolOrder,
    find: "b.usage - a.usage",
    replace: "a.usage - b.usage",
    killedBy: poolsInOrder,
  },
  {
    name: "pools of equal usage keep the order given",
    law: "V47",
    file: poolOrder,
    find: " || byName(a, b)",
    replace: "",
    killedBy: poolsInOrder,
  },
  {
    name: "names are compared with their case",
    law: "V47",
    file: poolOrder,
    find: "compared(a.name.toLowerCase(), b.name.toLowerCase())",
    replace: "compared(a.name, b.name)",
    killedBy: poolsInOrder,
  },
  {
    name: "pools of one name are not ordered by id",
    law: "V47",
    file: poolOrder,
    find: " || compared(a.id, b.id)",
    replace: "",
    killedBy: poolsInOrder,
  },
  {
    name: "the name order heeds usage",
    law: "V47",
    file: poolOrder,
    find: "name: byName }",
    replace: "name: byUsage }",
    killedBy: poolsInOrder,
  },
  {
    name: "pools equal in every key are shown last first",
    law: "V47",
    file: poolOrder,
    find: "[...pools].sort(",
    replace: "[...pools].reverse().sort(",
    killedBy: poolsInOrder,
  },
  {
    name: "the hashed files are read from the folder above the build",
    law: "P1",
    file: dashboardRoutes,
    find: "root: join(options.directory, hashed),",
    replace: 'root: join(options.directory, ".."),',
    killedBy: insideTheFolder,
  },
  {
    name: "only a path with an extension falls back to the index",
    law: "P2",
    file: dashboardRoutes,
    find: 'isNotFound(error) && extname(wanted) === ""',
    replace: 'isNotFound(error) && extname(wanted) !== ""',
    killedBy: screenReloads,
  },
  {
    name: "a path under the hub's own is answered from the build",
    law: "P3",
    file: dashboardRoutes,
    find: "if (wanted === undefined || isTheHubs(wanted)) {",
    replace: "if (wanted === undefined) {",
    killedBy: hubPathsStay,
  },
  {
    name: "the index is cached for a year",
    law: "P4",
    file: dashboardRoutes,
    find: "cacheControl: neverCached,",
    replace: "cacheControl: cachedForAYear,",
    killedBy: cachedByKind,
  },
  {
    name: "the hashed files are asked for again each time",
    law: "P4",
    file: dashboardRoutes,
    find: "cacheControl: cachedForAYear,",
    replace: "cacheControl: neverCached,",
    killedBy: cachedByKind,
  },
  {
    name: "matching is decided by chance",
    law: "N1",
    file: routeList,
    find: "const route = list.routes.find(({ pattern }) =>",
    replace:
      "const route = (Math.random() < 0.5 ? list.routes : []).find(({ pattern }) =>",
    killedBy: matchingTotal,
  },
  {
    name: "the last route that matches wins",
    law: "N2",
    file: routeList,
    find: "const route = list.routes.find(({ pattern }) =>",
    replace: "const route = list.routes.findLast(({ pattern }) =>",
    killedBy: firstMatchWins,
  },
  {
    name: "the default pool wins over a route that matches",
    law: "N3",
    file: routeList,
    find: 'if (route !== undefined) return { _tag: "Route", route };',
    replace:
      'if (route !== undefined && Option.isNone(list.defaultPool)) return { _tag: "Route", route };',
    killedBy: defaultWhenNothingMatches,
  },
  {
    name: "a project is compared as written, not lowercased",
    law: "N4",
    file: projectPattern,
    find: "const lowercased = project.toLowerCase();",
    replace: "const lowercased = project;",
    killedBy: caseNeverMatters,
  },
  {
    name: "an exact pattern shadows a later prefix pattern that starts with it",
    law: "N5",
    file: projectPattern,
    find: 'return later._tag === "Exact" && later.text === earlier.text;',
    replace:
      'return (later._tag === "Exact" ? later.text : later.stem).startsWith(earlier.text);',
    killedBy: shadowingExact,
  },
  {
    name: "a longer prefix pattern shadows a shorter one",
    law: "N5",
    file: projectPattern,
    find: 'return (later._tag === "Exact" ? later.text : later.stem).startsWith(\n    earlier.stem,\n  );',
    replace:
      'return earlier.stem.startsWith(later._tag === "Exact" ? later.text : later.stem);',
    killedBy: shadowingExact,
  },
  {
    name: "a shadowed route is stored",
    law: "N6",
    file: routeList,
    find: "} else if (shadowing !== undefined) {",
    replace: "} else if (shadowing !== undefined && shadowing.position < 0) {",
    killedBy: everyRouteCanWin,
  },
  {
    name: "a route whose pool speaks another protocol is stored",
    law: "N7",
    file: routeList,
    find: "if (Option.isSome(unfit)) refuse(Option.some(position), unfit.value);",
    replace:
      'if (Option.isSome(unfit) && unfit.value === "no-such-pool") refuse(Option.some(position), unfit.value);',
    killedBy: onlyFittingPools,
  },
  {
    name: "a default pool that does not fit is stored",
    law: "N7",
    file: routeList,
    find: "if (Option.isSome(defaultPool)) {",
    replace: "if (Option.isSome(defaultPool) && sent.length < 0) {",
    killedBy: onlyFittingPools,
  },
  {
    name: "a route whose pool is gone is skipped for the next",
    law: "N8",
    file: routeList,
    find: "const matched = match(list, project);",
    replace:
      'const matched = match({ ...list, routes: list.routes.filter((route) => fitOf(pools, client, route.pool)._tag === "Fits") }, project);',
    killedBy: neverSkipped,
  },
  {
    name: "a route that matches wins over the override",
    law: "N9",
    file: routeList,
    find: "if (Option.isSome(override)) {",
    replace:
      'if (Option.isSome(override) && match(list, project)._tag !== "Route") {',
    killedBy: overrideNamesItsPool,
  },
  {
    name: "a change from a stale revision replaces the list",
    law: "N10",
    file: sqliteRoutes,
    find: "WHERE client = ? AND revision = ?",
    replace: "WHERE client = ? AND ? IS NOT NULL",
    killedBy: onePerRevision,
  },
  {
    name: "a change from revision 0 replaces a list already stored",
    law: "N10",
    file: sqliteRoutes,
    find: "ON CONFLICT (client) DO NOTHING",
    replace: "ON CONFLICT (client) DO UPDATE SET revision = 1",
    killedBy: onePerRevision,
  },
  {
    name: "a change adds its routes to the list's instead of replacing them",
    law: "N10",
    file: sqliteRoutes,
    find: '.query("DELETE FROM routes WHERE client = ?")',
    replace: '.query("DELETE FROM routes WHERE client = ? AND 0")',
    killedBy: onePerRevision,
  },
  {
    name: "a pool a stored route names is closed to every hub key",
    law: "N11",
    file: admissionModule,
    find: admissionModuleHead,
    replace: `import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as MachineHandlers from "#modules/admission/01-presentation/machine.handlers.ts";
import * as AdmitRequest from "#modules/admission/02-application/queries/admit-request.query.ts";
import * as IdentifyHubKey from "#modules/admission/02-application/queries/identify-hub-key.query.ts";
import * as ReadMachine from "#modules/admission/02-application/queries/read-machine.query.ts";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";
import { HubStore } from "#shared/04-infrastructure/hub-store/hub-store.ts";

const routed = Layer.effect(
  AdmitRequest.AdmitRequest,
  Effect.gen(function* () {
    const admit = yield* AdmitRequest.AdmitRequest;
    const store = yield* HubStore;
    return AdmitRequest.AdmitRequest.of({
      execute: (presented) =>
        Effect.gen(function* () {
          const decision = yield* admit.execute(presented);
          const named = yield* store
            .use((database) => database.query("SELECT 1 FROM routes WHERE pool = ?").all(presented.pool).length > 0)
            .pipe(Effect.orElseSucceed(() => false));
          return named ? { _tag: "Rejected" as const, reason: "WrongScope" as const } : decision;
        }),
    });
  }),
);

/** Admission under the given policy: its hub keys, and its pools' kinds. */
export const layer = (policy: Admission.Policy) =>
  Layer.merge(routed.pipe(Layer.provide(AdmitRequest.layer(policy))), IdentifyHubKey.layer(policy)).pipe(`,
    killedBy: routesOpenNothing,
  },
  {
    name: "doctor takes a client a package manager linked to its own script for another gateway's wrapper",
    file: cliDoctor,
    find: "      if (yield* files.isLink(path)) return false;",
    replace: "      if (yield* files.isLink(path)) return true;",
    killedBy:
      "doctor exits 0 on a healthy machine, and --json prints every check with no problem or fix, and where each client was found",
  },
  {
    name: "doctor takes another gateway's wrapper script on PATH for the client",
    file: cliDoctor,
    find: '      return Option.exists(head, (text) => text.startsWith("#!"));',
    replace: "      return Option.exists(head, () => false);",
    killedBy:
      "doctor names where each client was found, and warns of one that is a script, as another gateway's wrapper left on PATH is, with a fix that only shows it, never one that removes it",
  },
  {
    name: "doctor tells the owner to remove a client's script it found",
    file: cliDoctor,
    find: '          `head -n 20 ${scripts.map(quoted).join(" ")} to see which',
    replace: '          `rm ${scripts.map(quoted).join(" ")} to see which',
    killedBy:
      "doctor names where each client was found, and warns of one that is a script, as another gateway's wrapper left on PATH is, with a fix that only shows it, never one that removes it",
  },
  {
    name: "doctor takes a home directory of dotfiles under Git for a checkout the shims' cota is inside",
    file: cliDoctor,
    find: '        if (home !== "" && directory === home) break;\n',
    replace: "",
    killedBy:
      "doctor does not take a home directory that is a Git repository, as one of dotfiles is, for a checkout the shims' cota is inside",
  },
  {
    name: "doctor takes the first directory above the shims' cota without a .git for its checkout",
    file: cliDoctor,
    find: "        if (Option.isSome(git)) return Option.some(directory);",
    replace: "        if (Option.isNone(git)) return Option.some(directory);",
    killedBy:
      "doctor warns when the cota the shims run is inside a Git checkout, where a rebuild or a git clean changes what every launch runs, and still checks PATH",
  },
  {
    name: "doctor skips the PATH check when the shims' cota is inside a Git checkout",
    file: cliDoctor,
    find: "        installed: true,\n        outcome: Check.warned(",
    replace: "        installed: false,\n        outcome: Check.warned(",
    killedBy:
      "doctor warns when the cota the shims run is inside a Git checkout, where a rebuild or a git clean changes what every launch runs, and still checks PATH",
  },
  {
    name: "a not-joined machine's config check names no fix",
    law: "J14",
    file: cliDoctor,
    find: "      const fix = joinCommand(Option.none());",
    replace: '      const fix = "";',
    killedBy: j14,
  },
  {
    name: "the hub check names no fix",
    law: "J14",
    file: cliDoctor,
    find: "      const fix = `check the address and the network; ${joinCommand(Option.some(configuration))} to change it`;",
    replace: '      const fix = "";',
    killedBy: j14,
  },
  {
    name: "the warning of no keyed hub key names no fix",
    law: "J14",
    file: cliDoctor,
    find: "          `${fix}, with a keyed hub key among the keys`,",
    replace: '          "",',
    killedBy: j14,
  },
  {
    name: "the files check names no chmod",
    law: "J14",
    file: cliDoctor,
    find: "          .map(({ path, wanted }) => `chmod ${octal(wanted)} ${quoted(path)}`)",
    replace: '          .map(() => "")',
    killedBy: j14,
  },
  {
    name: "a failed check says nothing of what is wrong",
    law: "J14",
    file: cliCheck,
    find: '  outcome: "failed",\n  problem,',
    replace: '  outcome: "failed",\n  problem: "",',
    killedBy: j14,
  },
  {
    name: "a relative XDG directory is used",
    law: "J15",
    file: cliPaths,
    find: '  const absolute = (value: string) => value.startsWith("/");',
    replace: '  const absolute = (value: string) => value !== "";',
    killedBy: j15,
  },
  {
    name: "the state on Windows is not under state",
    law: "J15",
    file: cliPaths,
    find: '    state: join(state, ...(separator === "\\\\" ? ["cota", "state"] : ["cota"])),',
    replace: '    state: join(state, "cota"),',
    killedBy: j15,
  },
  {
    name: "a trailing slash is kept",
    law: "J15",
    file: cliPaths,
    find: '  "/": /\\/+$/,',
    replace: '  "/": /^$/,',
    killedBy: j15,
  },
  {
    name: "the state's default is the data's",
    law: "J15",
    file: cliPaths,
    find: '  const state = xdg("XDG_STATE_HOME", ".local/state");',
    replace: '  const state = xdg("XDG_STATE_HOME", ".local/share");',
    killedBy: j15,
  },
  {
    name: "the state on Windows is under APPDATA",
    law: "J15",
    file: cliPaths,
    find: '    return Result.succeed(pathsIn("\\\\", roaming, local, local));',
    replace:
      '    return Result.succeed(pathsIn("\\\\", roaming, roaming, local));',
    killedBy: j15,
  },
  {
    name: "an empty variable gives a directory",
    law: "J15",
    file: cliPaths,
    find: '  return value !== undefined && value !== "" && isUsable(value)',
    replace: "  return value !== undefined && isUsable(value)",
    killedBy: j15,
  },
  {
    name: "::1 is not loopback",
    law: "J16",
    file: cliHubAddress,
    find: '  host === "localhost" || host === "[::1]" || ipv4Loopback.test(host);',
    replace: '  host === "localhost" || ipv4Loopback.test(host);',
    killedBy: j16,
  },
  {
    name: "only 127.0.0.1 is loopback",
    law: "J16",
    file: cliHubAddress,
    find: "const ipv4Loopback = /^127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$/;",
    replace: "const ipv4Loopback = /^127\\.0\\.0\\.1$/;",
    killedBy: j16,
  },
  {
    name: "a password without a user name is kept",
    law: "J16",
    file: cliHubAddress,
    find: '  if (url.username !== "" || url.password !== "") {',
    replace: '  if (url.username !== "") {',
    killedBy: j16,
  },
  {
    name: "plain http is allowed without being asked",
    law: "J16",
    file: cliHubAddress,
    find: "    !allowPlainHttp &&\n",
    replace: "",
    killedBy: j16,
  },
  {
    name: "a query is kept",
    law: "J16",
    file: cliHubAddress,
    find: '    url.search !== "" ||\n',
    replace: "",
    killedBy: j16,
  },
  {
    name: "the whole URL is kept",
    law: "J16",
    file: cliHubAddress,
    find: "  return Result.succeed(HubAddress.make(url.origin));",
    replace: "  return Result.succeed(HubAddress.make(url.href));",
    killedBy: j16,
  },
  {
    name: "a refusal repeats the user name",
    law: "J16",
    file: cliHubAddress,
    find: "      `${url.host} is given with a user name or password",
    replace:
      "      `${url.username}@${url.host} is given with a user name or password",
    killedBy: j16,
  },
  {
    name: "two keys of one scope are kept",
    law: "J17",
    file: cliJoin,
    find: "    if (first !== undefined) {",
    replace: "    if (first !== undefined && first.place < 0) {",
    killedBy: j17,
  },
  {
    name: "a key the hub does not know is let through",
    law: "J17",
    file: cliJoin,
    find: "      problems.push(`the hub does not know ${key}`);",
    replace: "",
    killedBy: j17,
  },
  {
    name: "a key the hub could not say anything about is let through",
    law: "J17",
    file: cliJoin,
    find: "      problems.push(`the hub could not say what ${key} is`);",
    replace: "",
    killedBy: j17,
  },
  {
    name: "an unreachable hub is taken as a keyed key",
    law: "J17",
    file: cliJoinMachine,
    find: "            return yield* stop(`${hubAddress} cannot be reached`);",
    replace: '            answers.push({ _tag: "Known", scope: "keyed" });',
    killedBy: j17,
  },
  {
    name: "only the keys the hub knows are judged",
    law: "J17",
    file: cliJoinMachine,
    find: "        const toKeep = Join.keysToKeep(answers);",
    replace:
      '        const toKeep = Join.keysToKeep(\n          answers.filter((answer) => answer._tag === "Known"),\n        );',
    killedBy: j17,
  },
  {
    name: "an unreachable hub's refusal names the key",
    law: "J9",
    file: cliJoinMachine,
    find: "            return yield* stop(`${hubAddress} cannot be reached`);",
    replace:
      "            return yield* stop(`${hubAddress} cannot be reached with ${key}`);",
    killedBy: j9,
  },
  {
    name: "a stopped join prints the keys it was given",
    law: "J9",
    file: cliJoinMachine,
    find: "        if (Result.isFailure(toKeep)) return yield* stop(...toKeep.failure);",
    replace:
      "        if (Result.isFailure(toKeep)) {\n          return yield* stop(...toKeep.failure, ...keys);\n        }",
    killedBy: j9,
  },
  {
    name: "a project keeps its case",
    law: "J1",
    file: cliProject,
    find: '    .replace(/\\.git$/i, "")\n    .toLowerCase();',
    replace: '    .replace(/\\.git$/i, "");',
    killedBy: j1,
  },
  {
    name: "a project keeps an upper-case .GIT",
    law: "J1",
    file: cliProject,
    find: '    .replace(/\\.git$/i, "")',
    replace: '    .replace(/\\.git$/, "")',
    killedBy: j1,
  },
  {
    name: ".git is cut before the trailing slash",
    law: "J1",
    file: cliProject,
    find: '    .replace(/\\/+$/, "")\n    .replace(/\\.git$/i, "")',
    replace: '    .replace(/\\.git$/i, "")\n    .replace(/\\/+$/, "")',
    killedBy: j1,
  },
  {
    name: "an upper-case scheme is not read",
    law: "J1",
    file: cliProject,
    find: "const schemeForm = /^(https?|ssh|git):\\/\\/([^/]*)(\\/.*)?$/i;",
    replace: "const schemeForm = /^(https?|ssh|git):\\/\\/([^/]*)(\\/.*)?$/;",
    killedBy: j1,
  },
  {
    name: "the short form reads its user as the host",
    law: "J2",
    file: cliProject,
    find: "const shortForm = /^(?:[^@/]+@)?(\\[[^\\]/]+\\]|[^@/:[\\]]{2,}):(.*)$/;",
    replace: "const shortForm = /^(\\[[^\\]/]+\\]|[^/:[\\]]{2,}):(.*)$/;",
    killedBy: j2,
  },
  {
    name: "the scheme form reads its authority into the project",
    law: "J2",
    file: cliProject,
    find: '  if (url !== null) return projectOfPath(url[3] ?? "");',
    replace:
      '  if (url !== null) return projectOfPath(`${url[2] ?? ""}${url[3] ?? ""}`);',
    killedBy: j2,
  },
  {
    name: "any own pool is spent with the own login",
    law: "J6",
    file: cliLaunch,
    find: '    if (Option.contains(own, pool.id)) return { _tag: "Own" };',
    replace: '    if (Option.isSome(own)) return { _tag: "Own" };',
    killedBy: j6,
  },
  {
    name: "a machine login of another pool is spent",
    law: "J6",
    file: cliLaunch,
    find: "    const login = machine.logins.get(pool.id);",
    replace: "    const login = machine.logins.values().next().value;",
    killedBy: j6,
  },
  {
    name: "the person's own login variables are kept",
    law: "J6",
    file: cliLaunch,
    find: "  const set = without(variables, loginVariables);",
    replace: "  const set = without(variables, []);",
    killedBy: j6,
  },
  {
    name: "Codex with an own pool spends a machine login",
    law: "J6",
    file: cliLaunch,
    find: '    if (command === "codex") {\n      return `cota: ${project} bills ${pool.id}, and Codex',
    replace:
      '    if (command === "codex" && Option.isNone(own)) {\n      return `cota: ${project} bills ${pool.id}, and Codex',
    killedBy: j6,
  },
  {
    name: "a keyed pool goes direct when the machine has a keyed key",
    law: "J7",
    file: cliLaunch,
    find: '    if (kept.pool.kind === "keyed") {',
    replace: '    if (kept.pool.kind === "keyed" && Option.isNone(keyed)) {',
    killedBy: j7,
  },
  {
    name: "Claude Code reaches a keyed pool without the hub's address",
    law: "J7",
    file: cliLaunch,
    find: "    variables.ANTHROPIC_BASE_URL = `${hub}/pools/${pool.id}`;",
    replace:
      '    if (pool.kind === "subscription") {\n      variables.ANTHROPIC_BASE_URL = `${hub}/pools/${pool.id}`;\n    }',
    killedBy: j7,
  },
  {
    name: "Codex reaches a keyed pool without its provider",
    law: "J7",
    file: cliLaunch,
    find: '        ["-c", `model_provider="cota-${pool.id}"`, ...given.args],',
    replace:
      '        pool.kind === "keyed"\n          ? given.args\n          : ["-c", `model_provider="cota-${pool.id}"`, ...given.args],',
    killedBy: j7,
  },
  {
    name: "the bypass on a joined machine goes through the hub",
    law: "J8",
    file: cliLaunch,
    find: "  if (isBypass(given.variables) || Option.isNone(launch.machine)) {",
    replace: "  if (Option.isNone(launch.machine)) {",
    killedBy: j8,
  },
  {
    name: "the bypass loses PATH",
    law: "J8",
    file: cliLaunch,
    find: "      args: given.args,\n      variables: given.variables,",
    replace:
      '      args: given.args,\n      variables: { ...given.variables, PATH: "" },',
    killedBy: j8,
  },
  {
    name: "Codex is given the subscription hub key as an argument",
    law: "J9",
    file: cliLaunch,
    find: '        ["-c", `model_provider="cota-${pool.id}"`, ...given.args],',
    replace:
      '        [\n          "-c",\n          `model_provider="cota-${pool.id}"`,\n          ...Option.match(machine.hubKeys.subscription, {\n            onNone: () => [],\n            onSome: (key) => [\n              "-c",\n              `model_providers.cota-${pool.id}.http_headers.x-cota-key="${Redacted.value(key)}"`,\n            ],\n          }),\n          ...given.args,\n        ],',
    killedBy: j9,
  },
  {
    name: "the comment above the owner's next table is taken for cota's",
    law: "J3",
    file: cliCodex,
    find: '    while (end > index + 2 && isBlankOrComment(lines[end - 1] ?? "")) end--;\n',
    replace: "",
    killedBy: j3,
  },
  {
    name: "the line before a table of cota's is taken for cota's",
    law: "J3",
    file: cliCodex,
    find: "      !tables.some(({ start, end }) => index >= start && index < end),",
    replace:
      "      !tables.some(({ start, end }) => index >= start - 1 && index < end),",
    killedBy: j3,
  },
  {
    name: "a JSON provider whose name starts like cota's is taken for one",
    law: "J3",
    file: cliJsonFile,
    find: "      if (!key.startsWith(providerPrefix)) return [[key, value]];",
    replace: '      if (!key.startsWith("cota")) return [[key, value]];',
    killedBy: j3,
  },
  {
    name: "the blank line before cota's marker is left behind",
    law: "J4",
    file: cliCodex,
    find: '    const start =\n      index > 0 && (lines[index - 1] ?? "").trim() === "" ? index - 1 : index;',
    replace: "    const start = index;",
    killedBy: j4,
  },
  {
    name: "Codex's file gains a blank line at its end",
    law: "J4",
    file: cliCodex,
    find: 'const after = out.length === 0 ? "" : `${out.join("\\n")}\\n`;',
    replace:
      'const after = out.length === 0 ? "" : `${out.join("\\n")}\\n\\n`;',
    killedBy: j4,
  },
  {
    name: "a stale provider of cota's is kept",
    law: "J5",
    file: cliJsonFile,
    find: "      return entry === undefined\n        ? []",
    replace: "      return entry === undefined\n        ? [[key, value]]",
    killedBy: j5,
  },
  {
    name: "a pool whose listing failed loses the models last written for it",
    law: "J5",
    file: cliJsonFile,
    find: "  return Option.getOrElse(last, () => written(models.fallback));",
    replace:
      "  return Option.getOrElse(\n    Option.filter(last, () => false),\n    () => written(models.fallback),\n  );",
    killedBy: j5,
  },
  {
    name: "Pi's model is written under its name",
    law: "J5",
    file: cliPi,
    find: "  id: model.id,\n  name: model.name,",
    replace: "  id: model.name,\n  name: model.name,",
    killedBy: j5,
  },
  {
    name: "the shims' directory is compared with its case",
    law: "J18",
    file: cliUserPath,
    find: '  const normal = (each: string) => each.replace(/[\\\\/]+$/, "").toLowerCase();',
    replace:
      '  const normal = (each: string) => each.replace(/[\\\\/]+$/, "");',
    killedBy: j18,
  },
  {
    name: "the shims go last in the user's Path",
    law: "J18",
    file: cliUserPath,
    find: '  [\n    shims,\n    ...entriesOf(path).filter((entry) => !sameDirectory(entry, shims)),\n  ].join(";");',
    replace:
      '  [\n    ...entriesOf(path).filter((entry) => !sameDirectory(entry, shims)),\n    shims,\n  ].join(";");',
    killedBy: j18,
  },
  {
    name: "the user's Path loses its empty entries",
    law: "J18",
    file: cliUserPath,
    find: '  path === "" ? [] : path.split(";");',
    replace: '  path.split(";").filter((entry) => entry !== "");',
    killedBy: j18,
  },
  {
    name: "cota's old line is kept where it was",
    law: "J10",
    file: cliShims,
    find: '`${[...linesOf(text).filter((each) => !isPathLine(each)), line].join("\\n")}\\n`',
    replace: '`${[...linesOf(text), line].join("\\n")}\\n`',
    killedBy: j10,
  },
  {
    name: "cota's line goes first",
    law: "J10",
    file: cliShims,
    find: '`${[...linesOf(text).filter((each) => !isPathLine(each)), line].join("\\n")}\\n`',
    replace:
      '`${[line, ...linesOf(text).filter((each) => !isPathLine(each))].join("\\n")}\\n`',
    killedBy: j10,
  },
  {
    name: "any line naming cota is taken for its line",
    law: "J10",
    file: cliShims,
    find: "const isPathLine = (line: string) => line.trimEnd().endsWith(pathLineMarker);",
    replace: 'const isPathLine = (line: string) => line.includes("cota");',
    killedBy: j10,
  },
  {
    name: "empty lines are dropped",
    law: "J10",
    file: cliShims,
    find: '  text === "" ? [] : text.replace(/\\n$/, "").split("\\n");',
    replace: '  text.split("\\n").filter((each) => each !== "");',
    killedBy: j10,
  },
  {
    name: "a line still being written is read, and lost",
    law: "J11",
    file: cliTitles,
    find: "  const length = bytes.lastIndexOf(lineFeed) + 1;",
    replace: "  const length = bytes.length;",
    killedBy: j11,
  },
  {
    name: "a file written again shorter is read on from the old offset",
    law: "J11",
    file: cliTitles,
    find: "): Read => (size < kept.offset ? unread : kept);",
    replace: "): Read => kept;",
    killedBy: j11,
  },
  {
    name: "a transcript's offset counts characters, not bytes",
    law: "J11",
    file: cliTitles,
    find: "  const { lines, length } = linesOf(bytes);\n  let { custom, ai } = kept;",
    replace:
      "  const { lines } = linesOf(bytes);\n  const length = lines.reduce((sum, line) => sum + line.length + 1, 0);\n  let { custom, ai } = kept;",
    killedBy: j11,
  },
  {
    name: "Codex's earlier name for a session wins",
    law: "J11",
    file: cliTitles,
    find: "      names.set(id, thread_name);",
    replace: "      if (!names.has(id)) names.set(id, thread_name);",
    killedBy: j11,
  },
  {
    name: "a batch not kept is recorded as kept",
    law: "J12",
    file: cliReportTitles,
    find: "            if (Result.isFailure(sent)) {",
    replace:
      "            state = { ...state, sent: Titles.keptAfter(state.sent, batch) };\n            yield* save(state);\n            if (Result.isFailure(sent)) {",
    killedBy: j12,
  },
  {
    name: "a run goes on past a batch not kept",
    law: "J12",
    file: cliReportTitles,
    find: "              problems.push(sendProblem(hub, sent.failure));\n              break;",
    replace:
      "              problems.push(sendProblem(hub, sent.failure));\n              continue;",
    killedBy: j12,
  },
  {
    name: "a kept batch is not recorded",
    law: "J12",
    file: cliReportTitles,
    find: "            state = { ...state, sent: Titles.keptAfter(state.sent, batch) };",
    replace: "",
    killedBy: j12,
  },
  {
    name: "every title is sent, changed or not",
    law: "J12",
    file: cliTitles,
    find: "    ([session, title]) => sent.get(session) !== title,",
    replace: "    () => true,",
    killedBy: j12,
  },
  {
    name: "a title that went and came back is taken as still kept",
    law: "J12",
    file: cliTitles,
    find: "  new Map([...sent].filter(([session]) => titles.has(session)));",
    replace: "  new Map(sent);",
    killedBy: j12,
  },
  {
    name: "a batch holds one title more than its size",
    law: "J12",
    file: cliTitles,
    find: "    batches.push(new Map(changed.slice(start, start + size)));",
    replace:
      "    batches.push(new Map(changed.slice(start, start + size + 1)));",
    killedBy: j12,
  },
  {
    name: "Claude Code's owner name comes before T3 Code's",
    law: "J13",
    file: cliTitles,
    find: "  for (const title of [found.t3, found.custom, found.ai, found.codex]) {",
    replace:
      "  for (const title of [found.custom, found.t3, found.ai, found.codex]) {",
    killedBy: j13,
  },
  {
    name: "an empty title is sent",
    law: "J13",
    file: cliTitles,
    find: '    if (kept !== "") return Option.some(kept);',
    replace: "    return Option.some(kept);",
    killedBy: j13,
  },
  {
    name: "a title is cut in UTF-16 code units",
    law: "J13",
    file: cliTitles,
    find: '  [...text.toWellFormed().trim()].slice(0, longestTitle).join("").trimEnd();',
    replace: "  text.toWellFormed().trim().slice(0, longestTitle).trimEnd();",
    killedBy: j13,
  },
  {
    name: "a title cut after a space keeps it",
    law: "J13",
    file: cliTitles,
    find: '  [...text.toWellFormed().trim()].slice(0, longestTitle).join("").trimEnd();',
    replace:
      '  [...text.toWellFormed().trim()].slice(0, longestTitle).join("");',
    killedBy: j13,
  },
  {
    name: "a title with half a surrogate pair is sent as it is",
    law: "J13",
    file: cliTitles,
    find: '  [...text.toWellFormed().trim()].slice(0, longestTitle).join("").trimEnd();',
    replace: '  [...text.trim()].slice(0, longestTitle).join("").trimEnd();',
    killedBy: j13,
  },
  {
    name: "a reporter check's failed last run names no fix",
    law: "J14",
    file: cliDoctor,
    find: "        fixes.push(`fix what that says, then cota ${reporter} report`);",
    replace: "",
    killedBy: j14,
  },
  {
    name: "a reporter check's missing schedule names no fix",
    law: "J14",
    file: cliDoctor,
    find: "        problems.push(`the ${named} is not scheduled`);\n        fixes.push(reschedule);",
    replace: "        problems.push(`the ${named} is not scheduled`);",
    killedBy: j14,
  },
  {
    name: "the title reporter's schedule carries every variable",
    law: "J9",
    file: cliSchedule,
    find: "  carried.flatMap((name) => {",
    replace: "  Object.keys(variables).flatMap((name) => {",
    killedBy: j9,
  },
  {
    name: "an install eval with no criterion read passes",
    law: "E1",
    file: installCriteria,
    find: "  verdicts.length > 0 && verdicts.every(({ passed }) => passed);",
    replace: "  verdicts.every(({ passed }) => passed);",
    killedBy: e1,
  },
  {
    name: "an install eval passes when one criterion passes",
    law: "E1",
    file: installCriteria,
    find: "  verdicts.length > 0 && verdicts.every(({ passed }) => passed);",
    replace: "  verdicts.length > 0 && verdicts.some(({ passed }) => passed);",
    killedBy: e1,
  },
  {
    name: "a doctor that printed nothing readable passes",
    law: "E2",
    file: installCriteria,
    find: "      if (isUnread(report)) return [`${name}: ${report.unread}`];",
    replace: "      if (isUnread(report)) return [];",
    killedBy: e2,
  },
  {
    name: "a home not read passes untouched",
    law: "E2",
    file: installCriteria,
    find: "      if (isUnread(home)) return [`${name}: ${home.unread}`];",
    replace: "      if (isUnread(home)) return [];",
    killedBy: e2,
  },
  {
    name: "a client that announces another tool starts",
    law: "E3",
    file: installClient,
    find: "  if (extra.length === 0 && missing.length === 0) return null;",
    replace: "  if (missing.length === 0) return null;",
    killedBy: e3,
  },
  {
    name: "a client that lacks one of the eval's tools starts",
    law: "E3",
    file: installClient,
    find: "  if (extra.length === 0 && missing.length === 0) return null;",
    replace: "  if (extra.length === 0) return null;",
    killedBy: e3,
  },
  {
    name: "the agent is given the task whatever its context holds",
    law: "E3",
    file: installAgent,
    find: '            if (refusal !== null) {\n              killGroup("SIGTERM");',
    replace:
      '            if (refusal === "never") {\n              killGroup("SIGTERM");',
    killedBy: neverGivenTheTask,
  },
  {
    name: "an agent whose start announces another tool goes on",
    law: "E3",
    file: installAgent,
    find: "            const refusal = refusalOf(line.tools);",
    replace: "            const refusal = refusalOf([...allowedTools]);",
    killedBy: stoppedAtItsStart,
  },
  {
    name: "an installer stopped at a limit passes ended",
    law: "E4",
    file: installCriteria,
    find: '    observed.ending === "done"\n      ? []',
    replace:
      '    observed.ending === "done" ||\n    (observed.ending === "stopped" && observed.error !== null)\n      ? []',
    killedBy: e4,
  },
  {
    name: "an agent goes on past its turn limit",
    law: "E4",
    file: installAgent,
    find: "            if (seen.size > options.turns)",
    replace: "            if (seen.size > options.turns * 10)",
    killedBy: stoppedAtItsLimits,
  },
  {
    name: "an agent past its spend limit is done",
    law: "E4",
    file: installAgent,
    find: '              line.subtype === "error_max_budget_usd" ||\n              (line.costUsd ?? 0) > options.budgetUsd',
    replace: "              false",
    killedBy: stoppedAtItsLimits,
  },
  {
    name: "a last message that holds the word anywhere in its first line says it is done",
    law: "E5",
    file: installAgent,
    find: "  if (first === doneWord) return null;",
    replace: "  if (first.includes(doneWord)) return null;",
    killedBy: e5,
  },
  {
    name: "an agent that ends its turn is done whatever it said",
    law: "E5",
    file: installAgent,
    find: "            return end(unfinished === null ? null : new Unfinished(unfinished));",
    replace:
      "            return end(unfinished !== doneWord ? null : new Unfinished(unfinished));",
    killedBy: saidItWasDone,
  },
  {
    name: "an installer that ended without saying it was done passes ended",
    law: "E5",
    file: installCriteria,
    find: '    observed.ending === "done"\n      ? []',
    replace:
      '    observed.ending === "done" ||\n    (observed.ending === "unfinished" && observed.error !== null)\n      ? []',
    killedBy: e5,
  },
  {
    name: "ClickHouse's password in the Compose file's environment",
    law: "Y3",
    file: deployCompose,
    find: "      CLICKHOUSE_PASSWORD_FILE: /etc/cota/secrets/clickhouse\n",
    replace: "      CLICKHOUSE_PASSWORD: throwaway-dev-password\n",
    killedBy: y3,
  },
  {
    name: "ClickHouse starts without its password file",
    law: "Y3",
    file: deployCompose,
    find: "          exit 1\n        fi\n",
    replace: "        fi\n",
    killedBy: y3,
  },
  {
    name: "the secrets mounted writable into the hub",
    law: "Y4",
    file: deployCompose,
    find: "        target: /etc/cota/secrets\n        read_only: true\n",
    replace: "        target: /etc/cota/secrets\n",
    killedBy: y4,
  },
  {
    name: "a hub key read from the hub's environment",
    law: "Y4",
    file: deployConfig,
    find: 'secret = { file = "/etc/cota/secrets/agents" }',
    replace: 'secret = { env = "COTA_HUB_KEY_AGENTS" }',
    killedBy: y4,
  },
  {
    name: "ClickHouse published on a port of the host",
    law: "Y5",
    file: deployCompose,
    find: "    ulimits:\n",
    replace: "    ports:\n      - 127.0.0.1:18123:8123\n    ulimits:\n",
    killedBy: y5,
  },
  {
    name: "the hub published on every interface by default",
    law: "Y5",
    file: deployCompose,
    find: "${COTA_BIND:-127.0.0.1}",
    replace: "${COTA_BIND:-0.0.0.0}",
    killedBy: y5,
  },
  {
    name: "the source's log is merged before a day is read",
    law: "Z1",
    file: importSource,
    find: "const params = { day: Param.string(day) };",
    replace:
      "const params = { day: Param.string(day) };\n            yield* client.command(`OPTIMIZE TABLE ${logs} FINAL`);",
    killedBy: z1,
  },
  {
    name: "the import's tables are made in the log's database, not as its session's",
    law: "Z2",
    file: logArchive,
    find: "`CREATE TEMPORARY TABLE archive_${table} ENGINE",
    replace: "`CREATE TABLE IF NOT EXISTS archive_${table} ENGINE",
    killedBy: z2,
  },
  {
    name: "an item is added though the log holds an earlier copy of it",
    law: "Z3",
    file: logArchive,
    find: "items: `(session, digest, first_seen, request_id) NOT IN (",
    replace: "items: `1 OR (session, digest, first_seen, request_id) NOT IN (",
    killedBy: z3,
  },
  {
    name: "a request is added though the log holds its id",
    law: "Z4",
    file: logArchive,
    find: "requests: `id NOT IN (",
    replace: "requests: `1 OR id NOT IN (",
    killedBy: z4,
  },
  {
    name: "a request's id is random, not its source id's",
    law: "Z5",
    file: importDomain,
    find: "stampedIdOf(`cota-import:bifrost:${sourceId}`, startedAt)",
    replace: "stampedIdOf(crypto.randomUUID(), startedAt)",
    killedBy: z5,
  },
  {
    name: "a request item with no request is neither carried nor counted",
    law: "Z6",
    file: importDomain,
    find: "else withoutRequest++;",
    replace: "else withoutRequest += 0;",
    killedBy: z6,
  },
  {
    name: "the import takes a source answer its user's profile cut short at its row cap",
    law: "Z6",
    file: clickHouseClient,
    find: '  max_result_rows: "0",\n  max_result_bytes: "0",\n',
    replace: "",
    killedBy: z6Capped,
  },
  {
    name: "the import takes a source answer its user's profile cut short at its cap on rows read",
    law: "Z6",
    file: clickHouseClient,
    find: '  read_overflow_mode: "throw",\n',
    replace: "",
    killedBy: z6ReadCapped,
  },
  {
    name: "an archive session's selects are stopped at 30 seconds, as a dashboard's read is",
    file: logArchive,
    find: "clickHouse.session(crypto.randomUUID(), timeout, longestCheck)",
    replace: "clickHouse.session(crypto.randomUUID(), timeout)",
    killedBy:
      "every select of the import's session is stopped by ClickHouse after 10 minutes, as its add is, and every other select after 30 seconds",
  },
  {
    name: "a list sent to the source is not cut by its size",
    law: "Z6",
    file: clickHouseClient,
    find: "if (list.length > 0 && size + more > longestList) {",
    replace: "if (list.length > 0 && size + more > Number.POSITIVE_INFINITY) {",
    killedBy: z6LongKeys,
  },
  {
    name: "a day's requests are added before its items",
    law: "Z7",
    file: importDays,
    find: "      for (const table of Archive.tables) {\n        added[table]",
    replace:
      "      for (const table of [...Archive.tables].reverse()) {\n        added[table]",
    killedBy: z7,
  },
  {
    name: "a day whose requests name items the log does not hold is added",
    law: "Z7",
    file: importDays,
    find: "if (unresolved > 0) {",
    replace: "if (unresolved > 1_000_000) {",
    killedBy: z7,
  },
  {
    name: "a request's tools and input are swapped",
    law: "Z8",
    file: importDomain,
    find: "const [tools = [], input = [], output = []] = resolved.value;",
    replace: "const [input = [], tools = [], output = []] = resolved.value;",
    killedBy: z8,
  },
  {
    name: "the source's cost is kept",
    law: "Z9",
    file: importDomain,
    find: "  const cost = Option.isSome(reported)",
    replace:
      "  const kept = Option.map(row.cost, (dollars) => BigInt(Math.round(dollars * 1e12)));\n  const cost = Option.isSome(kept) ? kept : Option.isSome(reported)",
    killedBy: z9,
  },
  {
    name: "split cache writes are all short-lived as well as split",
    law: "Z9",
    file: importDomain,
    find: "cacheWriteShort: splitWrites ? shortWrites : writes,",
    replace: "cacheWriteShort: writes,",
    killedBy: z9,
  },
  {
    name: "a dry run adds to the log",
    law: "Z10",
    file: importDays,
    find: "log.importing(options.dryRun)",
    replace: "log.importing(false)",
    killedBy: z10,
  },
  {
    name: "a day whose source changed while it was read is added",
    law: "Z11",
    file: importDays,
    find: "const after = yield* read(source.summary(day));",
    replace: "const after = before;",
    killedBy: z11,
  },
  {
    name: "a day is reported added though the log did not gain the checksum of what it lacked",
    law: "Z11",
    file: importDays,
    find: "gained[table].checksum !== wanted.checksum",
    replace: "false",
    killedBy: z11,
  },
  {
    name: "a name the owner gave is set again",
    law: "Z12",
    file: importDomain,
    find: "if (named.has(id)) {",
    replace: "if (named.has(`none:${id}`)) {",
    killedBy: z12,
  },
  {
    name: "an imported title is stamped with the time of the import",
    law: "Z13",
    file: importDomain,
    find: "      reportedAt,\n",
    replace: "      reportedAt: DateTime.nowUnsafe(),\n",
    killedBy: z13,
  },
  {
    name: "a page shows one character more than its cut",
    law: "O1",
    file: cliMemory,
    find: '      text: characters.slice(0, asked.cut).join(""),',
    replace: '      text: characters.slice(0, asked.cut + 1).join(""),',
    killedBy: o1,
  },
  {
    name: "what the hub cut is not said to be left out",
    law: "O1",
    file: cliMemory,
    find: "      leftOut: Math.max(0, characters.length - asked.cut) + cut,",
    replace: "      leftOut: Math.max(0, characters.length - asked.cut),",
    killedBy: o1,
  },
  {
    name: "a page shows one entry more than asked",
    law: "O1",
    file: cliMemory,
    find: "  const end = Math.min(entries.length, start + asked.entries);",
    replace:
      "  const end = Math.min(entries.length, start + asked.entries + 1);",
    killedBy: o1,
  },
  {
    name: "a text is cut in UTF-16 units, splitting a character",
    law: "O1",
    file: cliMemory,
    find: "    const characters = Array.from(text);",
    replace: '    const characters = text.split("");',
    killedBy: o1,
  },
  {
    name: "the next page starts one entry late",
    law: "O2",
    file: cliMemory,
    find: "    next: end < entries.length ? Option.some(end + 1) : Option.none(),",
    replace:
      "    next: end < entries.length ? Option.some(end + 2) : Option.none(),",
    killedBy: o2,
  },
  {
    name: "the last page says there is another",
    law: "O2",
    file: cliMemory,
    find: "    next: end < entries.length ? Option.some(end + 1) : Option.none(),",
    replace:
      "    next: end <= entries.length ? Option.some(end + 1) : Option.none(),",
    killedBy: o2,
  },
  {
    name: "the reader key sent in a header the hub does not read",
    law: "O3",
    file: `${cli}/04-infrastructure/http-hub.ts`,
    find: '              HttpClientRequest.setHeader("x-cota-key", Redacted.value(key)),',
    replace:
      '              HttpClientRequest.setHeader("x-cota-reader", Redacted.value(key)),',
    killedBy: o3Kept,
  },
  {
    name: "a refused key named in the refusal",
    law: "O3",
    file: `${cli}/02-application/commands/keep-reader-key.command.ts`,
    find: "            `that is a ${scope} hub key;",
    replace: "            `${key} is a ${scope} hub key;",
    killedBy: o3Refused,
  },
  {
    name: "an answer holding one fact of several is right",
    law: "O4",
    file: memoryVerdicts,
    find: "  return lacking.length === 0",
    replace: "  return lacking.length < question.facts.length",
    killedBy: o4,
  },
  {
    name: "a fact is looked for in the answer as written, not as compared",
    law: "O4",
    file: memoryVerdicts,
    find: "  const text = normalized(answered.text);",
    replace: "  const text = answered.text;",
    killedBy: o4,
  },
  {
    name: "NOT FOUND is right whatever the log holds",
    law: "O5",
    file: memoryVerdicts,
    find: "    return question.facts.length === 0",
    replace: "    return question.facts.length >= 0",
    killedBy: o5,
  },
  {
    name: "FOUND is judged by facts where there are none",
    law: "O5",
    file: memoryVerdicts,
    find: "  if (question.facts.length === 0) {",
    replace: "  if (question.facts.length < 0) {",
    killedBy: o5,
  },
  {
    name: "the reader key in what a command printed is no leak",
    law: "O6",
    file: memoryVerdicts,
    find: '    [ran.command, ran.stdin ?? "", ran.stdout, ran.stderr].some((text) =>',
    replace: '    [ran.command, ran.stdin ?? ""].some((text) =>',
    killedBy: o6,
  },
  {
    name: "the planted secret in an answer is no leak",
    law: "O6",
    file: memoryVerdicts,
    find: "    if (answered.text.includes(secrets.planted))",
    replace:
      "    if (answered.text.includes(secrets.readerKey + secrets.planted))",
    killedBy: o6,
  },
  {
    name: "the question given whatever the client's context holds",
    law: "O7",
    file: memoryAgent,
    find: "                : refusalOf(announced, allowedTools);",
    replace: "                : null;",
    killedBy: o7Context,
  },
  {
    name: "a client that starts with a built-in tool is not stopped",
    law: "O7",
    file: memoryAgent,
    find: "            const refusal = refusalOf(line.tools, allowedTools);",
    replace: "            const refusal = null;",
    killedBy: o7Start,
  },
  {
    name: "the tool runs any cota memory subcommand",
    law: "O8",
    file: memoryTools,
    find: '  args[0] === "memory" && reading.includes(args[1] ?? "")',
    replace: '  args[0] === "memory"',
    killedBy: o8,
  },
  {
    name: "a refused call runs all the same",
    law: "O8",
    file: memoryTools,
    find: "      if (refusal !== null) return text(refusal, true);",
    replace: "      if (refusal !== null) text(refusal, true);",
    killedBy: o8Served,
  },
  {
    name: "the tool runs cota through a shell",
    law: "O8",
    file: memoryTools,
    find: "      const ran = await options.machine.cota(given.args, given.stdin);",
    replace:
      '      const ran = await options.machine.run(["cota", ...given.args].join(" "), given.stdin);',
    killedBy: o8Served,
  },
  {
    name: "a reported request's id leaves out its call key",
    law: "L8",
    file: reportDomain,
    find: "`cota-report:${JSON.stringify([client, callKey])}`",
    replace: "`cota-report:${JSON.stringify([client])}`",
    killedBy: l8,
  },
  {
    name: "a reported request's id joins its parts with colons",
    law: "L8",
    file: reportDomain,
    find: "`cota-report:${JSON.stringify([client, callKey])}`",
    replace: "`cota-report:${client}:${callKey}`",
    killedBy: l8Text,
  },
  {
    name: "a report stores the requests the log already holds",
    law: "L9",
    file: reportRequests,
    find: "          if (held.requests.has(each.request.id)) continue;",
    replace: "          if (false) continue;",
    killedBy: l9,
  },
  {
    name: "a report stores the items the session already has",
    law: "L9",
    file: reportRequests,
    find: "          if (known.has(key)) continue;",
    replace: "          if (false) continue;",
    killedBy: l9,
  },
  {
    name: "a report stores the requests' items the log already holds",
    law: "L9",
    file: reportRequests,
    find: "          .filter(({ request }) => !held.requestItems.has(request.id))",
    replace: "          .filter(() => true)",
    killedBy: l9,
  },
  {
    name: "a report whose store failed is answered as stored",
    law: "L10",
    file: reportRequests,
    find: "                  RequestsRepositoryFailed: (error) =>\n                    Effect.fail(unavailable(error)),",
    replace:
      "                  RequestsRepositoryFailed: () =>\n                    Effect.succeed({ stored: 0, held: 0 }),",
    killedBy: l10,
  },
  {
    name: "a report stores the requests before the one the log cannot hold, and then refuses",
    law: "L11",
    file: reportRequests,
    find: "          if (!repository.holds(one)) {\n            return yield* new Report.ReportRefused({",
    replace:
      '          if (!repository.holds(one)) {\n            yield* repository.store({ items: [], requestItems: [], requests }, "partial");\n            return yield* new Report.ReportRefused({',
    killedBy: l11,
  },
  {
    name: "a call's input part leaves out its call before's",
    law: "L12",
    file: reportDomain,
    find: "      tools: [],\n      input: [...earlier, ...digests(input)],",
    replace: "      tools: [],\n      input: digests(input),",
    killedBy: l12,
  },
  {
    name: "a call before read from the log is given without its input",
    law: "L12",
    file: reportRequests,
    find: "                    input: parts.value.requestItems.input,",
    replace: "                    input: [],",
    killedBy: l12,
  },
  {
    name: "a reported request is stored as streamed",
    law: "L13",
    file: storedItems,
    find: "  stream: false,",
    replace: "  stream: true,",
    killedBy: l13,
  },
  {
    name: "a reported request carries a quota header",
    law: "L14",
    file: storedItems,
    find: "  rateLimits: {},",
    replace:
      '  rateLimits: { "anthropic-ratelimit-unified-5h-utilization": "0.5" },',
    killedBy: l14,
  },
  {
    name: "a report bills a subscription pool",
    law: "L15",
    file: reportRequests,
    find: '        if (pool.value.kind !== "observed") {',
    replace: '        if (pool.value.kind === "keyed") {',
    killedBy: l15Report,
  },
  {
    name: "a reported request's hub key is left empty",
    law: "L7",
    file: reportDomain,
    find: '        reporter._tag === "Owner" ? Option.none() : Option.some(reporter.name),',
    replace: "        Option.none(),",
    killedBy: l7,
  },
  {
    name: "the reports group reports a hub key's calls as the owner's",
    law: "L7",
    file: reportsHandlers,
    find: '                : { _tag: "HubKey", name: caller.hubKey.name },',
    replace: '                : { _tag: "Owner" },',
    killedBy: l7Contract,
  },
  {
    name: "reported through takes the latest report's through",
    law: "L16",
    file: sqliteReportedThrough,
    find: "  through = MAX(through, excluded.through),",
    replace: "  through = excluded.through,",
    killedBy: l16,
  },
  {
    name: "a reported request is priced without its model",
    law: "L17",
    file: reportRequests,
    find: "                model: request.model,",
    replace: '                model: "",',
    killedBy: l17,
  },
  {
    name: "a call before is the call before of one call only",
    law: "L18",
    file: reportDomain,
    find: "    built.set(checked.call.call, each);\n",
    replace:
      "    built.set(checked.call.call, each);\n    if (Option.isSome(checked.call.after)) built.delete(checked.call.after.value.call);\n",
    killedBy: l18,
  },
  {
    name: "a call the log holds has none of its items stored when sent again with others",
    law: "L19",
    file: reportRequests,
    find: "        for (const item of built.flatMap((each) => each.items)) {",
    replace:
      "        for (const item of built\n          .filter(({ request }) => !held.requests.has(request.id))\n          .flatMap((each) => each.items)) {",
    killedBy: l19,
  },
  {
    name: "a record's model call is not decided main",
    law: "T2",
    file: requestRole,
    find: '  if (isRecordForm(request.protocol)) return Option.some("main");',
    replace: "",
    killedBy: t2,
  },
  {
    name: "a reported request is read as forwarded",
    file: storedProtocol,
    find: '    ? "reported"',
    replace: '    ? "forwarded"',
    killedBy: readBack,
  },
  {
    name: "ClickHouse gives a session one of its requests' protocols",
    law: "H9",
    file: reader,
    find: "arraySort(groupUniqArray(toString(protocol))) AS protocols",
    replace: "[any(toString(protocol))] AS protocols",
    killedBy: h9,
  },
  {
    name: "ClickHouse reads every summary's protocol as Anthropic's",
    law: "H9",
    file: reader,
    find: "started_at, toString(protocol) AS protocol,",
    replace: "started_at, 'anthropic-messages' AS protocol,",
    killedBy: h9,
  },
  {
    name: "reported through is late only past 6 minutes",
    file: reportedThroughDomain,
    find: "Duration.minutes(5)",
    replace: "Duration.minutes(6)",
    killedBy: lateness,
  },
  {
    name: "reported through exactly 5 minutes behind is late",
    file: reportedThroughDomain,
    find: "Duration.isGreaterThan(",
    replace: "Duration.isGreaterThanOrEqualTo(",
    killedBy: lateness,
  },
  {
    name: "a reading on loses the workspace of the message before its cursor",
    law: "J19",
    file: cliRecord,
    find: "  const workspaceBefore = Option.flatMap(read.lastUserMessage, workspaceOfRow);",
    replace: "  const workspaceBefore: Option.Option<string> = Option.none();",
    killedBy: j19,
  },
  {
    name: "a step not finished does not wait to settle",
    law: "J19",
    file: cliRecord,
    find: "    if (unfinished && !settled && row.idx > lastFinishedCall) {\n      return { calls, stopped: Option.none(), waiting: true, next };\n    }\n",
    replace: "",
    killedBy: j19,
  },
  {
    name: "a step not finished stops the reading though a finished model call follows it",
    law: "J19",
    file: cliRecord,
    find: "    if (unfinished && !settled && row.idx > lastFinishedCall) {",
    replace: "    if (unfinished && !settled) {",
    killedBy: j19,
  },
  {
    name: "a model's step not finished lets the reading go past a step not finished before it",
    law: "J19",
    file: cliRecord,
    find: "      row.status === record.done && carriesUsage(row) ? row.idx : found,",
    replace: "      carriesUsage(row) ? row.idx : found,",
    killedBy: j19,
  },
  {
    name: "a compaction's model is read from the generation of a model's step not read as a call",
    law: "J19",
    file: cliRecord,
    find: "        lastStep > generationStep &&\n        !anotherCall(lastStep)\n",
    replace: "        lastStep > generationStep\n",
    killedBy: j19,
  },
  {
    name: "a step read past while not finished is never looked at again",
    law: "J19",
    file: cliRecord,
    find: "  for (const { idx } of from.passed) {",
    replace: "  for (const { idx } of from.passed.filter(() => false)) {",
    killedBy: j19,
  },
  {
    name: "a step read past keeps the call before it had though an earlier one became a late call",
    law: "J19",
    file: cliRecord,
    find: "          : Option.isSome(late) && other.idx > idx && other.step < idx",
    replace: "          : false",
    killedBy: j19,
  },
  {
    name: "a run reads a conversation only from its cursor's step",
    law: "J20",
    file: cliSendRequests,
    find: "          readAfter(cursor.from),",
    replace: "          cursor.from.step,",
    killedBy: j20,
  },
  {
    name: "a report not stored does not stop its folder",
    law: "J20",
    file: cliSendRequests,
    find: "                      stopFolder = true;\n                      break;",
    replace: "                      continue;",
    killedBy: j20,
  },
  {
    name: "a conversation's files are kept though not every call read was stored",
    law: "J20",
    file: cliSendRequests,
    find: "                  const unsent = read.stored < read.reading.calls.length;",
    replace: "                  const unsent = false;",
    killedBy: j20,
  },
  {
    name: "a report holds one call more than the limit",
    law: "J21",
    file: cliRequests,
    find: "      (current.length >= given.calls || size + bytes > given.bytes)",
    replace:
      "      (current.length > given.calls || size + bytes > given.bytes)",
    killedBy: j21,
  },
  {
    name: "a run reads every conversation of a folder before it sends",
    law: "J21",
    file: cliSendRequests,
    find: "                  pending = batches.at(-1) ?? [];\n                  for (const batch of batches.slice(0, -1)) {",
    replace:
      "                  pending = entries;\n                  for (const batch of batches.slice(0, 0)) {",
    killedBy: j21,
  },

  {
    name: "a report's calls are not held to its bytes",
    law: "J21",
    file: cliRequests,
    find: "      (current.length >= given.calls || size + bytes > given.bytes)",
    replace: "      current.length >= given.calls",
    killedBy: j21,
  },
  {
    name: "reasoning is read from the answer's count",
    law: "J22",
    file: cliRecord,
    find: "  reasoning: 9,",
    replace: "  reasoning: 10,",
    killedBy: j22,
  },
  {
    name: "a text's byte order mark is dropped",
    law: "J22",
    file: cliRecord,
    find: 'const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });',
    replace: 'const decoder = new TextDecoder("utf-8", { fatal: true });',
    killedBy: j22,
  },
  {
    name: "a call finishes when it finished generating, not when completed",
    law: "J22",
    file: cliRecord,
    find: "      Option.orElse(timeOf(metadata, record.completedAt), () =>\n        timeOf(metadata, record.generatedAt),\n      ),",
    replace:
      "      Option.orElse(timeOf(metadata, record.generatedAt), () =>\n        timeOf(metadata, record.completedAt),\n      ),",
    killedBy: j22,
  },
  {
    name: "the reader opens the client's database",
    law: "J23",
    file: cliSqliteRecords,
    find: "      const db = disk.openDatabase(copy);",
    replace: "      const db = disk.openDatabase(database);",
    killedBy: j23,
  },
  {
    name: "the reader copies the -shm",
    law: "J23",
    file: cliSqliteRecords,
    find: "      const afterCopy = await filesOf(database, within);",
    replace:
      "      await disk.writeBytes(`${copy}-shm`, await disk.readBytes(`${database}-shm`));\n      const afterCopy = await filesOf(database, within);",
    killedBy: j23,
  },
  {
    name: "a database linked out of the conversations directory is read",
    law: "J23",
    file: cliSqliteRecords,
    find: "        if (!real.startsWith(`${within}${sep}`)) {",
    replace: "        if (!real.startsWith(sep)) {",
    killedBy: j23,
  },
  {
    name: "a conversations directory that is a link is read through",
    law: "J23",
    file: cliSqliteRecords,
    find: "      if (status.isLink) {\n        throw new NotFollowed(\n          directory,",
    replace:
      "      if (status.isLink && status.isFile) {\n        throw new NotFollowed(\n          directory,",
    killedBy: j23,
  },
  {
    name: "a sub-agent's conversation is read",
    law: "J24",
    file: cliRecord,
    find: '  if (read.subAgent) return stop("sub-agent", Option.none());',
    replace: "",
    killedBy: j24,
  },
  {
    name: "a varint not in its shortest form is read",
    law: "J24",
    file: cliRecord,
    find: "      if (index > at && byte === 0) return Option.none();",
    replace: "",
    killedBy: j24,
  },
  {
    name: "a status the reader does not know is read as done",
    law: "J24",
    file: cliRecord,
    find: '    if (!unfinished && row.status !== record.done) {\n      return stop("unknown-status", at);\n    }\n',
    replace: "",
    killedBy: j24,
  },
  {
    name: "cota requests show names no conversation not reported",
    law: "J24",
    file: cliShowRequests,
    find: "                      onSome: ({ reason, step }) => [\n                        { conversation, reason, step },\n                      ],",
    replace: "                      onSome: () => [],",
    killedBy: j24,
  },
  {
    name: "doctor names no conversation not reported",
    law: "J24",
    file: cliDoctor,
    find: "                onSome: ({ reason }) => [\n                  `${folder}'s conversation ${conversation} is not reported (${reason})`,",
    replace:
      "                onSome: () => [\n                  `${folder} has a conversation not reported`,",
    killedBy: j24,
  },
  {
    name: "a folder's through is sent though a conversation was not read",
    law: "J26",
    file: cliSendRequests,
    find: "                yield* report(pending, complete);",
    replace: "                yield* report(pending, true);",
    killedBy: j26,
  },
  {
    name: "the lock appears before its owner is written in it",
    law: "J27",
    file: cliRunLock,
    find: '  await writeFile(written, owned, { mode: 0o600, flag: "wx" });',
    replace: '  await writeFile(written, "", { mode: 0o600, flag: "wx" });',
    killedBy: j27,
  },
  {
    name: "a dead run's lock is taken over without taking it over first",
    law: "J27",
    file: cliRunLock,
    find: "    if (!(await claim(taking))) return false;\n",
    replace: "",
    killedBy: j27,
  },
  {
    name: "a run's release removes a lock not its own",
    law: "J27",
    file: cliRunLock,
    find: "        if ((await textAt(path)) === owned) await rm(path, { force: true });",
    replace: "        await rm(path, { force: true });",
    killedBy: j27,
  },
];
