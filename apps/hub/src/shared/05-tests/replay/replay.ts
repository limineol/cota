import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, deflateSync } from "node:zlib";
import { DateTime, Effect, Option, Schema } from "effect";
import * as ExchangeFile from "#modules/recording/03-domain/exchange-file.ts";
import { Recorded } from "#modules/request-log/05-tests/fakes/record-request.fake.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

export const directory = fileURLToPath(new URL("./exchanges", import.meta.url));

type Event = ExchangeFile.Event;

export {
  Body,
  ExchangeFile,
  Source,
} from "#modules/recording/03-domain/exchange-file.ts";

export interface Loaded {
  readonly file: string;
  readonly protocol: ProtocolName;
  readonly exchange: ExchangeFile.ExchangeFile;
}

const decodeExchangeFile = Schema.decodeUnknownSync(
  Schema.fromJsonString(ExchangeFile.ExchangeFile),
);
const decodeProtocol = Schema.decodeUnknownSync(ProtocolName);

/** Reads every exchange file under `directory`, one protocol per folder. */
export const load = (): ReadonlyArray<Loaded> =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((one, other) => one.name.localeCompare(other.name))
    .flatMap((folder) =>
      readdirSync(join(directory, folder.name))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => {
          const file = `${folder.name}/${name}`;
          try {
            return {
              file,
              protocol: decodeProtocol(folder.name),
              exchange: decodeExchangeFile(
                readFileSync(join(directory, file), "utf8"),
              ),
            };
          } catch (error) {
            throw new Error(
              `exchanges/${file} is not an exchange file: ${error}`,
            );
          }
        }),
    );

const encoder = new TextEncoder();

const eventText = ({ event, data }: Event): string =>
  `${event === undefined ? "" : `event: ${event}\n`}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

const pieces = (
  body: ExchangeFile.Body | undefined,
): ReadonlyArray<Uint8Array> => {
  if (body === undefined) return [];
  if ("json" in body) return [encoder.encode(JSON.stringify(body.json))];
  if ("text" in body) return [encoder.encode(body.text)];
  if ("events" in body) {
    return body.events.map((event) => encoder.encode(eventText(event)));
  }
  return [new Uint8Array(Buffer.from(body.base64, "base64"))];
};

const joined = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const whole = new Uint8Array(
    parts.reduce((size, part) => size + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    whole.set(part, offset);
    offset += part.byteLength;
  }
  return whole;
};

const encoded = (
  bytes: Uint8Array,
  contentEncoding: string | undefined,
): Uint8Array => {
  switch (contentEncoding?.trim().toLowerCase() ?? "") {
    case "":
    case "identity":
      return bytes;
    case "gzip":
      return new Uint8Array(Bun.gzipSync(new Uint8Array(bytes)));
    case "deflate":
      return new Uint8Array(deflateSync(bytes));
    case "br":
      return new Uint8Array(brotliCompressSync(bytes));
    case "zstd":
      return new Uint8Array(Bun.zstdCompressSync(bytes));
    default:
      throw new Error(`an exchange cannot be encoded as ${contentEncoding}`);
  }
};

const notPlayed = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "host",
]);

const played = (headers: Readonly<Record<string, string>>) =>
  Object.entries(headers).filter(([name]) => !notPlayed.has(name));

/** The bytes an exchange's request body crosses the wire as. */
export const requestBytes = (exchange: ExchangeFile.ExchangeFile): Uint8Array =>
  encoded(
    joined(pieces(exchange.request.body)),
    exchange.request.headers["content-encoding"],
  );

export const chunkings = ["whole", "by event", "every 7 bytes"] as const;
export type Chunking = (typeof chunkings)[number];

/**
 * The chunks the fake provider sends an exchange's response in: whole, one
 * event to a chunk (when it is neither compressed nor anything but events),
 * or seven bytes at a time, which cuts events and characters apart.
 */
export const responseChunks = (
  exchange: ExchangeFile.ExchangeFile,
  chunking: Chunking,
): ReadonlyArray<Uint8Array> => {
  const coding = exchange.response.headers["content-encoding"];
  const parts = pieces(exchange.response.body);
  const whole = encoded(joined(parts), coding);
  switch (chunking) {
    case "whole":
      return whole.byteLength === 0 ? [] : [whole];
    case "by event":
      return coding === undefined ? parts : [whole];
    case "every 7 bytes":
      return Array.from({ length: Math.ceil(whole.byteLength / 7) }, (_, at) =>
        whole.subarray(at * 7, at * 7 + 7),
      );
  }
};

/** The hub and fake provider every exchange is replayed through. */
export const layer = Harness.layer({ relay: "copy_capacity = 4096" });

export const poolOf: Readonly<Record<ProtocolName, string>> = {
  "anthropic-messages": "solo",
  "chatgpt-codex": "codex",
  "openai-chat": "work",
};

const hubKeyOf: Readonly<Record<ProtocolName, string>> = {
  "anthropic-messages": Harness.secrets.clientsHubKey,
  "chatgpt-codex": Harness.secrets.clientsHubKey,
  "openai-chat": Harness.secrets.fleetHubKey,
};

export interface Replay extends Loaded {
  readonly chunking: Chunking;
  readonly sent: Uint8Array;
  readonly seen: FakeProvider.Seen;
  readonly served: Uint8Array;
  readonly status: number;
  readonly received: Uint8Array;
  readonly answerHeaders: ReadonlyArray<readonly [string, string]>;
  readonly answeredAs: string;
  readonly reached: number;
  readonly logged: Request.ForwardedRequest;
}

/**
 * Plays an exchange's request at the hub and serves its response from the fake
 * provider, and gives what each side saw and the request the request log was given.
 */
export const replay = Effect.fn("Replay.replay")(function* (
  loaded: Loaded,
  chunking: Chunking,
) {
  const fake = yield* FakeProvider.FakeProvider;
  const recorded = yield* Recorded;
  const { request, response } = loaded.exchange;
  const chunks = responseChunks(loaded.exchange, chunking);
  fake.forget();
  fake.answer({
    status: response.status,
    headers: played(response.headers),
    chunks,
  });
  const sent = requestBytes(loaded.exchange);
  const answer = yield* Harness.send(
    `/pools/${poolOf[loaded.protocol]}${request.path}`,
    {
      method: request.method,
      headers: [
        ...played(request.headers),
        ["x-cota-key", hubKeyOf[loaded.protocol]],
      ],
      ...(request.body === undefined ? {} : { body: sent }),
    },
  );
  const received = yield* Harness.bytesOf(answer);
  const logged = yield* recorded.take;
  return {
    ...loaded,
    chunking,
    sent,
    seen: fake.last(),
    served: joined(chunks),
    status: answer.status,
    received,
    answerHeaders: [...answer.headers],
    answeredAs: answer.headers.get("x-cota-request") ?? "",
    reached: fake.seen().length,
    logged,
  } satisfies Replay;
});

const itemView = ({ digest, type, role, text }: Conversation.Item) => ({
  digest,
  type,
  role,
  text,
});

const orNull = <A>(option: Option.Option<A>): A | null =>
  Option.getOrNull(option);

/**
 * The logged request as an exchange file expects it: without what differs on every
 * run (its id and times) or is the replay's own choice (the hub key, the pool
 * and its provider), and with each item's content left to the laws.
 */
export const expectationOf = ({
  origin,
  ...request
}: Request.ForwardedRequest): Schema.Json => ({
  session:
    request.session === `request:${request.id}`
      ? "request:<id>"
      : request.session,
  sessionSource: origin.sessionSource,
  machine: request.machine,
  project: request.project,
  client: request.client,
  clientVersion: request.clientVersion,
  userAgent: origin.userAgent,
  divertedFrom: orNull(origin.divertedFrom),
  follows: Option.isSome(origin.follows) ? "<request>" : null,
  loginFingerprint: orNull(origin.loginFingerprint),
  refusalReset: orNull(Option.map(origin.refusalReset, DateTime.formatIso)),
  protocol: origin.protocol,
  operation: request.operation,
  purpose: origin.purpose,
  model: request.model,
  servedModel: origin.servedModel,
  stream: origin.stream,
  outcome: request.outcome,
  upstreamStatus: origin.upstreamStatus,
  errorType: request.errorType,
  errorMessage: request.errorMessage,
  stopReason: request.stopReason,
  usage: orNull(
    Option.map(request.usage, ({ tokens, reasoning, reported }) => ({
      tokens: { ...tokens },
      reasoning,
      reported,
    })),
  ),
  serviceTier: origin.serviceTier,
  providerRequestId: request.providerRequestId,
  rateLimits: origin.rateLimits,
  clientHeaders: origin.clientHeaders,
  conversation: orNull(
    Option.map(request.conversation, (conversation) => ({
      params: conversation.params,
      layout: conversation.layout.map((placement) => ({ ...placement })),
      overlay: conversation.overlay.map((taken) => ({
        ...taken,
        path: [...taken.path],
      })),
      system: conversation.system.map(itemView),
      tools: conversation.tools.map(itemView),
      input: conversation.input.map(itemView),
      output: conversation.output.map(itemView),
    })),
  ),
  errorBody: origin.errorBody,
  requestBytes: origin.requestBytes,
  responseBytes: origin.responseBytes,
  readingComplete: origin.readingComplete,
});
