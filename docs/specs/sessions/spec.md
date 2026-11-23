---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/request-log/03-domain/session.ts
  - apps/hub/src/modules/request-log/03-domain/request-role.ts
  - apps/hub/src/modules/request-log/03-domain/segment.ts
  - apps/hub/src/modules/request-log/03-domain/title.ts
  - apps/hub/src/modules/request-log/03-domain/first-prompt.ts
  - apps/hub/src/modules/request-log/03-domain/transcript.ts
  - apps/hub/src/modules/request-log/03-domain/stored-protocol.ts
  - apps/hub/src/modules/request-log/03-domain/antigravity-steps.ts
  - apps/hub/src/shared/03-domain/item-text.ts
  - apps/hub/src/modules/request-log/02-application/interfaces/transcripts.ts
  - apps/hub/src/modules/request-log/04-infrastructure/transcripts
  - apps/hub/src/modules/request-log/02-application/queries/list-sessions.query.ts
  - apps/hub/src/modules/request-log/02-application/queries/read-session.query.ts
  - apps/hub/src/modules/request-log/02-application/queries/inspect-request.query.ts
  - apps/hub/src/modules/request-log/02-application/commands/report-session-titles.command.ts
---

# Sessions

How the hub reads a session out of the request log: what each request is to its session (its request role), where the main conversation was compacted (segments), what the session is called (its title), what was first asked (its first prompt), and how a request's stored items are set out to be read (its transcript). ADR-0014 gives the reasons.

**What is built.** The rules, with no IO, in the request-log module's `03-domain`: `session.ts` (what the rules read of a request, prompt size, the thread key, having tools, a session's row), `request-role.ts`, `segment.ts`, `title.ts` (the latest report, the shown title, reading a generated title) and `first-prompt.ts`; the stored titles (`session_titles`, `docs/specs/request-log/spec.md`, and the command `ReportSessionTitles`); and the sessions list (the query `ListSessions`, `GET /api/sessions` and `PUT /api/session-titles` of `docs/specs/api/spec.md`), with the laws T1 to T9 and T12; and transcripts (`transcript.ts`, the port `Transcripts` and the renderers in `04-infrastructure/transcripts/<protocol>.ts`), with T10 and T11; and one session's detail and the inspector (the queries `ReadSession` and `InspectRequest`, `GET /api/sessions/{session}` and the requests group of `docs/specs/api/spec.md`).

Every rule here reads what `RecordRequest` stored (`docs/specs/request-log/spec.md`): a request's columns, its `request_items` row (the digests of its parts, its layout and its params) and its items (`type`, `role`, `content`). None reads the wording of a prompt.

## Values

- **A session's requests**: its traffic requests (not model listings), ordered by `started_at`, then by `id` (as text). Every rule below reads at most a session's **latest 10,000** (`Session.mostListedRequests`, the detail's cap on the requests it lists), read with a per-session limit in the query: for a session past them, request roles, segments, the generated title and the first prompt are those of its latest 10,000 alone, so its first prompt is that of the first main request among them, and the inspector gives a request older than them no request role and no segment (`null`). A model listing has no conversation, so it is `utility` whatever its age.
- **Prompt size**: `input_tokens + cache_read_tokens + cache_write_short_tokens + cache_write_long_tokens` of a request whose usage was reported; none otherwise. The ClickHouse column `requests.prompt_tokens` is the same sum (`docs/specs/request-log/spec.md`).
- **Thread key** of a request with a conversation: the digests of its `system` part, in order, when it has any; otherwise the digest of the first item of its `input` part; otherwise none. A key from `system` digests never equals one from an `input` digest. Claude Code's requests have `system` digests; Codex 0.167.2 sends no `system` part, and its first input item is its `additional_tools` item (recorded); OpenCode sends its system prompt as the first message (recorded, 1.19.5).
- **Has tools**: its `tools` part has at least one item; for `chatgpt-codex` and the source form `bifrost-responses`, also when an item of its `input` has the type `additional_tools`, which is how Codex 0.167 sends its tools (`docs/specs/protocols/spec.md`; recorded, 0.167.2), and how the prototype's log holds them for Codex's requests (ADR-0025, fact 9).

What the rules read of a request, besides its columns, is in `session.ts` (`read`): the kept headers `x-claude-code-agent-id` and `x-openai-subagent`, the params field `output_config`, and whether an input item has the type `additional_tools`. A reader gives exactly these, so the rules run on what is cheap to read for every request of a session: a request's columns and its `request_items` digests, never its items' content.

## Request roles

A request's role is decided by the first of these rules that applies:

1. **No conversation.** A request without a `request_items` row (an operation that carries no conversation, or a body that could not be read) is `utility`.
2. **A record's model call.** A request whose `protocol` is a record form (`antigravity-steps`, Record forms below) is `main`: a client's record holds one conversation, and the request reporter reports no sub-agent's (ADR-0029). A compaction in it is one of its steps, and the size rule cuts a segment there (ADR-0029, fact 4).
3. **Title.** For `anthropic-messages`: a request whose params hold `output_config.format.type` `json_schema` and whose `output_config.format.schema.required` is exactly `["title"]` is `title`. This is the shape of Claude Code's request to name its session (recorded, 2.1.322, `recorded-session-title.json`), as far as the recording shows it: its `output_config.format.type` is `json_schema` and its schema has four fields, but the scrubber replaced the schema's words, so that `required` is exactly `["title"]` is (constructed). The request also says `auxiliary`, has the same `system` digests as the main conversation and an empty `tools` list (recorded), which is why this rule comes before rules 5 and 6. Other protocols have no title shape yet.
4. **The client says subagent.** For `anthropic-messages`: its kept header `x-claude-code-agent-id` is not empty. For `chatgpt-codex`: its kept header `x-openai-subagent` is not empty. Then it is `subagent`. (Constructed: no recording has either header; Codex's is read from its source, `subagent-review.json`.)
5. **The client's purpose.**

   | Protocol | `purpose` | Role |
   | --- | --- | --- |
   | `anthropic-messages` | `main` | `main` |
   | `anthropic-messages` | `auxiliary`, `quota_probe` | `utility` |
   | `chatgpt-codex` | `turn` | `main` |

   Any other purpose goes on to rule 6. Recorded: Claude Code 2.1.322 sends `main` and `auxiliary` (with `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`), and Codex 0.167.2 sends `request_kind` `turn` on every recorded request, the only value recorded; `quota_probe` is the hub's own word for Claude Code's quota check (constructed). OpenCode sends no purpose.
6. **Structure.** A request that does not have tools is `utility`. Among the session's requests with tools that no rule above decided, those with the same thread key form a thread; the thread whose requests' prompt sizes add up to the most (a request without a prompt size adds nothing) is the **main thread**, and when two are equal, the one holding the latest request. Its requests are `main`; the requests of every other thread, and those without a thread key, are `subagent`.

A Codex subagent sends its own session id (`x-codex-parent-thread-id` names its parent), so it is a session of its own, all of whose requests are `subagent`.

## Segments

The session's `main` requests, in order, are cut into segments. Walking them, with `p` the latest `ok` request with a prompt size in the current segment, a new segment begins at request `r` when:

- **size**: `r`'s outcome is `ok`, it and `p` have prompt sizes, and `r`'s is less than half of `p`'s (`2 × size(r) < size(p)`).

The first main request begins the first segment (`startedBy` `start`); a segment the size rule begins has `startedBy` `size`. A segment's **tip** is its last `ok` request, or its last request when none is `ok`. A segment is read as its tip's transcript.

**Compactions a client names.** None is recorded, so none cuts a segment yet. No recording shows Claude Code's compaction request. Codex 0.167.2 sends `x-codex-beta-features: remote_compaction_v2` on every recorded request, so its remote compaction is on, but no request to `/responses/compact` (an operation the protocol records as `other`) is recorded. Each is to be recorded and added here as a second rule, **compaction** (the main request before `r` is one its client named a compaction, `startedBy` `compaction`), over a kept header, a purpose or an operation; until then only the size rule cuts. T5 then reads "the size or the compaction rule".

## Titles

A session shows at most one title:

1. its **reported title**: the latest report for the session, when its title is not empty;
2. else its **generated title**: from the latest `ok` request of the session whose role is `title` and whose answer reads as one (below);
3. else none.

**Reports.** `PUT /api/session-titles` stores one row per entry in the ClickHouse table `session_titles` (`docs/specs/request-log/spec.md`): the session, the title (trimmed, cut to 200 characters, empty allowed), when the hub received it, the reporting machine (`x-cota-machine`) and who reported it (the hub key's name, or `owner`). The session, the title and the machine are made well-formed first, each lone surrogate in them U+FFFD, as the request log writes the requests' sessions (`docs/specs/request-log/spec.md`, Well-formed text): JSON can write one, and ClickHouse refuses it. Rows are never changed. The **latest report** is the one with the greatest `reported_at`, ties broken by the greater `machine`, then the greater `title`, then the greater `reported_by`, so every reader picks the same one; text compares by code point, which in ClickHouse is the order of its UTF-8 bytes. An empty latest report means the session has no reported title: reporting an empty title clears it.

**Generated.** For `anthropic-messages`, the answer is the request's output item: the text of its first `text` block, parsed as JSON. When that is an object whose `title` is a string, the title is that string, well-formed, trimmed and cut to 200 characters, and when it is empty or anything else does not hold, that request gives no title, and the one before it is tried. (Constructed: the recorded title request's answer is one `text` block, but its text is scrubbed.) The sessions list reads the answers of a session's title requests only when the session has no non-empty report.

## First prompt

The session's **first main request** is its first request whose role is `main` and which has a conversation. Its first prompt is the text of the **last user message** in its `input` part, cut to 500 characters:

| Protocol | A user message | Its text |
| --- | --- | --- |
| `anthropic-messages` | an item whose `role` is `user` and whose content is a string or holds a `text` block | the string, or the last `text` block's `text` |
| `chatgpt-codex` | an item of type `message` (or with no type) whose `role` is `user`, holding an `input_text` part | the last `input_text` part's `text` |
| `openai-chat` | an item whose `role` is `user`, with string content or a `text` part | the string, or the last `text` part's `text` |
| `bifrost-responses` | an item of type `message` (or with no type) whose `role` is `user`, with string content or an `input_text` part | the string, or the last `input_text` part's `text` |
| `bifrost-chat` | as `openai-chat` | as `openai-chat` |
| `antigravity-steps` | a step the record form's table reads as a user's message | its text (Record forms) |

A session without a main request with a conversation, or whose first main request has no such message, has no first prompt.

This is the last thing the person said before the model first answered: Codex sends its `AGENTS.md` and its environment as user messages before the prompt (recorded, 0.167.2), and Claude Code puts reminders in blocks of the first user message.

On the recordings the rule finds a prompt in each client's first request. Codex 0.167.2's input is its `additional_tools` item, four `developer` messages, a user message of two `input_text` parts (its `AGENTS.md` and environment), a user message of one `input_text` part, and a `configuration_update` item: the rule takes the one-part message. Claude Code 2.1.322's is a user message of three `text` blocks and a `system` message of a `text` and `tool_addition` blocks: the rule takes the third block; that the person's words are in the last block, not before it, is (constructed), since the recording's text is scrubbed. OpenCode 1.19.5's is a `system` message and a user message whose content is a string, which the rule takes.

## Transcripts

A request's transcript sets out the items of its `system`, `input` and `output` parts, in that order, as **entries**. Tool definitions are not in it (the inspector lists them, by `name` and `description`). Rendering is the request log's `Transcripts` port (`02-application/interfaces/transcripts.ts`), with one renderer per protocol in `04-infrastructure/transcripts/<protocol>.ts`; the rules every renderer shares (placing, naming, cutting and withholding) are `03-domain/transcript.ts`. An item is data: it is parsed as JSON and read field by field, never evaluated.

Every entry has `item` (the digest of the item it comes from) and `part`, and one of these shapes:

| `kind` | Fields | Is |
| --- | --- | --- |
| `message` | `role` (the item's own), `parts` | What a participant said. A part is `{ type: "text", text, cut }`, `{ type: "image", mediaType, bytes }` or `{ type: "other", json, cut }`. An image's `bytes` is the size of the decoded image, never the image, and `null`, as `mediaType` is, when the item only names the image (a URL, a file id). |
| `reasoning` | `text`, `hidden`, `cut` | The model's reasoning, or, when only an encrypted or redacted form was sent, `hidden: true` and `text: null`. |
| `tool-call` | `callId`, `name`, `input`, `cut` | A call the model made; `input` as the protocol carries it (a JSON string, or canonical JSON of an object). `callId` is `null` when the item has none. |
| `tool-result` | `callId`, `name`, `output`, `error`, `cut` | What came back; `name` is the name of the call with the same `callId` earlier in the transcript, or `null`. |
| `other` | `json`, `cut` | An item, or a piece of one, the renderer does not know: its canonical JSON, with what a transcript never shows withheld. |

**Cutting.** Every text (a text part, reasoning, a call's input, a result's output, an other's JSON) is cut at the length the endpoint gives (20,000 characters in a session, 100,000 in the inspector), and `cut` beside it is the number of characters left out, 0 when it fits. A transcript's `cutCharacters` is the sum of every `cut` in it.

**Withheld.** A transcript never shows an image's bytes or encrypted reasoning. A renderer reads an image as its media type and size, and reasoning without text as hidden; and wherever a transcript shows JSON (an `other`, or a result whose output is not text), the string of a field named `data` or `encrypted_content`, and a `data:` URL holding base64, is replaced by `[withheld: n characters]`. Nothing else is taken out: the request log stores no credential (`docs/specs/request-log/spec.md`), so a transcript, rendered from stored items alone, holds none.

**Per protocol.** One item can give several entries, in its own order; consecutive text, image and unknown pieces of one item are one `message` entry. An item that gives nothing else is a `message` with no parts. Everywhere, an item that is a JSON string is a `message` with that text, whose role is `system` in the `system` part and `user` otherwise; and a **result's output** is its content as a string, the text of its pieces joined by a blank line when every piece is a `text`, `input_text` or `output_text` piece, and its JSON otherwise (so an image a tool returned shows its media type and its data withheld).

- **`anthropic-messages`.** A `system` item that is a block is read as a block of a message whose role is `system`. A message item's content is a string (a text part) or blocks, taken in order: `text` is a text part; `image` an image part (`source.media_type`, and the decoded size of `source.data` when `source.type` is `base64`); `thinking` is `reasoning` with its `thinking`, hidden when that is empty; `redacted_thinking` is hidden `reasoning`; `tool_use`, `server_tool_use` and `mcp_tool_use` are a `tool-call` (`id`, `name`, `input`); `tool_result` and any block whose type ends in `_tool_result` are a `tool-result` (`tool_use_id`, its content as a result's output, `is_error`); any other block is an `other` part. An item with a `role` but no string or list content, and any other item, is `other`.
- **`chatgpt-codex`.** A `message` item (or one with no type) that has a `role` is a `message` with that role, its content a string (a text part) or parts: `input_text` and `output_text` are text parts, `refusal` a text part of its `refusal`, `input_image` an image (its `image_url`, a `data:` URL, gives the media type and size), others `other` parts. `reasoning` is `reasoning` with its `summary_text` parts' text joined by a blank line, else its `reasoning_text` content parts' text, hidden when it has neither. `function_call`, `custom_tool_call`, `tool_search_call`, `local_shell_call` and `web_search_call` are a `tool-call` (`call_id`, else `id`; `name`, else the item's type; `arguments`, else `input`, else `action` in canonical form). `function_call_output` and `custom_tool_call_output` are a `tool-result` (`call_id`; `output` as a result's output; never an error). Any other item is `other`.
- **`openai-chat`.** A message item gives, in order: a `reasoning` entry when it has a non-empty `reasoning_content`, `reasoning` or `reasoning_text` (the first of them); a `message` with its role and content (a string, or `text` and `image_url` parts, an `image_url` part's `url` a `data:` URL) when the content is not empty; a `tool-call` per element of `tool_calls` (`id`, `function.name`, `function.arguments`). An item whose role is `tool` is a `tool-result` (`tool_call_id`, its content as a result's output) instead. An item without a `role` is `other`.

**Shown as JSON on purpose.** Every item and block type the recorded exchanges hold has a rule above, but these, which are shown as `other`:

- Claude Code's `tool_addition` block, in the `system` messages it sends among `messages` (recorded, Claude Code 2.1.322): tools it adds to the conversation. The recording's scrubber replaced its fields' names, so which of them hold a name and a description is not known; its JSON shows all of it.
- Codex's `additional_tools` item (recorded, Codex 0.167.2): its tool definitions, sent as an input item. The inspector's `tools` lists the `tools` part only, which Codex 0.167.2 leaves empty, so these are read here.
- Codex's `configuration_update` item (recorded, Codex 0.167.2): a change of the turn's settings (`{"type":"configuration_update","reasoning":{"effort":"low"}}`), nothing a participant said.

## Source forms

An imported request's items are in a **source form** (ADR-0025, `docs/specs/import/spec.md`), which the request log reads wherever it reads a protocol: its `protocol` names it, and its renderer, its items' text for search and its row of the first prompt's table are these.

- **`bifrost-responses`**: Bifrost's Responses items, which it logged for every client but a Chat Completions one (Claude Code's Anthropic Messages converted by Bifrost, with ids it made up, and Codex's own). Rendered by `chatgpt-codex`'s rules above; an item's text for search is `chatgpt-codex`'s (`docs/specs/protocols/spec.md`, the Codex backend's Conversation, `apps/hub/src/shared/03-domain/item-text.ts`). Of the types the prototype's log holds, `compaction`, `compaction_trigger`, `additional_tools` and `configuration_update` are shown as `other`.
- **`bifrost-chat`**: Bifrost's Chat Completions messages, for OpenCode and Pi. Rendered, and its text read, by `openai-chat`'s rules.

No source form has a title shape, a purpose or kept headers, so an imported request's role is decided by rules 1 and 6 alone, and its session's title is the one the import reported.

## Record forms

A reported request's items are in a **record form** (ADR-0029, `docs/specs/reported-requests/spec.md`, The record form), which the request log reads wherever it reads a protocol, as it reads a source form: its `protocol` names it, and its renderer, its items' text for search, its role rule (rule 2) and its row of the first prompt's table are these.

- **`antigravity-steps`**: each item one step of an Antigravity conversation's record, its protocol buffers written out field by field without a schema. What is read of a step is the record form's **table of fields** (`03-domain/antigravity-steps.ts`, `table`), read by trial on one conversation: a user's message is a `message` whose role is `user`; the model's output is `reasoning` (its thoughts, where the step has them), a `message` whose role is `assistant` (its text, where it has one) and a `tool-call` per call (its id, name and arguments as JSON text), in that order, and a `message` with no parts when it has none of them; a tool's step is a `tool-result` (the call's id, from the step's `metadata`, and the result's text; never an error); a compaction is a `message` whose role is `assistant`, its summary. A step of a type the table does not know, one whose field the table names is missing or is not a protocol buffer by the record form's rules, and an item that is not a step, are `other`, the step's JSON. Its text for search is the text of the user's message, the model's text and its calls' arguments, the result, or the summary, joined by line breaks; a step the table does not know has none. A record has no tool definitions, so the inspector lists none.

A record form has no title shape, purpose or kept headers either: a reported session's title is the one a machine reported, and its requests are all `main`.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| T1 | **One role each.** Every request of a session has exactly one request role, and it depends on that session's requests only. | property |
| T2 | **The client's word wins.** A request that rule 2, 3, 4 or 5 decides has that role whatever the other requests of its session are. | property |
| T3 | **One main thread.** The requests that rule 6 makes `main` all have the same thread key. | property |
| T4 | **Segments cover the main conversation.** The segments are non-empty runs of consecutive main requests, in order, and every main request is in exactly one. | property |
| T5 | **Cut where the rule says, and only there.** A segment begins at a main request other than the first exactly when the size rule holds for it. | property |
| T6 | **No drop inside a segment.** Within a segment, no `ok` request with a prompt size has one under half of the previous such request's. | property |
| T7 | **The tip.** A segment's tip is its last `ok` request, or its last request when none is `ok`. | property |
| T8 | **Reported beats generated.** A session with a non-empty latest report shows it; otherwise its generated title if it has one; otherwise none. | property |
| T9 | **The latest report wins, in any order.** Storing the same reports in any order, and any of them twice, gives every session the same reported title. | property, clickhouse |
| T10 | **Nothing dropped, nothing invented.** For every request, the items its transcript's entries come from are, in order, exactly the items of its system, input and output parts, a run of one item repeated taken as one on either side. | property, replay |
| T11 | **Cuts are counted.** For every text in an entry, its length plus `cut` is the length of the text before cutting, and `cut` is 0 when the text fits. | property |
| T12 | **The first prompt is the person's.** A first prompt comes from a request whose role is `main`, never from a `title`, `subagent` or `utility` request. | property |

T1 to T7 run over generated sessions (`apps/hub/src/modules/request-log/05-tests/sessions.ts`): requests with generated protocols (the record form among them), purposes, kept headers, outcomes, prompt sizes around halves of each other, `system` and first-input digests shared between threads, title shapes and near misses, and requests without a conversation; T4 to T7 over generated main conversations. T1 compares the roles of a session given in two orders, and of two equal threads given latest first, where only the session's order picks the main one; T2 compares each request's role in its session alone and among other requests with the role rules 2 to 5 give it, read from this spec; T3 reads thread keys from this spec too.

T8 and T12 run `ListSessions` over the in-memory reader and titles, on generated request logs whose requests carry conversations in each protocol's shapes (`sessionLog` in the same file): main threads, subagents, title requests whose answers read as a title and ones that do not, utility requests, prompts past 500 characters, and reports of those sessions, some empty, many at the same instant. Each listed session's title and first prompt are compared with the ones these laws pick from the generated requests: T8 holds the order of report, generated title and none, and T12 that the prompt is the first main request's. Both take each request's role from `rolesOf`, which T1 to T3 hold, and read a title answer with `Title.generatedOf` and a prompt with `FirstPrompt.firstPromptOf`, the shipped readers, which `title.test.ts` and `first-prompt.test.ts` hold by example. So T8 and T12 hold how `ListSessions` puts these rules together, not the rules themselves. T9 stores generated reports, shuffled and some twice, in the in-memory titles and in a scratch ClickHouse database, and compares each session's latest with the latest by this spec's order.

T10 and T11 render generated items of each protocol's, each source form's and the record form's shapes (the record form's steps constructed from its table by a builder, `05-tests/antigravity-steps.ts`, never read from a real record) (`apps/hub/src/modules/request-log/05-tests/transcripts.ts`): every block, part and item type the rules above name, items they do not know, JSON that is not an object, empty contents, texts of characters of one to four UTF-8 bytes past the generated length, and the same item twice in a row. T11 renders each request whole and cut, and compares each text's length and `cut` with its whole length. T10 also renders the stored items of every recorded exchange (`apps/hub/src/shared/05-tests/replay`), whose transcripts must show no item or block as its JSON but those listed under "Shown as JSON on purpose", and hold none of the exchange's credentials or the replay's secrets.

## Not built, on purpose

- **Linking a Codex subagent's session to its parent's.** The parent is in `x-codex-parent-thread-id`; showing the tree is for the dashboard (Milestone 3).
- **Titles generated by OpenCode, Pi or Codex.** They have no title shape the hub can see; their titles are reported (Milestone 4).
- **A one-line summary per session.** After parity (`docs/roadmap.md`).
- **Storing roles or segments.** They are read each time, from data that does not change, so a better rule applies to every past session.
- **Matching prompt text** for any of the above (ADR-0014).
