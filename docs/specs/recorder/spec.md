---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-12
review_by: 2027-02-12
supersedes: []
code:
  - apps/hub/src/modules/recording/module.ts
  - apps/hub/src/modules/recording/02-application
  - apps/hub/src/modules/recording/04-infrastructure
  - apps/hub/src/modules/recording/03-domain/scrubber
  - apps/hub/src/modules/recording/01-presentation/strings.ts
---

# Recorder

An exchange (ADR-0008) recorded from real traffic holds the owner's prompts, file contents, paths, tool names, account ids and logins until the **scrubber** has been over it. The scrubber is the one thing between that traffic and a public repository, so it is built fail-closed: what it does not positively know to be safe is replaced. A person still reads every recorded exchange before it is committed (`apps/hub/src/shared/05-tests/replay/exchanges/README.md`), but nothing here relies on it.

## Words

An exchange file holds one exchange with a provider for the hub's tests to replay: what the client sent, what the provider answered, and the request the hub should log for it. It is recorded through the hub, or written from documentation.

**Recorder**:
What writes each exchange the hub has with a provider to an exchange file, scrubbed, while the owner runs the hub with a recording directory (`COTA_RECORD_TO`).
_Avoid_: dumper, logger, capture

**Scrubber**:
What replaces everything in an exchange that is not a word of its protocol, so that its file can be published.
_Avoid_: sanitizer, redactor, anonymizer

**Filler**:
What a string the scrubber does not keep becomes: a word that tells only its length class.
_Avoid_: placeholder, redaction, mask

**Fake**:
What an identifier or a login becomes in an exchange file: counted within one recording run, the same for the same real value, and never computed from it.
_Avoid_: pseudonym, hash, dummy

## The scrubber

The scrubber takes one exchange as the hub saw it (method, path, headers and decoded bodies, an event stream as events) and gives the same exchange with everything replaced that is not a word of its protocol. It is pure: no IO, no clock. Its allow-lists live in `apps/hub/src/modules/recording/03-domain/scrubber/vocabulary.ts`, one `Vocabulary` per protocol and one table of headers per direction; this spec says how they are used, the file says what they hold.

**Bodies.** A JSON body is walked with its protocol's vocabulary.

- An object key the protocol defines is kept. Any other key is the client's or its user's: it becomes `scrubbed-key-<n>`, its position among the replaced keys of that object, and its whole value is scrubbed as content (below).
- A string under a key whose values are the protocol's own words (types, roles, model ids, stop and finish reasons, event names, statuses, error types and codes) is kept when it passes that key's rule: one of a fixed list, or, for model ids and error codes, a strict pattern. A rule is chosen by the key's name, wherever the key appears; a `code` is kept only beside a `message`, which is where a protocol puts an error's code, because a tool call's `code` is what the tool ran. Every other string becomes a **filler**: `scrubbed:s` (1 to 8 characters), `scrubbed:m` (9 to 64), `scrubbed:l` (65 to 1024) or `scrubbed:xl` (more). An empty string stays empty. An event type the scrubber has never heard of is not on any list, so it is replaced, in the event's data and in its `event:` name.
- Numbers, booleans and nulls are kept, except a number under an identifier key, which becomes a fake number.
- **Content** is what a protocol carries for the client's user without defining it: a tool's input, schema and parameters, Codex's shell environment and workspaces, and any field the protocol does not define. In content every key is replaced by its position, every string by a filler, every number by 0; booleans and nulls are kept.
- **Identifiers** (message, tool, call, item and response ids, session, thread, turn, device, installation and account ids, prompt cache keys) become fakes.
- **JSON inside a string** is scrubbed inside where the hub or a replay reads it: `metadata.user_id` and Codex's `x-codex-turn-metadata` by the protocol's vocabulary, a tool call's `arguments` as content. A string that should hold JSON and does not is replaced like any other.
- **A tool's input spread over stream deltas** (Anthropic's `input_json_delta`, Codex's `response.function_call_arguments.delta`, Chat Completions' tool call `arguments`) is joined per block, scrubbed as content, and cut back into as many pieces, in the proportions of the original pieces, so that the deltas of a block still join into JSON of the same shape. Pieces that do not join into JSON all become empty.
- Encrypted and binary content (`encrypted_content`, thinking signatures, redacted thinking, image data, base64 of any kind) is under no word's key, so it becomes a filler.
- A text body, or a body of bytes, becomes a text filler. An event's data that is not JSON is kept only when it is `[DONE]`.

**Headers.** A header is kept only when its name is in the scrubber's table or is a quota header the hub reads; every other header is dropped, name and value. Among them:

- `x-cota-*` headers and cookies are dropped. The replay adds its own hub key, and the hub never reads a cookie.
- A **login** (`authorization`, `x-api-key`) becomes a fixed fake of its protocol's kind: `sk-ant-oat01-FAKE-login-for-tests-only-<n>`, `sk-ant-api03-FAKE-key-for-tests-only-<n>`, `cota-FAKE-hub-key-for-tests-<n>`, or, for a JWT, a made-up JWT whose payload holds only the fakes of the claims the ChatGPT fingerprint reads (`chatgpt_account_id` and `chatgpt_account_user_id`) and whose signature is fixed.
- An identifier header (session, thread, request, organisation and ray ids, `chatgpt-account-id`, `x-codex-turn-state`) becomes a fake.
- A header of the protocol's words (content types and encodings, the protocol version and beta flags, the client's request-class headers, retry counts) is kept when its value passes its rule; a list keeps only its items that pass. A user agent is kept as its first product, and only for a client Cota knows.
- A quota header (`anthropic-ratelimit-*`, `x-codex-*`, and the other names the ChatGPT protocol reads) keeps its name and only the shape of its value, because the value says what plan the owner has and how much of it is used: a time becomes one fixed time, any other number becomes 0, and a word becomes a filler. The one value kept is the status a refusal is told by (`anthropic-ratelimit-unified-status`).

**Paths.** A path the protocol serves is kept; any other has its unknown segments replaced by `scrubbed`. A query parameter is kept only when the protocol knows it and its value passes its rule (Anthropic's `beta=true`, Codex's `client_version`).

**Fakes.** The fakes of a recording run are counted in the order their real values are first seen, never computed from them, so a fake cannot be turned back into its real value. The same real value gets the same fake throughout the run, wherever it appears, so the exchanges of one session still share their session, and a tool call and its result still share their id. An identifier keeps a prefix the provider gives (`toolu_`, `msg_`, `resp_`, `call_` and the others in `identifierPrefixes`) or its UUID shape: `toolu_FAKE0002`, `00000000-0000-4000-8000-000000000001`, `fake-id-0003`. The table of real values lives only in the hub's memory for as long as the run, and is never written.

**Source.** A recorded exchange names the day, and the client and version its user agent names when the client is one Cota knows (`claude-code`, `codex`, `opencode`, `pi`); otherwise `unknown`.

## The recorder

The **recorder** writes the hub's real exchanges with providers to files the tests replay, so that the protocols are tested against what clients and providers really send.

**It is off unless asked.** It is switched on by the environment variable `COTA_RECORD_TO`, which names the directory it writes into; unset or blank leaves it off. It is not in the config file on purpose: a config file is deployed, copied and kept, and recording is a short, deliberate act on one machine, which should end when the shell that started it ends. When it is on, the hub logs one warning as it starts, naming the directory. A directory the hub cannot make stops the hub with a message saying so.

**What it records.** Every exchange with a provider, as its own file: a refusal and the divert that follows it are two. The request is the one the hub saw from its client: its method, its path under the pool (the client's prefix included, `/v1/messages`, `/backend-api/codex/responses`), its headers and its decoded body. The response is all of it: its status, its headers and its decoded body, an event stream as its events. A refusal the hub diverts is recorded without its body, which the hub drops unread. An exchange that did not finish (the provider unreachable or too slow, a stream it broke, the client gone, the hub stopping) is not recorded.

**It can never slow or break the relay.** The response's copy reaches the recorder through a second bounded queue of the tee (`Tee.Tap`), beside the request log's reader's: when the recorder falls behind by more than its capacity (4,096 chunks), its queue fails and the exchange is not recorded; the client and the request log's reader are not held up. Once the response has ended the recording has 15 seconds to finish and is then cut. It runs in `Shutdown.Finishers`, so a stopping hub waits for it as it waits for the request log. Law R5 (relay spec) runs with the recorder keeping up, falling behind, failing and hanging.

**It is bounded.** A request or response over 32 MiB, decoded, is not recorded; a body that cannot be decoded is not either. An exchange that is not recorded is logged as `exchange not recorded`, with its reason and nothing of its content, unless the provider never answered it (the hub's 502 and 504, or a client or hub that ended it first): that one is neither recorded nor logged.

**Nothing unscrubbed touches the disk.** The recorder keeps the exchange in memory, has it scrubbed, and only then writes it: one file per exchange, named for its time, protocol, operation and outcome and the end of its request id (`20261112T091502.114Z-anthropic-messages-messages-ok-3f9c0b1d2e4a.json`), written to a hidden partial file and renamed, so a file under its name is always whole. No log line holds a real value: the recorder logs only file names and reasons. Its fakes live for the hub's run, so the exchanges of one run share their fakes.

**Expectations are left empty.** A recorded exchange's `expects.logged` is `null`; `bun run replay:expect` fills it once the file is in `apps/hub/src/shared/05-tests/replay/exchanges/<protocol>/`, and the reviewer reads what it wrote (`apps/hub/src/shared/05-tests/replay/exchanges/README.md`).

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| S1 | **Nothing real survives.** No string of an exchange survives the scrubber unless it is one of its protocol's own words or a fake: not in a value, a key, a header, a nested JSON string, a JWT's payload or a tool input spread over deltas. | property |
| S2 | **A scrubbed exchange replays as the original did.** A scrubbed exchange decodes as an exchange file and replays through the hub into a request of the same shape as the original's: the same operation, outcome, usage, stop reason, session source, and number and types of items. | property |

S1's property generates exchanges of each protocol (request bodies, streams, answers that are not streams, errors, refusals, headers, unknown fields, headers and event types) in which every string that is not a word of its protocol carries a marker, scrubs them, and searches the written file for the marker: its bytes, its strings joined in order, and the decoding of every run that could be base64. S2's property replays the same exchanges through the real hub before and after scrubbing. The scrubber's rules are also held by mutants (`tooling/mutants.table.ts`).

## Not built, on purpose

- **Keeping text that looks harmless.** A string is kept for its key and its rule, never for what it says.
- **Exact lengths.** A filler tells a length class, not a length, so a scrubbed text no longer joins with its neighbours: the text deltas of a stream do not add up to the next request's copy of the same message. Nothing in the hub depends on it.
