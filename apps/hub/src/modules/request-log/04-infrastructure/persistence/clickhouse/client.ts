import {
  Clock,
  Context,
  Duration,
  Effect,
  identity,
  Layer,
  type Redacted,
  Schema,
  type Scope,
  Stream,
} from "effect";
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import type * as Request from "#shared/03-domain/request.entity.ts";

export class ClickHouseError extends Schema.TaggedError<
  ClickHouseError,
  { readonly brand: unique symbol }
>()("ClickHouseError", {
  status: Schema.Int,
  code: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    const status = this.status === 0 ? "no answer" : `status ${this.status}`;
    return `ClickHouse failed (${status}${this.code === "" ? "" : `, code ${this.code}`}): ${this.detail}`;
  }
}

export interface Connection {
  readonly url: string;
  readonly database: string;
  readonly user: string;
  readonly password: Redacted.Redacted<string>;
}

export type Settings = Readonly<Record<string, string>>;

const quotedInList = (value: string) =>
  `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

/** The characters a text takes as the value of a URL's field, percent-encoded as the HTTP client sends it. */
const sizeInUrl = (text: string) =>
  new URLSearchParams({ v: text }).toString().length - "v=".length;

/**
 * The most a list bound into a query takes of its URL. A parameter travels
 * in the URL, and ClickHouse refuses a field longer than its server's
 * `http_max_field_value_size` (128 KiB unless that server says otherwise),
 * counted percent-encoded; it reads the URL before any setting in it, so a
 * query cannot raise the limit.
 */
export const longestList = 32 * 1024;

/**
 * Values cut, in order, into lists whose `Param.strings` of each value's
 * text takes at most `longestList` of a URL, unless one value alone is more.
 */
export const listsOf = <A>(
  values: ReadonlyArray<A>,
  textOf: (value: A) => string,
): ReadonlyArray<ReadonlyArray<A>> => {
  const brackets = sizeInUrl("[]");
  const comma = sizeInUrl(",");
  const lists: Array<ReadonlyArray<A>> = [];
  let list: Array<A> = [];
  let size = brackets;
  for (const value of values) {
    const more = sizeInUrl(quotedInList(textOf(value))) + comma;
    if (list.length > 0 && size + more > longestList) {
      lists.push(list);
      list = [];
      size = brackets;
    }
    list.push(value);
    size += more;
  }
  if (list.length > 0) lists.push(list);
  return lists;
};

/**
 * A value bound to a query's `{name:Type}` placeholder, written as ClickHouse
 * reads a parameter: in its escaped text format.
 */
export class Param {
  private constructor(readonly text: string) {}

  /** A backslash starts an escape, and a tab or a line break fails the query, unless escaped. */
  static string(value: string): Param {
    return new Param(
      value
        .replaceAll("\\", "\\\\")
        .replaceAll("\t", "\\t")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r"),
    );
  }

  /** Each string quoted, its quotes and backslashes escaped. */
  static strings(values: ReadonlyArray<string>): Param {
    return new Param(`[${values.map(quotedInList).join(",")}]`);
  }

  static integer(value: number | bigint): Param {
    return new Param(String(value));
  }

  static integers(values: ReadonlyArray<number | bigint>): Param {
    return new Param(`[${values.map(String).join(",")}]`);
  }

  static uuid(value: Request.RequestId): Param {
    return new Param(value);
  }
}

export type Params = Readonly<Record<string, Param>>;

export interface Streamed {
  /** The format ClickHouse writes the answer in (`X-ClickHouse-Format`). */
  readonly format: string;
  /** The tag that frames an exception ClickHouse writes after the first rows. */
  readonly exceptionTag: string | undefined;
  /** The answer's `Content-Encoding`: `zstd` when it was asked for compressed and has bytes. */
  readonly encoding?: string | undefined;
  readonly body: Stream.Stream<Uint8Array, ClickHouseError>;
}

export interface StreamOptions {
  /** Asks for the answer compressed with zstd, and gives its bytes undecoded. */
  readonly zstd?: boolean;
  /** How long the hub waits for the answer to end, from the request; without it, as long as the answer takes. */
  readonly wait?: Duration.Duration;
}

export interface CommandOptions {
  readonly settings?: Settings;
  readonly wait?: Duration.Duration;
}

export interface Client {
  readonly database: string;
  /**
   * Runs a statement whose `{name:Type}` placeholders are bound from `params`,
   * with the settings given, waiting `wait` for it (35 seconds unless given).
   */
  readonly command: (
    sql: string,
    params?: Params,
    options?: CommandOptions,
  ) => Effect.Effect<void, ClickHouseError>;
  /**
   * Inserts rows, as JSON, in one synchronous insert: ClickHouse has written
   * them when it answers.
   */
  readonly insert: (
    table: string,
    rows: ReadonlyArray<unknown>,
    settings?: Settings,
  ) => Effect.Effect<void, ClickHouseError>;
  /**
   * Runs a read-only query whose `{name:Type}` placeholders are bound from
   * `params`. As the hub's own user, ClickHouse stops it after 30 seconds,
   * or the longest its session gives, and when its connection closes.
   */
  readonly select: <A, I>(
    sql: string,
    schema: Schema.Codec<A, I>,
    params?: Params,
  ) => Effect.Effect<ReadonlyArray<A>, ClickHouseError>;
  /**
   * Sends a query as it is, with no setting but those given, and gives its
   * answer as it arrives. Closing the scope closes the connection.
   */
  readonly stream: (
    sql: string,
    settings: Settings,
    options?: StreamOptions,
  ) => Effect.Effect<Streamed, ClickHouseError, Scope.Scope>;
  /**
   * Posts a body compressed with zstd, read as it is sent, to a query sent
   * in the URL with the settings given. A failure of the body fails it.
   */
  readonly upload: <E>(
    sql: string,
    body: Stream.Stream<Uint8Array, E>,
    settings: Settings,
    wait: Duration.Duration,
  ) => Effect.Effect<void, ClickHouseError | E>;
  /**
   * The same server, database and user, every request in one HTTP session:
   * its temporary tables are seen by nothing else, and go with it once it
   * has been idle for `timeout`. Its selects are stopped after `longest`
   * when given, rather than after 30 seconds.
   */
  readonly session: (
    id: string,
    timeout: Duration.Duration,
    longest?: Duration.Duration,
  ) => Client;
  /** The same server and database, as another user, whose selects are bound by its own settings profile. */
  readonly as: (user: string, password: Redacted.Redacted<string>) => Client;
}

export class ClickHouse extends Context.Service<ClickHouse, Client>()(
  "@cota/hub/request-log/ClickHouse",
) {}

const longestQuery = Duration.seconds(30);
/** How long the hub waits for an answer to a select ClickHouse stops at `longest`: past it, so that ClickHouse stops it first and says so. */
const waitFor = (longest: Duration.Duration) =>
  Duration.sum(longest, Duration.seconds(5));
const longestWait = waitFor(longestQuery);
const exceptionMarker = "__exception__";
const longestFailure = 64 * 1024;

const lastException = (text: string): string => {
  const at = text.lastIndexOf("Code: ");
  return at === -1 ? text : text.slice(at);
};

const failure = (status: number, detail: string, code = "") =>
  new ClickHouseError({ status, code, detail: detail.trim().slice(0, 2000) });

/**
 * The exception ClickHouse framed in an answer that had begun:
 * `__exception__`, the answer's exception tag, the message, then the
 * message's length and the tag again, and `__exception__`.
 */
export const exceptionIn = (
  text: string,
  tag: string | undefined,
): ClickHouseError | undefined => {
  if (tag === undefined) return undefined;
  const marker = `${exceptionMarker}\r\n${tag}\r\n`;
  const at = text.indexOf(marker);
  if (at === -1) return undefined;
  const framed = text.slice(at + marker.length);
  const closing = framed.indexOf(` ${tag}\r\n${exceptionMarker}`);
  const detail =
    closing === -1
      ? (framed.split("\r\n")[0] ?? "")
      : framed.slice(0, closing).replace(/\n\d+$/, "");
  return failure(200, detail, /Code: (\d+)/.exec(detail)?.[1]);
};

// ClickHouse answers JSON with 64-bit and wider integers and decimals as bare
// numbers unless told to quote them, and trims a decimal's trailing zeros.
const readSettings: Settings = {
  date_time_output_format: "iso",
  output_format_json_quote_64bit_integers: "1",
  output_format_json_quote_decimals: "1",
  output_format_decimal_trailing_zeros: "1",
};

// The hub's own user may change any setting, so its selects bound themselves:
// ClickHouse stops one at 30 seconds (error 159), and cancels one whose
// connection closes, which it does only for a read-only query. It answers
// once the query has ended: otherwise a failure after the first rows is
// written behind them as the connection closes, where it can be lost.
const hubLimits: Settings = {
  readonly: "1",
  max_execution_time: String(Duration.toSeconds(longestQuery)),
  cancel_http_readonly_queries_on_client_close: "1",
  http_wait_end_of_query: "1",
};

// Bun's fetch decompresses an answer unless told not to.
const undecoded: BunFetchRequestInit = { decompress: false };

const make = (
  connection: Connection,
  http: HttpClient.HttpClient,
  limits: Settings,
  inSession: Settings = {},
  selectWait = longestWait,
): Client => {
  const client = http.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(connection.url),
        HttpClientRequest.basicAuth(connection.user, connection.password),
        HttpClientRequest.setHeader(
          "x-clickhouse-database",
          connection.database,
        ),
        // ClickHouse compresses an answer when the client accepts it, and
        // buffers a compressed one, which turns a failure after the first
        // rows into a 500; uncompressed, it frames the failure after a 200.
        // Only the archive's exports ask for zstd.
        request.headers["accept-encoding"] === undefined
          ? HttpClientRequest.setHeader("accept-encoding", "identity")
          : identity,
      ),
    ),
  );

  const post = (body: string, settings: Settings) =>
    HttpClientRequest.post("/", {
      urlParams: { ...settings, ...inSession },
      body: HttpBody.text(body, "text/plain; charset=utf-8"),
    });

  const exchange = Effect.fn("ClickHouse.run")(function* (
    body: string,
    settings: Settings,
  ): Effect.fn.Return<string, ClickHouseError> {
    const response: HttpClientResponse.HttpClientResponse = yield* client
      .execute(post(body, settings))
      .pipe(Effect.mapError((error) => failure(0, error.message)));
    const decoder = new TextDecoder();
    let text = "";
    // ClickHouse closes the connection right after a framed exception, so
    // reading the body fails: keep what arrived and look for it.
    const broken = yield* response.stream.pipe(
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          text += decoder.decode(chunk, { stream: true });
        }),
      ),
      Effect.as(false),
      Effect.catchTag("HttpClientError", () => Effect.succeed(true)),
    );
    if (response.status !== 200) {
      return yield* failure(
        response.status,
        lastException(text),
        response.headers["x-clickhouse-exception-code"],
      );
    }
    const exception = exceptionIn(
      text,
      response.headers["x-clickhouse-exception-tag"],
    );
    if (exception !== undefined) return yield* exception;
    if (broken) return yield* failure(200, "the answer ended early");
    return text;
  });

  const run = (body: string, settings: Settings, wait = longestWait) =>
    exchange(body, settings).pipe(
      Effect.timeoutOrElse({
        duration: wait,
        orElse: () =>
          Effect.fail(failure(0, `no answer within ${Duration.format(wait)}`)),
      }),
    );

  const boundOf = (params: Params): Record<string, string> =>
    Object.fromEntries(
      Object.entries(params).map(([name, value]) => [
        `param_${name}`,
        value.text,
      ]),
    );

  const command = Effect.fn("ClickHouse.command")(function* (
    sql: string,
    params: Params = {},
    options: CommandOptions = {},
  ) {
    yield* run(sql, { ...options.settings, ...boundOf(params) }, options.wait);
  });

  const insert = Effect.fn("ClickHouse.insert")(function* (
    table: string,
    rows: ReadonlyArray<unknown>,
    settings: Settings = {},
  ) {
    if (rows.length === 0) return;
    yield* run(rows.map((row) => JSON.stringify(row)).join("\n"), {
      ...settings,
      query: `INSERT INTO ${table} FORMAT JSONEachRow`,
      async_insert: "0",
      date_time_input_format: "best_effort",
    });
  });

  const select = Effect.fn("ClickHouse.select")(function* <A, I>(
    sql: string,
    schema: Schema.Codec<A, I>,
    params: Params = {},
  ): Effect.fn.Return<ReadonlyArray<A>, ClickHouseError> {
    const text = yield* run(
      `${sql} FORMAT JSONEachRow`,
      { ...readSettings, ...limits, ...boundOf(params) },
      selectWait,
    );
    const lines = text.split("\n").filter((line) => line !== "");
    return yield* Schema.decodeEffect(
      Schema.Array(Schema.fromJsonString(schema)),
    )(lines).pipe(Effect.mapError((error) => failure(200, error.message)));
  });

  const stream = Effect.fn("ClickHouse.stream")(function* (
    sql: string,
    settings: Settings,
    options: StreamOptions = {},
  ): Effect.fn.Return<Streamed, ClickHouseError, Scope.Scope> {
    const request = post(sql, settings);
    const { wait } = options;
    const began = yield* Clock.currentTimeMillis;
    const response = yield* HttpClient.withScope(client)
      .execute(
        options.zstd === true
          ? HttpClientRequest.setHeader(request, "accept-encoding", "zstd")
          : request,
      )
      .pipe(
        options.zstd === true
          ? Effect.provideService(FetchHttpClient.RequestInit, undecoded)
          : identity,
        Effect.mapError((error) => failure(0, error.message)),
        wait === undefined
          ? identity
          : Effect.timeoutOrElse({
              duration: wait,
              orElse: () =>
                Effect.fail(
                  failure(0, `no answer within ${Duration.format(wait)}`),
                ),
            }),
      );
    const answered = response.stream.pipe(
      Stream.mapError(() => failure(0, "the answer ended early")),
    );
    const body =
      wait === undefined
        ? answered
        : answered.pipe(
            Stream.interruptWhen(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;
                yield* Effect.sleep(
                  Math.max(0, began + Duration.toMillis(wait) - now),
                );
                return yield* failure(
                  0,
                  `no end within ${Duration.format(wait)}`,
                );
              }),
            ),
          );
    if (response.status !== 200) {
      const decoder = new TextDecoder();
      let text = "";
      yield* body.pipe(
        Stream.runForEachWhile((chunk) =>
          Effect.sync(() => {
            text += decoder.decode(chunk, { stream: true });
            return text.length < longestFailure;
          }),
        ),
        Effect.ignore,
      );
      return yield* failure(
        response.status,
        lastException(text),
        response.headers["x-clickhouse-exception-code"],
      );
    }
    return {
      format: response.headers["x-clickhouse-format"] ?? "",
      exceptionTag: response.headers["x-clickhouse-exception-tag"],
      encoding: response.headers["content-encoding"],
      body,
    };
  });

  const upload = Effect.fn("ClickHouse.upload")(function* <E>(
    sql: string,
    body: Stream.Stream<Uint8Array, E>,
    settings: Settings,
    wait: Duration.Duration,
  ): Effect.fn.Return<void, ClickHouseError | E> {
    let broken: { readonly error: E } | undefined;
    const sent = body.pipe(
      Stream.tapError((error) =>
        Effect.sync(() => {
          broken = { error };
        }),
      ),
    );
    const answered = yield* Effect.result(
      client
        .execute(
          HttpClientRequest.post("/", {
            urlParams: { ...settings, ...inSession, query: sql },
            headers: { "content-encoding": "zstd" },
            body: HttpBody.stream(sent, "application/octet-stream"),
          }),
        )
        .pipe(
          Effect.flatMap((response) =>
            Effect.map(response.text, (text) => ({ response, text })),
          ),
          Effect.mapError((error) => failure(0, error.message)),
          Effect.timeoutOrElse({
            duration: wait,
            orElse: () =>
              Effect.fail(
                failure(0, `no answer within ${Duration.format(wait)}`),
              ),
          }),
        ),
    );
    if (broken !== undefined) return yield* Effect.fail(broken.error);
    if (answered._tag === "Failure") return yield* answered.failure;
    const { response, text } = answered.success;
    if (response.status !== 200) {
      return yield* failure(
        response.status,
        lastException(text),
        response.headers["x-clickhouse-exception-code"],
      );
    }
  });

  return {
    database: connection.database,
    command,
    insert,
    select,
    stream,
    upload,
    session: (id, timeout, longest) =>
      make(
        connection,
        http,
        longest === undefined
          ? limits
          : {
              ...limits,
              max_execution_time: String(Duration.toSeconds(longest)),
            },
        {
          ...inSession,
          session_id: id,
          session_timeout: String(Duration.toSeconds(timeout)),
        },
        longest === undefined ? selectWait : waitFor(longest),
      ),
    as: (user, password) => make({ ...connection, user, password }, http, {}),
  };
};

// A user ClickHouse makes read-only (`readonly = 2`) may change every setting
// but `readonly` itself, and refuses a query that sets it, even to 1.
const { readonly: _, ...readOnlyUserLimits } = hubLimits;

// Another server's settings profile may cap an answer, or what a query reads,
// sorts, groups or joins, and with an overflow mode of `break` (or `any`)
// ClickHouse ends the answer early with no error, as if the rows ran out.
// The caps on an answer's own size are lifted, since the import bounds each
// of its answers by pages and chunks; every other overflow throws.
const wholeAnswers: Settings = {
  max_result_rows: "0",
  max_result_bytes: "0",
  read_overflow_mode: "throw",
  read_overflow_mode_leaf: "throw",
  timeout_overflow_mode: "throw",
  timeout_overflow_mode_leaf: "throw",
  sort_overflow_mode: "throw",
  group_by_overflow_mode: "throw",
  distinct_overflow_mode: "throw",
  set_overflow_mode: "throw",
  join_overflow_mode: "throw",
  transfer_overflow_mode: "throw",
};

const sourceLimits: Settings = { ...readOnlyUserLimits, ...wholeAnswers };

/**
 * A client of a server other than the request log's, as a user that server
 * makes read-only: its selects are bound as the hub's own are, but for the
 * `readonly` setting, which that user may not send, and an answer is whole
 * or fails, whatever that user's settings profile caps.
 */
export const connect = (
  connection: Connection,
  http: HttpClient.HttpClient,
): Client => make(connection, http, sourceLimits);

export const layer = (
  connection: Connection,
): Layer.Layer<ClickHouse, never, HttpClient.HttpClient> =>
  Layer.effect(
    ClickHouse,
    Effect.map(HttpClient.HttpClient, (http) =>
      ClickHouse.of(make(connection, http, hubLimits)),
    ),
  );
