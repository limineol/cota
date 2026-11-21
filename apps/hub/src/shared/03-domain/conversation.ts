import { Option, Schema } from "effect";

export const RequestPart = Schema.Literals(["system", "tools", "input"]);
export type RequestPart = typeof RequestPart.Type;

export const Part = Schema.Literals(["system", "tools", "input", "output"]);
export type Part = typeof Part.Type;

export const Layout = Schema.Literals(["absent", "list", "single"]);
export type Layout = typeof Layout.Type;

export const Digest = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{32}$/),
).pipe(Schema.brand("Digest"));
export type Digest = typeof Digest.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Placement = Schema.Struct({
  part: RequestPart,
  field: Schema.String,
  layout: Layout,
});
export type Placement = typeof Placement.Type;

export const Step = Schema.Union([Schema.String, Count]);
export type Step = typeof Step.Type;

export const Taken = Schema.Struct({
  part: RequestPart,
  position: Count,
  path: Schema.Array(Step),
  value: Schema.Json,
});
export type Taken = typeof Taken.Type;

export const Item = Schema.Struct({
  digest: Digest,
  type: Schema.String,
  role: Schema.String,
  content: Schema.String,
  text: Schema.String,
});
export type Item = typeof Item.Type;

export const Conversation = Schema.Struct({
  params: Schema.JsonObject,
  layout: Schema.Array(Placement),
  overlay: Schema.Array(Taken),
  system: Schema.Array(Item),
  tools: Schema.Array(Item),
  input: Schema.Array(Item),
  output: Schema.Array(Item),
});
export type Conversation = typeof Conversation.Type;

/**
 * What a protocol says about the conversation in its request bodies: which
 * top-level fields are its parts, which keys are taken out of an item at any
 * depth before it is stored, and what a person would read in an item.
 */
export interface Rules {
  readonly parts: ReadonlyArray<{
    readonly part: RequestPart;
    readonly field: string;
  }>;
  readonly takenOut: ReadonlyArray<string>;
  readonly textOf: (item: Schema.Json) => string;
}

export interface SplitPart extends Placement {
  readonly items: ReadonlyArray<Schema.Json>;
}

export interface Split {
  readonly params: Schema.JsonObject;
  readonly parts: ReadonlyArray<SplitPart>;
  readonly overlay: ReadonlyArray<Taken>;
}

export const deepest = 512;

const isObject = (value: Schema.Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withinDepth = (value: Schema.Json, depth: number): boolean => {
  if (depth > deepest) return false;
  if (Array.isArray(value)) {
    return value.every((each) => withinDepth(each, depth + 1));
  }
  if (isObject(value)) {
    return Object.values(value).every((each) => withinDepth(each, depth + 1));
  }
  return true;
};

/**
 * Writes a JSON value in its canonical form (RFC 8785): object keys sorted by
 * their UTF-16 code units, no whitespace, strings and numbers as
 * `JSON.stringify` writes them.
 */
export const canonical = (value: Schema.Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/** The first 128 bits of the SHA-256 of an item's canonical form, in hex. */
export const digestOf = (canonicalText: string): Digest =>
  Digest.make(
    new Bun.CryptoHasher("sha256")
      .update(canonicalText)
      .digest("hex")
      .slice(0, 32),
  );

export const fieldOf = (
  item: Schema.Json,
  key: string,
): Schema.Json | undefined =>
  isObject(item) && Object.hasOwn(item, key) ? item[key] : undefined;

export const stringOf = (item: Schema.Json, key: string): string => {
  const value = fieldOf(item, key);
  return typeof value === "string" ? value : "";
};

export const itemOf = (rules: Rules, item: Schema.Json): Item => {
  const content = canonical(item);
  return {
    digest: digestOf(content),
    type: stringOf(item, "type"),
    role: stringOf(item, "role"),
    content,
    text: rules.textOf(item),
  };
};

const takeOut = (
  value: Schema.Json,
  keys: ReadonlySet<string>,
  path: ReadonlyArray<Step>,
  taken: Array<{ readonly path: ReadonlyArray<Step>; value: Schema.Json }>,
): Schema.Json => {
  if (Array.isArray(value)) {
    return value.map((each: Schema.Json, index) =>
      takeOut(each, keys, [...path, index], taken),
    );
  }
  if (!isObject(value)) return value;
  const kept: Array<readonly [string, Schema.Json]> = [];
  for (const [key, each] of Object.entries(value)) {
    if (keys.has(key)) {
      taken.push({ path: [...path, key], value: each });
    } else {
      kept.push([key, takeOut(each, keys, [...path, key], taken)]);
    }
  }
  return Object.fromEntries(kept);
};

export const split = (rules: Rules, body: Schema.JsonObject): Split => {
  const fields = new Set(rules.parts.map(({ field }) => field));
  const keys = new Set(rules.takenOut);
  const overlay: Array<Taken> = [];
  const parts = rules.parts.map(({ part, field }): SplitPart => {
    if (!Object.hasOwn(body, field)) {
      return { part, field, layout: "absent", items: [] };
    }
    const value = body[field] ?? null;
    const whole = Array.isArray(value) ? value : [value];
    const items = whole.map((item: Schema.Json, position) => {
      const taken: Array<{ path: ReadonlyArray<Step>; value: Schema.Json }> =
        [];
      const kept = takeOut(item, keys, [], taken);
      for (const each of taken) overlay.push({ part, position, ...each });
      return kept;
    });
    return {
      part,
      field,
      layout: Array.isArray(value) ? "list" : "single",
      items,
    };
  });
  const params = Object.fromEntries(
    Object.entries(body).filter(([key]) => !fields.has(key)),
  );
  return { params, parts, overlay };
};

const putBack = (
  value: Schema.Json,
  path: ReadonlyArray<Step>,
  restored: Schema.Json,
): Option.Option<Schema.Json> => {
  const [step, ...rest] = path;
  if (step === undefined) return Option.none();
  if (Array.isArray(value)) {
    const at = value[typeof step === "number" ? step : -1];
    if (at === undefined || rest.length === 0) return Option.none();
    return Option.map(putBack(at, rest, restored), (each) =>
      value.map((item: Schema.Json, index) => (index === step ? each : item)),
    );
  }
  if (!isObject(value) || typeof step !== "string") return Option.none();
  if (rest.length === 0) {
    return Option.some(
      Object.fromEntries([...Object.entries(value), [step, restored]]),
    );
  }
  const at = fieldOf(value, step);
  if (at === undefined) return Option.none();
  return Option.map(putBack(at, rest, restored), (each) =>
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === step ? each : item,
      ]),
    ),
  );
};

/**
 * Puts a split body back together. Gives nothing when the pieces do not fit:
 * a single value without exactly one item, or an overlay that points nowhere.
 */
export const join = (whole: Split): Option.Option<Schema.JsonObject> => {
  const fields: Array<readonly [string, Schema.Json]> = [];
  for (const { part, field, layout, items } of whole.parts) {
    let restored: ReadonlyArray<Schema.Json> = items;
    for (const taken of whole.overlay) {
      if (taken.part !== part) continue;
      const item = restored[taken.position];
      if (item === undefined) return Option.none();
      const put = putBack(item, taken.path, taken.value);
      if (Option.isNone(put)) return Option.none();
      restored = restored.map((each, index) =>
        index === taken.position ? put.value : each,
      );
    }
    if (layout === "list") fields.push([field, restored]);
    if (layout === "single") {
      const [only, ...others] = restored;
      if (only === undefined || others.length > 0) return Option.none();
      fields.push([field, only]);
    }
  }
  return Option.some(
    Object.fromEntries([...Object.entries(whole.params), ...fields]),
  );
};

const decodeBody = Schema.decodeUnknownOption(Schema.JsonObject);

/**
 * Reads a request's conversation from its decoded body and the output read
 * from its answer. A body that is not a JSON object, or is nested deeper than
 * `deepest`, has no conversation.
 */
export const read = (
  rules: Rules,
  body: unknown,
  output: ReadonlyArray<Schema.Json>,
): Option.Option<Conversation> =>
  Option.flatMap(decodeBody(body), (decoded) => {
    if (!withinDepth(decoded, 0)) return Option.none();
    const { params, parts, overlay } = split(rules, decoded);
    const itemsOf = (part: RequestPart) =>
      parts
        .filter((each) => each.part === part)
        .flatMap(({ items }) => items.map((item) => itemOf(rules, item)));
    return Option.some({
      params,
      layout: parts.map(({ part, field, layout }) => ({ part, field, layout })),
      overlay,
      system: itemsOf("system"),
      tools: itemsOf("tools"),
      input: itemsOf("input"),
      output: output.map((item) => itemOf(rules, item)),
    });
  });

const decodeItem = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);

/**
 * Rebuilds a request's body from what the request log keeps of it: its params,
 * layout and overlay, and the content of its items by digest.
 */
export const rebuild = (
  kept: Pick<Conversation, "params" | "layout" | "overlay"> &
    Readonly<Record<RequestPart, ReadonlyArray<Digest>>>,
  contentOf: (digest: Digest) => Option.Option<string>,
): Option.Option<Schema.JsonObject> => {
  const parts: Array<SplitPart> = [];
  for (const placement of kept.layout) {
    const items: Array<Schema.Json> = [];
    for (const digest of kept[placement.part]) {
      const item = Option.flatMap(contentOf(digest), decodeItem);
      if (Option.isNone(item)) return Option.none();
      items.push(item.value);
    }
    parts.push({ ...placement, items });
  }
  return join({ params: kept.params, parts, overlay: kept.overlay });
};
