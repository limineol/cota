import { Result } from "effect";
import { providerPrefix } from "./client-files.ts";
import { tomlString } from "./configuration.ts";
import { canonical, isRecord } from "./json-file.ts";

/** The comment above each table of Codex's configuration that is `cota`'s (`docs/specs/cli/spec.md`, Configuring). */
export const tableMarker = "# cota: this table is rewritten by cota configure.";

/** A ChatGPT pool's provider in Codex's `config.toml`. */
export interface CodexProvider {
  readonly pool: string;
  readonly hub: string;
  readonly machine: string;
  /** The subscription hub key, which Codex sends in `x-cota-key`: a desktop app reads the file without the launcher's environment. */
  readonly key: string;
}

const bareKey = /^[A-Za-z0-9_-]+$/;

const headerOf = (pool: string) => {
  const key = `${providerPrefix}${pool}`;
  return `[model_providers.${bareKey.test(key) ? key : tomlString(key)}]`;
};

const cotaHeader =
  /^\[model_providers\.(?:cota-([A-Za-z0-9_-]+)|"cota-((?:[^"\\]|\\.)*)")\]$/;

const poolOfHeader = (line: string): string | undefined => {
  const found = line.trim().match(cotaHeader);
  if (found === null) return undefined;
  if (found[1] !== undefined) return found[1];
  try {
    const pool: unknown = JSON.parse(`"${found[2] ?? ""}"`);
    return typeof pool === "string" ? pool : undefined;
  } catch {
    return undefined;
  }
};

const isHeader = (line: string) => {
  const trimmed = line.replace(/#.*$/, "").trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
};

const isBlankOrComment = (line: string) => {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
};

/** The lines of a provider's table, its marker comment first. */
export const tableOf = (provider: CodexProvider): ReadonlyArray<string> => [
  tableMarker,
  headerOf(provider.pool),
  'name = "OpenAI"',
  `base_url = ${tomlString(`${provider.hub}/pools/${provider.pool}/backend-api/codex`)}`,
  'wire_api = "responses"',
  "requires_openai_auth = true",
  `http_headers = { "x-cota-key" = ${tomlString(provider.key)}, "x-cota-machine" = ${tomlString(provider.machine)}, "x-cota-client" = "codex" }`,
  'env_http_headers = { "x-cota-project" = "COTA_PROJECT" }',
];

interface Table {
  readonly pool: string;
  /** Its first line: the blank line before the marker when there is one, else the marker. */
  readonly start: number;
  /** The line after its last. */
  readonly end: number;
}

const linesOf = (text: string): ReadonlyArray<string> =>
  text === "" ? [] : text.replace(/\n$/, "").split("\n");

/**
 * `cota`'s tables among a file's lines: a marker comment, then a header
 * `[model_providers.cota-<pool>]`, then the lines up to the next table
 * header but for the blank and comment lines just before it; and the one
 * blank line before the marker, which `cota` wrote to set the table apart.
 */
const tablesOf = (lines: ReadonlyArray<string>): ReadonlyArray<Table> => {
  const tables: Array<Table> = [];
  for (let index = 0; index < lines.length; index++) {
    if ((lines[index] ?? "").trim() !== tableMarker) continue;
    const pool = poolOfHeader(lines[index + 1] ?? "");
    if (pool === undefined) continue;
    let end = index + 2;
    while (end < lines.length && !isHeader(lines[end] ?? "")) end++;
    while (end > index + 2 && isBlankOrComment(lines[end - 1] ?? "")) end--;
    const start =
      index > 0 && (lines[index - 1] ?? "").trim() === "" ? index - 1 : index;
    tables.push({ pool, start, end });
    index = end - 1;
  }
  return tables;
};

const outside = (
  lines: ReadonlyArray<string>,
  tables: ReadonlyArray<Table>,
): ReadonlyArray<string> =>
  lines.filter(
    (_, index) =>
      !tables.some(({ start, end }) => index >= start && index < end),
  );

/** The pools of `cota`'s tables in Codex's configuration, in the order they stand. */
export const poolsOf = (text: string): ReadonlyArray<string> =>
  tablesOf(linesOf(text)).map(({ pool }) => pool);

/** Whether Codex's `config.toml` holds the provider table `cota configure` writes for a pool. */
export const hasProviderTable = (text: string, pool: string): boolean =>
  poolsOf(text).includes(pool);

const parsed = (text: string): Result.Result<unknown, string> => {
  try {
    return Result.succeed(Bun.TOML.parse(text));
  } catch (cause) {
    return Result.fail(
      (cause instanceof Error ? cause.message : String(cause)).replace(
        /^TOML Parse error: /,
        "",
      ),
    );
  }
};

const providersIn = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) return {};
  const providers = value.model_providers;
  return isRecord(providers) ? providers : {};
};

/** A parsed file without `cota`'s providers, and without `model_providers` when nothing else is in it. */
const withoutCotas = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.model_providers)) return value;
  const others = Object.entries(value.model_providers).filter(
    ([key]) => !key.startsWith(providerPrefix),
  );
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, each]) =>
      key !== "model_providers"
        ? [[key, each]]
        : others.length === 0
          ? []
          : [[key, Object.fromEntries(others)]],
    ),
  );
};

/**
 * Codex's `config.toml` with `cota`'s tables removed where they stand and
 * the providers given written at the end, each after one blank line; or why
 * it is left as it was: it does not read as TOML, it holds a `cota-`
 * provider in another form, or the result would not read or would change
 * what is not `cota`'s. A file with nothing to change is given back as it
 * was.
 */
export const rewrite = (
  text: string,
  providers: ReadonlyArray<CodexProvider>,
): Result.Result<string, string> => {
  const before = parsed(text);
  if (Result.isFailure(before)) {
    return Result.fail(`it does not read as TOML: ${before.failure}`);
  }
  const lines = linesOf(text);
  const tables = tablesOf(lines);
  const rest = outside(lines, tables);
  const others = parsed(rest.join("\n"));
  if (Result.isFailure(others)) {
    return Result.fail(
      `without cota's tables it does not read as TOML: ${others.failure}`,
    );
  }
  const foreign = Object.keys(providersIn(others.success)).filter((key) =>
    key.startsWith(providerPrefix),
  );
  if (foreign.length > 0) {
    return Result.fail(
      `it has the provider ${foreign.join(", ")} written in a form cota does not rewrite (an inline table, dotted keys, or a table without cota's comment above it); remove it, and cota configure writes it again`,
    );
  }
  if (tables.length === 0 && providers.length === 0) {
    return Result.succeed(text);
  }
  const out = [...rest];
  for (const provider of providers) {
    if (out.length > 0) out.push("");
    out.push(...tableOf(provider));
  }
  const after = out.length === 0 ? "" : `${out.join("\n")}\n`;
  const check = parsed(after);
  if (Result.isFailure(check)) {
    return Result.fail(
      `with cota's tables it would not read as TOML: ${check.failure}`,
    );
  }
  if (
    canonical(withoutCotas(check.success)) !==
    canonical(withoutCotas(before.success))
  ) {
    return Result.fail("rewriting it would change what is not cota's");
  }
  return Result.succeed(after);
};
