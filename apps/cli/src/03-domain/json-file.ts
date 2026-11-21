import { Option, Result } from "effect";
import {
  type PoolModels,
  providerPrefix,
  type WrittenModel,
} from "./client-files.ts";

export const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A value written so that two equal values, whatever the order of their keys, are written alike. */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};

const parsed = (text: string): Result.Result<unknown, string> => {
  if (text.trim() === "") return Result.succeed({});
  try {
    const value: unknown = JSON.parse(text);
    return Result.succeed(value);
  } catch (cause) {
    return Result.fail(
      (cause instanceof Error ? cause.message : String(cause)).replace(
        /^JSON Parse error: /,
        "",
      ),
    );
  }
};

/** A provider `cota` writes: its key, and its value from the one it replaces, if any. */
export interface Entry {
  readonly key: string;
  readonly providerOf: (existing: Option.Option<unknown>) => unknown;
}

/**
 * A provider's `models` as written: those given, or, for a pool whose
 * listing failed, those of the provider it replaces, else the fallback.
 */
export const modelsOf = (
  models: PoolModels,
  existing: Option.Option<unknown>,
  written: (models: ReadonlyArray<WrittenModel>) => unknown,
): unknown => {
  if (models._tag === "Listed") return written(models.models);
  const last = Option.flatMap(existing, (value) =>
    isRecord(value) && value.models !== undefined
      ? Option.some<unknown>(value.models)
      : Option.none(),
  );
  return Option.getOrElse(last, () => written(models.fallback));
};

/** A parsed file without `cota`'s providers in its container, and without the container when nothing else is in it. */
export const withoutCotas = (value: unknown, container: string): unknown => {
  if (!isRecord(value) || !isRecord(value[container])) return value;
  const others = Object.entries(value[container]).filter(
    ([key]) => !key.startsWith(providerPrefix),
  );
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, each]) =>
      key !== container
        ? [[key, each]]
        : others.length === 0
          ? []
          : [[key, Object.fromEntries(others)]],
    ),
  );
};

/** The providers of a JSON file's container that are `cota`'s, in the order they stand. */
export const cotasOf = (
  text: string,
  container: string,
): ReadonlyArray<readonly [string, unknown]> => {
  const value = Result.getOrUndefined(parsed(text));
  if (!isRecord(value) || !isRecord(value[container])) return [];
  return Object.entries(value[container]).filter(([key]) =>
    key.startsWith(providerPrefix),
  );
};

/**
 * A JSON file whose container (`provider`, `providers`) has the entries
 * given as its `cota-` keys and no other: each replaced where it stands, new
 * ones added at the end in the order given, the others removed, and the
 * container removed when only `cota`'s were in it. Written with two spaces
 * of indent and a final line break; a file with nothing to change is given
 * back as it was. Left as it was, saying why, when it does not read as JSON,
 * is not an object, its container is not one, or the result would change
 * what is not `cota`'s.
 */
export const rewrite = (
  text: string,
  container: string,
  entries: ReadonlyArray<Entry>,
): Result.Result<string, string> => {
  const before = parsed(text);
  if (Result.isFailure(before)) {
    return Result.fail(`it does not read as JSON: ${before.failure}`);
  }
  const root = before.success;
  if (!isRecord(root)) return Result.fail("it does not hold a JSON object");
  const held = root[container];
  if (held !== undefined && !isRecord(held)) {
    return Result.fail(`its ${JSON.stringify(container)} is not an object`);
  }
  const existing = Object.entries(held ?? {});
  const given = new Map(entries.map((entry) => [entry.key, entry]));
  const kept = existing.flatMap(
    ([key, value]): ReadonlyArray<readonly [string, unknown]> => {
      if (!key.startsWith(providerPrefix)) return [[key, value]];
      const entry = given.get(key);
      return entry === undefined
        ? []
        : [[key, entry.providerOf(Option.some(value))]];
    },
  );
  const added = entries
    .filter(({ key }) => !existing.some(([each]) => each === key))
    .map(({ key, providerOf }) => [key, providerOf(Option.none())] as const);
  const providers = [...kept, ...added];
  const keepsContainer =
    providers.length > 0 || (held !== undefined && existing.length === 0);
  const rootEntries = Object.entries(root).flatMap(([key, value]) =>
    key !== container
      ? [[key, value] as const]
      : keepsContainer
        ? [[key, Object.fromEntries(providers)] as const]
        : [],
  );
  if (held === undefined && keepsContainer) {
    rootEntries.push([container, Object.fromEntries(providers)]);
  }
  const value = Object.fromEntries(rootEntries);
  if (JSON.stringify(value) === JSON.stringify(root)) {
    return Result.succeed(text);
  }
  const after = `${JSON.stringify(value, null, 2)}\n`;
  const check = parsed(after);
  if (
    Result.isFailure(check) ||
    canonical(withoutCotas(check.success, container)) !==
      canonical(withoutCotas(root, container))
  ) {
    return Result.fail("rewriting it would change what is not cota's");
  }
  return Result.succeed(after);
};
