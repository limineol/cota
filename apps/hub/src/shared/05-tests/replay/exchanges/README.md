# Exchanges

Each file here is one exchange with a provider as the hub saw it: the request a client sent, the response the provider gave, and the request the hub should log for it (ADR-0008). There is one JSON file per exchange, in the folder of its protocol: `anthropic-messages/`, `chatgpt-codex/`, `openai-chat/`.

`apps/hub/src/shared/05-tests/replay/replay.test.ts` replays every file here through the real hub and a fake provider on real sockets. A new file needs no code.

## The format

```json
{
  "source": {
    "kind": "constructed",
    "from": ["https://docs.z.ai/api-reference/api-code"],
    "note": "What the source does not settle."
  },
  "request": {
    "method": "POST",
    "path": "/chat/completions",
    "headers": { "content-type": "application/json" },
    "body": { "json": { "model": "glm-5.2", "messages": [] } }
  },
  "response": {
    "status": 429,
    "headers": { "content-type": "application/json" },
    "body": { "json": { "error": { "code": "1302", "message": "Rate limit reached for requests" } } }
  },
  "expects": { "logged": { "outcome": "error", "…": "…" } }
}
```

- **`source`** says where the exchange came from. `constructed` means it was written from documentation: `from` names the documents or sources, and `note` what they leave open. `recorded` gives the `date`, and the `client` and `version` its user agent names (`{ "kind": "recorded", "date": "2026-11-12", "client": "claude-code", "version": "2.1.322" }`), or `unknown` for a client Cota does not know; a recorded exchange is written by the recorder and read by a person before it is committed (below).
- **`request`**: the method, the path under the pool (with its query, and with the protocol's client prefix where it has one: `/backend-api/codex/responses`), the headers, and the body. The replay adds the hub key; the hub key a client would have sent is not kept.
- **`response`**: the status, the headers and the body the provider sent.
- **A body** is one of:
  - `{ "json": … }`: a JSON value, sent as `JSON.stringify` writes it;
  - `{ "text": "…" }`: text, sent as it is;
  - `{ "events": [{ "event": "message_start", "data": … }, …] }`: an event stream, one event to an element. `event` is optional. `data` that is a string is sent as it is (`"[DONE]"`); any other JSON value is sent as `JSON.stringify` writes it. Each event is followed by a blank line;
  - `{ "base64": "…" }`: bytes, only where nothing above can hold them.

  A body is always stored decoded, a request's as much as a response's. When the headers name a `content-encoding` (`gzip`, `deflate`, `br`, `zstd`), the player compresses the body again before sending it: Codex sends its `responses` bodies as zstd. A body is absent when there is none.
- **Headers** are lower case. `content-length`, `transfer-encoding`, `connection` and `host` are not played: the player sends its own.
- **`expects.logged`** is the request the hub logs, without what differs on every run or is the replay's own choice: the id, the times, the hub key, the pool and its provider. A session the client did not name is `request:<id>`. Each conversation item is shown by its digest, `type`, `role` and text; its content is checked by the laws instead.

## Replaying

Every exchange is replayed three times: its response in one chunk, one event to a chunk, and seven bytes to a chunk, which cuts events and characters apart. Anthropic and ChatGPT exchanges are replayed at a subscription pool without a fallback pool, the others at a keyed pool with a held key. The test asserts that the provider received the bytes the client sent and the client the bytes the provider sent (R1), that no secret crossed (R2), that each exchange was logged once (R6), that the logged request is the one the file expects, that every request body splits and joins back (L1), and that every stored item comes from the body or the answer (L3).

## Writing expectations

```sh
bun run replay:expect
```

replays each exchange once and writes the request it logged into `expects`. It is never run by a test. Read the diff before committing it: a changed expectation is a changed behaviour.

## Recording

The hub records exchanges when it is started with `COTA_RECORD_TO` naming a directory (the recorder spec, `docs/specs/recorder/spec.md`, says what it records and how it is scrubbed). It warns once that it is on. Every exchange with a provider becomes one scrubbed file there; an exchange that was not recorded is logged as `exchange not recorded` with its reason, unless the provider never answered it.

```sh
COTA_RECORD_TO=/tmp/cota-recordings \
COTA_CONFIG=examples/cota.dev.toml \
COTA_DEV_CLICKHOUSE_PASSWORD=… COTA_DEV_HUB_KEY=… COTA_DEV_CLIENT_KEY=… \
bun run hub
```

Send the clients through the hub (`http://127.0.0.1:18080/pools/claude`, `…/pools/codex/backend-api/codex`), do what should be recorded, and stop the hub. Then, for each recorded exchange worth keeping:

1. **Move it** into the folder of its protocol here, and rename it for what it shows: `anthropic-messages/stream-thinking-tool-use.json`, not its time stamp.
2. **Read it.** The scrubber is built so that nothing real survives, but its allow-lists can be wrong, and a provider can put something new where a word used to be. List every string left in it:

   ```sh
   bun run replay:strings apps/hub/src/shared/05-tests/replay/exchanges/anthropic-messages/stream-thinking-tool-use.json
   ```

   prints each distinct string once, keys and header names included, with the strings inside a string that is JSON or a JWT, how often it occurs and where it first does; fillers (`scrubbed:m`, `scrubbed-key-3`) are left out. Every line must be one of: a word of the protocol (a type, role, event name, stop reason, model id, error type or code, beta flag, quota header value), a fake (`toolu_FAKE0004`, `00000000-0000-4000-8000-000000000007`, `sk-ant-oat01-FAKE-login-for-tests-only-0000`), or the client's name and version. Look hardest at the values a pattern lets through rather than a list: model ids, error codes, beta flags, `originator`, quota header words and the user agent, any of which could carry a name. Look for anything of yours: a user, host, organisation, repository, path, file or tool name, a prompt's words, an email, a URL, an account or organisation id that is not a fake. Then search the files for your own names directly (`grep -ri` for your user name, host name, email and organisation), and check that the numbers left (token counts, times, quota percentages) say nothing you would not publish.
3. **If anything real is left,** do not commit the file: fix the scrubber (its rule or list in `apps/hub/src/modules/recording/03-domain/scrubber/vocabulary.ts`), add a pinned case to `scrubber.test.ts`, and record again.
4. **Write its expectation.** A recorded exchange arrives with `"expects": { "logged": null }`. Run `bun run replay:expect`, and read what it wrote: it is what the hub now does with that exchange.
5. **Run** `bun run test`, and commit the file with its expectation.

Delete the recording directory afterwards: what is in it is scrubbed, but not yet read.
