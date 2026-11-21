import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Result, Schema } from "effect";
import type {
  KeyedProvider,
  PoolModels,
  WrittenModel,
} from "./client-files.ts";
import * as Codex from "./codex.ts";
import { canonical, isRecord } from "./json-file.ts";
import * as OpenCode from "./opencode.ts";
import * as Pi from "./pi.ts";

const hub = "http://127.0.0.1:18080";
const subscriptionKey = 'cota_sub_9f3a"71c0';
const keyFile = "/home/me/.config/cota/hub-keys/keyed";
const keyCommand = Pi.keyCommandOf("linux", "/home/me/bin/cota");

/** Pools of every shape a pool's id takes, some needing quotes as a TOML key. */
const Pool = Schema.Literals(["chatgpt", "team.b", "x~y", "a_b-1", "zai"]);
const Pools = Schema.Array(Pool);

const unique = <A>(items: ReadonlyArray<A>) => [...new Set(items)];

/** The lines of Codex's file that are the owner's: the top table's keys, and tables of every kind, some named like `cota`'s. */
const TopLine = Schema.Literals([
  'model = "gpt-5"',
  'approval_policy = "never"',
  "# the owner's note",
  "",
  '   odd   =   "spacing"   ',
  'notify = ["a", "b"]',
  'x = "cota-not-a-table"',
  'name = "é \\u00e9 \\n \\"q\\""',
]);

const sections = {
  features: ["[features]", "web_search = true"],
  ollama: [
    "# the owner's provider",
    "[model_providers.ollama]",
    'name = "Ollama"',
    'base_url = "http://localhost:11434/v1"',
  ],
  "looks like cota's": ["[model_providers.cotax]", 'name = "not cota\'s"'],
  "cota inside": ["[model_providers.my-cota-x]", 'name = "x"'],
  "cota- elsewhere": ["[profiles.cota-work]", 'model = "o3"'],
  spaced: ["[ mcp_servers.cota ]", 'command = "cota"'],
  "comment before": [
    "",
    "# about the next table",
    "[shell_environment_policy]",
    'inherit = "core"',
  ],
} as const;

const sectionNames = [
  "features",
  "ollama",
  "looks like cota's",
  "cota inside",
  "cota- elsewhere",
  "spaced",
  "comment before",
] as const satisfies ReadonlyArray<keyof typeof sections>;

const Element = Schema.Union([
  Schema.TaggedStruct("Section", { section: Schema.Literals(sectionNames) }),
  Schema.TaggedStruct("Cota", { pool: Pool }),
]);

/** A way Codex's file can be that a rewrite leaves as it was. */
const Foreign = Schema.Literals([
  "none",
  "none",
  "none",
  "none",
  "none",
  "dotted",
  "unmarked",
  "inline",
  "broken",
]);

const CodexFile = Schema.Struct({
  top: Schema.Array(TopLine),
  elements: Schema.Array(Element),
  foreign: Foreign,
  finalLineBreak: Schema.Boolean,
  oldKey: Schema.Boolean,
});
type CodexFile = typeof CodexFile.Type;

const providerOf = (
  pool: string,
  key = subscriptionKey,
): Codex.CodexProvider => ({
  pool,
  hub,
  machine: "studio box",
  key,
});

/** A Codex file as drawn, and the owner's lines in it, in order. */
const codexText = (drawn: CodexFile) => {
  const top = unique(drawn.top);
  const owners: Array<string> = [...top];
  const lines: Array<string> = [...top];
  const elements = drawn.elements.filter(
    (element, index) =>
      drawn.elements.findIndex(
        (other) =>
          (other._tag === "Section" ? other.section : other.pool) ===
          (element._tag === "Section" ? element.section : element.pool),
      ) === index,
  );
  if (drawn.foreign === "dotted") {
    owners.push('model_providers.cota-chatgpt.name = "mine"');
    lines.push('model_providers.cota-chatgpt.name = "mine"');
  }
  if (drawn.foreign === "inline") {
    owners.push('model_providers = { cota-chatgpt = { name = "mine" } }');
    lines.push('model_providers = { cota-chatgpt = { name = "mine" } }');
  }
  for (const element of elements) {
    if (element._tag === "Section") {
      owners.push(...sections[element.section]);
      lines.push(...sections[element.section]);
      continue;
    }
    if (lines.length > 0) lines.push("");
    lines.push(
      ...Codex.tableOf(
        providerOf(element.pool, drawn.oldKey ? "an-old-key" : subscriptionKey),
      ),
    );
  }
  if (drawn.foreign === "unmarked") {
    owners.push("[model_providers.cota-chatgpt]", 'name = "mine"');
    lines.push("[model_providers.cota-chatgpt]", 'name = "mine"');
  }
  if (drawn.foreign === "broken") {
    owners.push("[features");
    lines.push("[features");
  }
  const text =
    lines.length === 0
      ? ""
      : drawn.finalLineBreak || lines.at(-1) === ""
        ? `${lines.join("\n")}\n`
        : lines.join("\n");
  return { text, owners };
};

const tomlOf = (text: string): unknown => Bun.TOML.parse(text);

const withoutCotas = (value: unknown, container: string): unknown => {
  if (!isRecord(value)) return value;
  const held = value[container];
  if (!isRecord(held)) return value;
  const others = Object.entries(held).filter(
    ([key]) => !key.startsWith("cota-"),
  );
  const rest = Object.entries(value).filter(([key]) => key !== container);
  return Object.fromEntries(
    others.length === 0
      ? rest
      : [...rest, [container, Object.fromEntries(others)]],
  );
};

/** A JSON file's root: the owner's keys, of every kind, and its container in every state. */
const RootKey = Schema.Literals([
  "$schema",
  "theme",
  "model",
  "disabled_providers",
  "é",
  "nested",
  "__proto__",
  "10",
]);
const rootValues: Record<typeof RootKey.Type, unknown> = {
  $schema: "https://opencode.ai/config.json",
  theme: "dark",
  model: "cota-zai/glm-5",
  disabled_providers: ["opencode"],
  é: '\n\t"\\ ✓',
  nested: { a: [1, { b: null }, 2.5, -0.001, true] },
  __proto__: { polluted: true },
  "10": 1e21,
};
const ProviderKey = Schema.Literals([
  "openai",
  "cotax",
  "my-cota",
  "cota-old",
  "cota-zai",
  "cota-x~y",
]);
const providerValues: Record<typeof ProviderKey.Type, unknown> = {
  openai: { options: { apiKey: "{env:OPENAI_API_KEY}" } },
  cotax: {},
  "my-cota": { name: "mine" },
  "cota-old": { name: "an old provider of cota's", models: { m: {} } },
  "cota-zai": {
    name: "a stale one",
    models: { "kept-model": { name: "Kept" } },
  },
  "cota-x~y": { name: "no models" },
};
const BrokenJson = Schema.Literals([
  "none",
  "none",
  "none",
  "none",
  "none",
  "unparsed",
  "comments",
  "array",
  "container not an object",
]);

const JsonFileDrawn = Schema.Struct({
  root: Schema.Array(RootKey),
  container: Schema.Literals(["absent", "empty", "held"]),
  containerAt: Schema.Literals(["first", "last"]),
  providers: Schema.Array(ProviderKey),
  indent: Schema.Literals([0, 2, 4]),
  finalLineBreak: Schema.Boolean,
  broken: BrokenJson,
});
type JsonFileDrawn = typeof JsonFileDrawn.Type;

const jsonText = (drawn: JsonFileDrawn, container: string): string => {
  switch (drawn.broken) {
    case "unparsed":
      return '{"theme": "dark",';
    case "comments":
      return '// the owner\'s\n{"theme": "dark"}\n';
    case "array":
      return "[]\n";
    case "container not an object":
      return JSON.stringify({ [container]: ["cota-zai"] });
    case "none":
      break;
  }
  const entries: Array<readonly [string, unknown]> = unique(drawn.root).map(
    (key) => [key, rootValues[key]],
  );
  if (drawn.container !== "absent") {
    const held = Object.fromEntries(
      drawn.container === "empty"
        ? []
        : unique(drawn.providers).map((key) => [key, providerValues[key]]),
    );
    if (drawn.containerAt === "first") entries.unshift([container, held]);
    else entries.push([container, held]);
  }
  const text = JSON.stringify(Object.fromEntries(entries), null, drawn.indent);
  return drawn.finalLineBreak ? `${text}\n` : text;
};

const Model = Schema.Literals(["glm-5", "glm-4.6", "unpriced", "vision"]);
const modelOf = (id: typeof Model.Type): WrittenModel =>
  ({
    "glm-5": {
      id,
      name: "GLM-5",
      context: 204800,
      output: 131072,
      images: false,
      cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
    },
    "glm-4.6": {
      id,
      name: "GLM-4.6",
      context: 200000,
      output: null,
      images: null,
      cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
    },
    unpriced: {
      id,
      name: id,
      context: null,
      output: null,
      images: null,
      cost: null,
    },
    vision: {
      id,
      name: "Vision · é",
      context: 128000,
      output: 8192,
      images: true,
      cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2.5 },
    },
  })[id];

const KeyedPoolDrawn = Schema.Struct({
  pool: Schema.Literals(["zai", "x~y", "work", "open.ai"]),
  name: Schema.Literals(["Z.ai", "the pool's id"]),
  listed: Schema.Boolean,
  models: Schema.Array(Model),
});

const keyedProvidersOf = (
  drawn: ReadonlyArray<typeof KeyedPoolDrawn.Type>,
): ReadonlyArray<KeyedProvider> => {
  const seen = new Set<string>();
  return drawn.flatMap((each) => {
    if (seen.has(each.pool)) return [];
    seen.add(each.pool);
    const models = unique(each.models).map(modelOf);
    const poolModels: PoolModels = each.listed
      ? { _tag: "Listed", models }
      : { _tag: "Kept", fallback: models };
    return [
      {
        pool: each.pool,
        name: each.name === "Z.ai" ? "Z.ai" : each.pool,
        hub,
        machine: "studio",
        models: poolModels,
      },
    ];
  });
};

const Drawn = Schema.Union([
  Schema.Struct({
    client: Schema.Literal("codex"),
    file: CodexFile,
    pools: Pools,
  }),
  Schema.Struct({
    client: Schema.Literals(["opencode", "pi"]),
    file: JsonFileDrawn,
    pools: Schema.Array(KeyedPoolDrawn),
  }),
]);
type Drawn = typeof Drawn.Type;

const containerOf = (client: "opencode" | "pi") =>
  client === "opencode" ? OpenCode.container : Pi.container;

/** A drawn case's file, the rewrite of it with the pools drawn, and those pools. */
const rewritten = (drawn: Drawn) => {
  if (drawn.client === "codex") {
    const { text, owners } = codexText(drawn.file);
    const providers = unique(drawn.pools).map((pool) => providerOf(pool));
    return {
      text,
      owners,
      rewrite: (from: string, given = providers) => Codex.rewrite(from, given),
      refused: drawn.file.foreign !== "none",
      pools: providers.map(({ pool }) => pool),
      keyed: [],
    };
  }
  const container = containerOf(drawn.client);
  const text = jsonText(drawn.file, container);
  const providers = keyedProvidersOf(drawn.pools);
  const rewrite = (from: string, given = providers) =>
    drawn.client === "opencode"
      ? OpenCode.rewrite(from, given, keyFile)
      : Pi.rewrite(from, given, keyCommand);
  return {
    text,
    owners: [],
    rewrite,
    refused: drawn.file.broken !== "none",
    pools: providers.map(({ pool }) => pool),
    keyed: providers,
  };
};

const parsedOf = (drawn: Drawn, text: string): unknown =>
  drawn.client === "codex"
    ? tomlOf(text)
    : text.trim() === ""
      ? {}
      : JSON.parse(text);

const containerName = (drawn: Drawn) =>
  drawn.client === "codex" ? "model_providers" : containerOf(drawn.client);

const runs = { arbitrary: { runs: 600 } };

describe("rewrite laws", () => {
  it.effect.prop(
    "J3: For every client file and every set of pools, what is not `cota`'s reads as the same value after a rewrite as before, and in Codex's file every line outside `cota`'s tables is unchanged and in order.",
    { drawn: Arbitrary.schema(Drawn) },
    ({ drawn }) =>
      Effect.sync(() => {
        const { text, owners, rewrite, refused } = rewritten(drawn);
        const after = rewrite(text);
        if (refused) {
          expect(Result.isFailure(after)).toBe(true);
          return;
        }
        const written = Result.getOrThrow(after);
        const container = containerName(drawn);
        expect(
          canonical(withoutCotas(parsedOf(drawn, written), container)),
        ).toBe(canonical(withoutCotas(parsedOf(drawn, text), container)));
        if (drawn.client !== "codex") return;
        const lines =
          written === "" ? [] : written.replace(/\n$/, "").split("\n");
        expect(lines.slice(0, owners.length)).toEqual(owners);
        const cotas = new Set(
          drawn.pools.flatMap((pool) => Codex.tableOf(providerOf(pool))),
        );
        for (const line of lines.slice(owners.length)) {
          expect(line === "" || cotas.has(line)).toBe(true);
        }
      }),
    runs,
  );

  it.effect.prop(
    "J4: Rewriting a file twice with the same pools gives the bytes of rewriting it once, and the second rewrite writes nothing.",
    { drawn: Arbitrary.schema(Drawn) },
    ({ drawn }) =>
      Effect.sync(() => {
        const { text, rewrite, refused } = rewritten(drawn);
        const once = rewrite(text);
        if (refused) return;
        const written = Result.getOrThrow(once);
        expect(rewrite(written)).toEqual(Result.succeed(written));
      }),
    runs,
  );

  it.effect.prop(
    "J5: After a rewrite, `cota`'s part of a file names exactly the pools given, each with its models, and after the rewrite with none, the file holds nothing of `cota`'s.",
    { drawn: Arbitrary.schema(Drawn) },
    ({ drawn }) =>
      Effect.sync(() => {
        const { text, rewrite, refused, pools, keyed } = rewritten(drawn);
        if (refused) return;
        const written = Result.getOrThrow(rewrite(text));
        const none = Result.getOrThrow(rewrite(text, []));
        const container = containerName(drawn);
        const cotasOf = (from: string) => {
          const held = (() => {
            const value = parsedOf(drawn, from);
            return isRecord(value) && isRecord(value[container])
              ? value[container]
              : {};
          })();
          return Object.entries(held).filter(([key]) =>
            key.startsWith("cota-"),
          );
        };
        expect(cotasOf(none)).toEqual([]);
        if (drawn.client === "codex") expect(Codex.poolsOf(none)).toEqual([]);
        expect(
          cotasOf(written)
            .map(([key]) => key)
            .sort(),
        ).toEqual(pools.map((pool) => `cota-${pool}`).sort());
        if (drawn.client === "codex") {
          expect(Codex.poolsOf(written)).toEqual(pools);
          for (const [key, value] of cotasOf(written)) {
            const pool = key.slice("cota-".length);
            expect(value).toEqual({
              name: "OpenAI",
              base_url: `${hub}/pools/${pool}/backend-api/codex`,
              wire_api: "responses",
              requires_openai_auth: true,
              http_headers: {
                "x-cota-key": subscriptionKey,
                "x-cota-machine": "studio box",
                "x-cota-client": "codex",
              },
              env_http_headers: { "x-cota-project": "COTA_PROJECT" },
            });
          }
          return;
        }
        const before = new Map(cotasOf(text));
        for (const [key, value] of cotasOf(written)) {
          const provider = keyed.find(({ pool }) => `cota-${pool}` === key);
          expect(provider).toBeDefined();
          if (provider === undefined || !isRecord(value)) continue;
          const kept = Option.filter(
            Option.fromUndefinedOr(before.get(key)),
            (old) => isRecord(old) && old.models !== undefined,
          );
          const ids =
            provider.models._tag === "Kept" && Option.isSome(kept)
              ? undefined
              : (provider.models._tag === "Listed"
                  ? provider.models.models
                  : provider.models.fallback
                ).map(({ id }) => id);
          if (ids === undefined) {
            expect(value.models).toEqual(
              Option.map(kept, (old) =>
                isRecord(old) ? old.models : undefined,
              ).pipe(Option.getOrUndefined),
            );
          } else if (drawn.client === "opencode") {
            expect(isRecord(value.models) && Object.keys(value.models)).toEqual(
              ids,
            );
          } else {
            expect(
              Array.isArray(value.models) &&
                value.models.map((model) =>
                  isRecord(model) ? model.id : undefined,
                ),
            ).toEqual(ids);
          }
        }
      }),
    runs,
  );
});
