import { Option, Schema } from "effect";
import type * as ExchangeFile from "#modules/recording/03-domain/exchange-file.ts";
import * as Client from "#shared/03-domain/client.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Vocabulary from "./vocabulary.ts";

export { vocabularies } from "./vocabulary.ts";

type Json = Schema.Json;
type Path = ReadonlyArray<string | number>;

const isObject = (value: Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);

const lengthClassOf = (length: number): string => {
  if (length <= 8) return "s";
  if (length <= 64) return "m";
  if (length <= 1024) return "l";
  return "xl";
};

/** What a string the scrubber does not keep becomes: a word that tells only how long it was, as one of four classes. */
export const filler = (text: string): string =>
  text === "" ? "" : `scrubbed:${lengthClassOf(text.length)}`;

/** What a key the client's user chose becomes: its position among the replaced keys of its object. */
export const keyFiller = (position: number): string =>
  `scrubbed-key-${position}`;

/** Recognises a filler or a filled key, for the review of an exchange file. */
export const isFiller = (text: string): boolean =>
  /^scrubbed:(s|m|l|xl)$|^scrubbed-key-\d+$|^scrubbed$/.test(text);

/**
 * The fakes of one recording run. The same real value always gets the same
 * fake, so two exchanges of one session still share it; a fake is counted,
 * never computed from the real value, so it cannot be turned back into it.
 */
export interface Fakes {
  readonly identifier: (real: string) => string;
  readonly number: (real: number) => number;
  readonly login: (protocol: ProtocolName, real: string) => string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const counted = (count: number): string => String(count).padStart(4, "0");

const fakeIdentifier = (real: string, count: number): string => {
  if (uuid.test(real)) {
    return `00000000-0000-4000-8000-${count.toString(16).padStart(12, "0")}`;
  }
  const prefix = Vocabulary.identifierPrefixes.find((each) =>
    real.startsWith(each),
  );
  return prefix === undefined
    ? `fake-id-${counted(count)}`
    : `${prefix}FAKE${counted(count)}`;
};

const authClaims = "https://api.openai.com/auth";
const fingerprintClaims = ["chatgpt_account_id", "chatgpt_account_user_id"];
const jwtShape = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*$/;
const base64Url = (value: Json): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const fakeSignature = Buffer.from("FAKE-signature-for-tests-only").toString(
  "base64url",
);

const claimsOf = (token: string): Option.Option<Schema.JsonObject> => {
  if (!jwtShape.test(token)) return Option.none();
  const payload = token.split(".")[1] ?? "";
  return Option.filter(
    parseJson(Buffer.from(payload, "base64url").toString("utf8")),
    isObject,
  );
};

const fakeJwt = (
  claims: Schema.JsonObject,
  identifier: (real: string) => string,
): string => {
  const auth = claims[authClaims];
  const faked: Record<string, Json> = {};
  if (auth !== undefined && isObject(auth)) {
    for (const name of fingerprintClaims) {
      const real = auth[name];
      if (typeof real === "string") faked[name] = identifier(real);
    }
  }
  const payload =
    Object.keys(faked).length === 0 ? {} : { [authClaims]: faked };
  return `${base64Url({ alg: "RS256", typ: "JWT" })}.${base64Url(payload)}.${fakeSignature}`;
};

const loginPrefixOf = (protocol: ProtocolName, real: string): string => {
  switch (protocol) {
    case "anthropic-messages":
      return real.startsWith("sk-ant-api")
        ? "sk-ant-api03-FAKE-key-for-tests-only-"
        : "sk-ant-oat01-FAKE-login-for-tests-only-";
    case "chatgpt-codex":
      return "FAKE-login-for-tests-only-";
    case "openai-chat":
      return "cota-FAKE-hub-key-for-tests-";
  }
};

/** Starts the fakes of a recording run. */
export const makeFakes = (): Fakes => {
  const identifiers = new Map<string, string>();
  const numbers = new Map<number, number>();
  const logins = new Map<string, string>();
  const identifier = (real: string): string => {
    if (real === "") return "";
    const known = identifiers.get(real);
    if (known !== undefined) return known;
    const fake = fakeIdentifier(real, identifiers.size + 1);
    identifiers.set(real, fake);
    return fake;
  };
  return {
    identifier,
    number: (real) => {
      const known = numbers.get(real);
      if (known !== undefined) return known;
      const fake = 1_000_000 + numbers.size + 1;
      numbers.set(real, fake);
      return fake;
    },
    login: (protocol, real) => {
      if (real === "") return "";
      const known = logins.get(real);
      if (known !== undefined) return known;
      const fake = Option.match(claimsOf(real), {
        onSome: (claims) => fakeJwt(claims, identifier),
        onNone: () => `${loginPrefixOf(protocol, real)}${counted(logins.size)}`,
      });
      logins.set(real, fake);
      return fake;
    },
  };
};

/** Scrubs a value that belongs to the client's user: every key, string and number in it is replaced. */
export const asContent = (value: Json): Json => {
  if (typeof value === "string") return filler(value);
  if (typeof value === "number") return 0;
  if (Array.isArray(value)) return value.map(asContent);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.values(value).map((each, at) => [
        keyFiller(at + 1),
        asContent(each),
      ]),
    );
  }
  return value;
};

interface Scrubbing {
  readonly protocol: ProtocolName;
  readonly vocabulary: Vocabulary.Vocabulary;
  readonly fakes: Fakes;
}

const own = <A>(
  record: Readonly<Record<string, A>>,
  key: string,
): A | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

const scrubNested = (
  scrubbing: Scrubbing,
  nested: Vocabulary.Nested,
  text: string,
): Option.Option<string> =>
  parseJson(text).pipe(
    Option.filter((parsed) => typeof parsed === "object" && parsed !== null),
    Option.map((parsed) =>
      JSON.stringify(
        nested === "protocol"
          ? scrubJson(scrubbing, parsed, undefined)
          : asContent(parsed),
      ),
    ),
  );

const scrubString = (
  scrubbing: Scrubbing,
  text: string,
  key: string | undefined,
): string => {
  if (key === undefined) return filler(text);
  const { vocabulary, fakes } = scrubbing;
  const nested = own(vocabulary.json, key);
  if (nested !== undefined) {
    const scrubbed = scrubNested(scrubbing, nested, text);
    if (Option.isSome(scrubbed)) return scrubbed.value;
  }
  if (vocabulary.identifiers.has(key)) return fakes.identifier(text);
  const rule = own(vocabulary.values, key);
  if (rule?.(text)) return text;
  return filler(text);
};

const scrubObject = (scrubbing: Scrubbing, object: Schema.JsonObject): Json => {
  const { vocabulary } = scrubbing;
  let unknown = 0;
  return Object.fromEntries(
    Object.entries(object).map(([key, value]): [string, Json] => {
      if (!vocabulary.keys.has(key)) {
        unknown++;
        return [keyFiller(unknown), asContent(value)];
      }
      if (vocabulary.content.has(key)) return [key, asContent(value)];
      const needed = own(vocabulary.beside, key);
      if (needed !== undefined && !Object.hasOwn(object, needed)) {
        return [key, asContent(value)];
      }
      if (vocabulary.headerMaps.has(key) && isObject(value)) {
        const strings = Object.fromEntries(
          Object.entries(value).flatMap(([name, each]) =>
            typeof each === "string" ? [[name, each]] : [],
          ),
        );
        return [key, scrubHeaders(scrubbing, strings, "response")];
      }
      return [key, scrubJson(scrubbing, value, key)];
    }),
  );
};

const scrubJson = (
  scrubbing: Scrubbing,
  value: Json,
  key: string | undefined,
): Json => {
  if (typeof value === "string") return scrubString(scrubbing, value, key);
  if (typeof value === "number") {
    return key !== undefined && scrubbing.vocabulary.identifiers.has(key)
      ? scrubbing.fakes.number(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((each: Json) => scrubJson(scrubbing, each, key));
  }
  if (isObject(value)) return scrubObject(scrubbing, value);
  return value;
};

const product = /^([^\s/]+)\/([0-9][0-9A-Za-z.+-]{0,40})(?:\s|$)/;

const userAgentOf = (value: string): string => {
  const found = product.exec(value.trim());
  const { client } = Client.of("", value);
  return found !== null && Vocabulary.knownClients.includes(client)
    ? `${found[1]}/${found[2]}`
    : filler(value);
};

const loginHeader = (scrubbing: Scrubbing, value: string): string => {
  const bearer = /^(bearer)\s+(\S+)\s*$/i.exec(value.trim());
  return bearer === null
    ? scrubbing.fakes.login(scrubbing.protocol, value.trim())
    : `${bearer[1]} ${scrubbing.fakes.login(scrubbing.protocol, bearer[2] ?? "")}`;
};

const headerValue = (
  scrubbing: Scrubbing,
  rule: Vocabulary.HeaderRule,
  value: string,
): string => {
  switch (rule._tag) {
    case "Keep":
      return rule.rule(value.trim()) ? value : filler(value);
    case "List": {
      const items = value.split(",").map((item) => item.trim());
      const kept = items.filter((item) => rule.item(item));
      if (kept.length === 0) return filler(value);
      return kept.join(value.includes(", ") ? ", " : ",");
    }
    case "Identifier":
      return scrubbing.fakes.identifier(value);
    case "Login":
      return loginHeader(scrubbing, value);
    case "Json":
      return Option.getOrElse(scrubNested(scrubbing, "protocol", value), () =>
        filler(value),
      );
    case "UserAgent":
      return userAgentOf(value);
  }
};

const scrubHeaders = (
  scrubbing: Scrubbing,
  headers: Readonly<Record<string, string>>,
  direction: "request" | "response",
): Record<string, string> => {
  const table =
    direction === "request"
      ? Vocabulary.requestHeaders
      : Vocabulary.responseHeaders;
  const scrubbed: Record<string, string> = {};
  for (const [given, value] of Object.entries(headers)) {
    const name = given.toLowerCase();
    const rule = own(table, name);
    if (rule !== undefined) {
      scrubbed[name] = headerValue(scrubbing, rule, value);
    } else if (direction === "response" && Vocabulary.isQuotaHeader(name)) {
      scrubbed[name] = Option.getOrElse(
        Vocabulary.quotaShapeOf(name, value.trim()),
        () => filler(value),
      );
    }
  }
  return scrubbed;
};

interface Fragment {
  readonly event: number;
  readonly path: Path;
  readonly group: string;
  readonly text: string;
}

const at = (value: Json | undefined, ...path: Path): Json | undefined => {
  let current = value;
  for (const step of path) {
    if (current === undefined) return undefined;
    if (typeof step === "number") {
      current = Array.isArray(current) ? current[step] : undefined;
    } else {
      current = isObject(current) ? current[step] : undefined;
    }
  }
  return current;
};

const listAt = (
  value: Json | undefined,
  ...path: Path
): ReadonlyArray<Json> => {
  const found = at(value, ...path);
  return Array.isArray(found) ? found : [];
};

const fragmentsOf: Readonly<
  Record<
    ProtocolName,
    (events: ReadonlyArray<ExchangeFile.Event>) => ReadonlyArray<Fragment>
  >
> = {
  "anthropic-messages": (events) =>
    events.flatMap(({ data }, event) => {
      const text = at(data, "delta", "partial_json");
      return at(data, "type") === "content_block_delta" &&
        at(data, "delta", "type") === "input_json_delta" &&
        typeof text === "string"
        ? [
            {
              event,
              path: ["delta", "partial_json"],
              group: String(at(data, "index")),
              text,
            },
          ]
        : [];
    }),
  "chatgpt-codex": (events) =>
    events.flatMap(({ data }, event) => {
      const text = at(data, "delta");
      return at(data, "type") === "response.function_call_arguments.delta" &&
        typeof text === "string"
        ? [
            {
              event,
              path: ["delta"],
              group: String(at(data, "item_id") ?? at(data, "output_index")),
              text,
            },
          ]
        : [];
    }),
  "openai-chat": (events) =>
    events.flatMap(({ data }, event) =>
      listAt(data, "choices").flatMap((choice, c) =>
        listAt(choice, "delta", "tool_calls").flatMap((call, t) => {
          const text = at(call, "function", "arguments");
          return typeof text === "string"
            ? [
                {
                  event,
                  path: [
                    "choices",
                    c,
                    "delta",
                    "tool_calls",
                    t,
                    "function",
                    "arguments",
                  ],
                  group: `${String(at(choice, "index") ?? c)}:${String(at(call, "index") ?? t)}`,
                  text,
                },
              ]
            : [];
        }),
      ),
    ),
};

const replacedAt = (value: Json, path: Path, replacement: Json): Json => {
  const [step, ...rest] = path;
  if (step === undefined) return replacement;
  if (typeof step === "number") {
    return Array.isArray(value) && step < value.length
      ? value.map((each: Json, index) =>
          index === step ? replacedAt(each, rest, replacement) : each,
        )
      : value;
  }
  return isObject(value) && Object.hasOwn(value, step)
    ? { ...value, [step]: replacedAt(value[step] ?? null, rest, replacement) }
    : value;
};

/** Cuts a text into pieces in the proportions of the given lengths, so that the pieces join back into it. */
export const cut = (
  whole: string,
  lengths: ReadonlyArray<number>,
): ReadonlyArray<string> => {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let sofar = 0;
  let from = 0;
  return lengths.map((length, index) => {
    sofar += length;
    const to =
      index === lengths.length - 1 || total === 0
        ? whole.length
        : Math.round((sofar / total) * whole.length);
    const piece = whole.slice(from, Math.max(from, to));
    from = Math.max(from, to);
    return piece;
  });
};

const scrubbedFragments = (
  scrubbing: Scrubbing,
  original: ReadonlyArray<ExchangeFile.Event>,
  scrubbed: ReadonlyArray<ExchangeFile.Event>,
): ReadonlyArray<ExchangeFile.Event> => {
  const groups = new Map<string, Array<Fragment>>();
  for (const fragment of fragmentsOf[scrubbing.protocol](original)) {
    groups.set(fragment.group, [
      ...(groups.get(fragment.group) ?? []),
      fragment,
    ]);
  }
  const events = [...scrubbed];
  for (const fragments of groups.values()) {
    const whole = Option.getOrElse(
      scrubNested(
        scrubbing,
        "content",
        fragments.map(({ text }) => text).join(""),
      ),
      () => "",
    );
    const pieces = cut(
      whole,
      fragments.map(({ text }) => text.length),
    );
    fragments.forEach(({ event, path }, index) => {
      const target = events[event];
      if (target === undefined) return;
      events[event] = {
        ...target,
        data: replacedAt(target.data, path, pieces[index] ?? ""),
      };
    });
  }
  return events;
};

const scrubEvents = (
  scrubbing: Scrubbing,
  events: ReadonlyArray<ExchangeFile.Event>,
): ReadonlyArray<ExchangeFile.Event> => {
  const isWord = own(scrubbing.vocabulary.values, "type");
  const scrubbed = events.map(
    ({ event, data }): ExchangeFile.Event => ({
      ...(event === undefined
        ? {}
        : { event: isWord?.(event) ? event : filler(event) }),
      data:
        typeof data === "string"
          ? Vocabulary.eventWords(data)
            ? data
            : filler(data)
          : scrubJson(scrubbing, data, undefined),
    }),
  );
  return scrubbedFragments(scrubbing, events, scrubbed);
};

const scrubBody = (
  scrubbing: Scrubbing,
  body: ExchangeFile.Body,
): ExchangeFile.Body => {
  if ("json" in body)
    return { json: scrubJson(scrubbing, body.json, undefined) };
  if ("text" in body) return { text: filler(body.text) };
  if ("base64" in body) return { text: filler(body.base64) };
  return { events: scrubEvents(scrubbing, body.events) };
};

const scrubPath = (vocabulary: Vocabulary.Vocabulary, path: string): string => {
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? "" : path.slice(queryAt + 1);
  const kept = vocabulary.paths.has(pathname)
    ? pathname
    : pathname
        .split("/")
        .map((segment) =>
          segment === "" || vocabulary.segments.has(segment)
            ? segment
            : "scrubbed",
        )
        .join("/");
  const params = query
    .split("&")
    .filter((pair) => pair !== "")
    .filter((pair) => {
      const equals = pair.indexOf("=");
      const name = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? "" : pair.slice(equals + 1);
      return own(vocabulary.query, name)?.(value) === true;
    });
  return params.length === 0 ? kept : `${kept}?${params.join("&")}`;
};

/**
 * Scrubs an exchange of a protocol for its file: what is not positively
 * known to be one of the protocol's own words is replaced, and identifiers
 * and logins become the run's fakes.
 */
export const scrub = (
  protocol: ProtocolName,
  exchange: ExchangeFile.Exchange,
  fakes: Fakes,
): ExchangeFile.Exchange => {
  const scrubbing: Scrubbing = {
    protocol,
    vocabulary: Vocabulary.vocabularies[protocol],
    fakes,
  };
  const { request, response } = exchange;
  const requestHeaders = scrubHeaders(scrubbing, request.headers, "request");
  const requestBody =
    request.body === undefined ? undefined : scrubBody(scrubbing, request.body);
  const responseHeaders = scrubHeaders(scrubbing, response.headers, "response");
  const responseBody =
    response.body === undefined
      ? undefined
      : scrubBody(scrubbing, response.body);
  return {
    request: {
      method: request.method,
      path: scrubPath(scrubbing.vocabulary, request.path),
      headers: requestHeaders,
      ...(requestBody === undefined ? {} : { body: requestBody }),
    },
    response: {
      status: response.status,
      headers: responseHeaders,
      ...(responseBody === undefined ? {} : { body: responseBody }),
    },
  };
};

const version = /^[0-9][0-9A-Za-z.+-]{0,40}$/;

/** Where a recorded exchange came from: the day, and the client and version its user agent names when the client is one Cota knows. */
export const sourceOf = (
  headers: Readonly<Record<string, string>>,
  date: string,
): ExchangeFile.Source => {
  const found = Client.of("", headers["user-agent"] ?? "");
  return Vocabulary.knownClients.includes(found.client) &&
    version.test(found.version)
    ? { kind: "recorded", date, client: found.client, version: found.version }
    : { kind: "recorded", date, client: "unknown", version: "" };
};

/**
 * The file of an exchange the hub recorded, scrubbed. Its expectation is left
 * empty, for `bun run replay:expect` to fill once it is reviewed.
 */
export const exchangeFileOf = (
  protocol: ProtocolName,
  exchange: ExchangeFile.Exchange,
  fakes: Fakes,
  date: string,
): ExchangeFile.ExchangeFile => ({
  source: sourceOf(exchange.request.headers, date),
  ...scrub(protocol, exchange, fakes),
  expects: { logged: null },
});

/** The text of an exchange file, as the recorder writes it. */
export const fileText = (exchangeFile: ExchangeFile.ExchangeFile): string =>
  `${JSON.stringify(exchangeFile, null, 2)}\n`;
