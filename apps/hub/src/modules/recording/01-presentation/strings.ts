import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Option, Schema } from "effect";
import * as Scrubber from "#modules/recording/03-domain/scrubber/scrubber.ts";

type Json = Schema.Json;

export interface Found {
  readonly path: string;
  readonly text: string;
}

const parseJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);

const jwt =
  /^(?:bearer\s+)?([A-Za-z0-9_-]{2,})\.([A-Za-z0-9_-]{2,})\.[A-Za-z0-9_-]*$/i;

const insideOf = (text: string, path: string): ReadonlyArray<Found> => {
  const parsed = parseJson(text);
  if (Option.isSome(parsed) && typeof parsed.value === "object") {
    return stringsOf(parsed.value, `${path}(json)`);
  }
  const parts = jwt.exec(text.trim());
  if (parts === null) return [];
  return [parts[1], parts[2]].flatMap((part, index) =>
    Option.match(parseJson(Buffer.from(part ?? "", "base64url").toString()), {
      onNone: () => [],
      onSome: (claims) =>
        stringsOf(claims, `${path}(jwt ${index === 0 ? "header" : "payload"})`),
    }),
  );
};

/**
 * Every string an exchange file holds, its keys and header names included, and the
 * strings inside a string that is JSON or a JWT; fillers are left out.
 */
export const stringsOf = (value: Json, path = ""): ReadonlyArray<Found> => {
  if (typeof value === "string") {
    return [
      ...(Scrubber.isFiller(value) ? [] : [{ path, text: value }]),
      ...insideOf(value, path),
    ];
  }
  if (Array.isArray(value)) {
    return value.flatMap((each: Json, index) =>
      stringsOf(each, `${path}[${index}]`),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, each]) => [
      ...(Scrubber.isFiller(key) ? [] : [{ path: `${path}{key}`, text: key }]),
      ...stringsOf(each, path === "" ? key : `${path}.${key}`),
    ]);
  }
  return [];
};

const filesUnder = (path: string): ReadonlyArray<string> =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .sort()
        .flatMap((name) => filesUnder(join(path, name)))
    : path.endsWith(".json")
      ? [path]
      : [];

if (import.meta.main) {
  const given = process.argv.slice(2);
  const files = (
    given.length === 0
      ? ["apps/hub/src/shared/05-tests/replay/exchanges"]
      : given
  ).flatMap(filesUnder);
  const seen = new Map<string, { count: number; first: string }>();
  for (const file of files) {
    const parsed = parseJson(readFileSync(file, "utf8"));
    if (Option.isNone(parsed)) {
      console.error(`${file} is not JSON`);
      process.exitCode = 1;
      continue;
    }
    for (const { path, text } of stringsOf(parsed.value)) {
      const known = seen.get(text);
      seen.set(text, {
        count: (known?.count ?? 0) + 1,
        first: known?.first ?? `${basename(file)}: ${path}`,
      });
    }
  }
  const sorted = [...seen].sort(([one], [other]) => one.localeCompare(other));
  for (const [text, { count, first }] of sorted) {
    console.log(`${JSON.stringify(text)}\t${count}\t${first}`);
  }
  console.error(
    `${sorted.length} distinct strings in ${files.length} exchange files, fillers left out`,
  );
}
