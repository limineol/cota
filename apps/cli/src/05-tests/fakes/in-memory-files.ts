import { Effect, Layer, Option } from "effect";
import { Files, FilesFailed } from "#02-application/interfaces/files.ts";

type Entry =
  | { readonly kind: "file"; readonly text: string; readonly mode: number }
  | { readonly kind: "directory"; readonly mode: number };

/** A file system in memory, for laws that run a command hundreds of times, with paths of either system. */
export interface InMemoryFiles {
  readonly entries: Map<string, Entry>;
  /** Every path and what it holds, in order, so that two moments can be compared. */
  readonly snapshot: () => ReadonlyArray<readonly [string, Entry]>;
}

const parentOf = (path: string) =>
  path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))) || "/";

const isUnder = (path: string, directory: string) =>
  path === directory ||
  path.startsWith(`${directory}/`) ||
  path.startsWith(`${directory}\\`);

export const make = (
  seeded: ReadonlyArray<readonly [string, Entry]> = [],
): { readonly files: InMemoryFiles; readonly layer: Layer.Layer<Files> } => {
  const entries = new Map<string, Entry>([
    ["/", { kind: "directory", mode: 0o755 }],
    ...seeded,
  ]);
  const files: InMemoryFiles = {
    entries,
    snapshot: () =>
      [...entries.entries()].sort(([one], [other]) =>
        one < other ? -1 : one > other ? 1 : 0,
      ),
  };
  const failed = (path: string, reason: string) =>
    Effect.fail(new FilesFailed({ path, reason }));
  const makeDirectories = (path: string, mode: number): boolean => {
    const existing = entries.get(path);
    if (existing?.kind === "file") return false;
    if (existing === undefined && !makeDirectories(parentOf(path), mode)) {
      return false;
    }
    entries.set(path, { kind: "directory", mode });
    return true;
  };
  const layer = Layer.succeed(
    Files,
    Files.of({
      read: (path) => {
        const entry = entries.get(path);
        if (entry === undefined) return Effect.succeedNone;
        return entry.kind === "file"
          ? Effect.succeedSome(entry.text)
          : failed(path, "it is a directory");
      },
      write: (path, text, mode) => {
        if (entries.get(parentOf(path))?.kind !== "directory") {
          return failed(path, "ENOENT");
        }
        if (entries.get(path)?.kind === "directory") {
          return failed(path, "it is a directory");
        }
        entries.set(path, { kind: "file", text, mode });
        return Effect.void;
      },
      makeDirectory: (path, mode) =>
        makeDirectories(path, mode)
          ? Effect.void
          : failed(path, "a part of its path is a file"),
      list: (path) =>
        Effect.succeed(
          [...entries.keys()]
            .filter((each) => each !== path && parentOf(each) === path)
            .map((each) => each.slice(path.length + 1)),
        ),
      remove: (path) => {
        if (!entries.has(path)) return Effect.succeed(false);
        for (const each of [...entries.keys()]) {
          if (isUnder(each, path)) entries.delete(each);
        }
        return Effect.succeed(true);
      },
      executable: (path) =>
        Effect.sync(() => {
          const entry = entries.get(path);
          return entry?.kind === "file" && (entry.mode & 0o111) !== 0;
        }),
      isLink: () => Effect.succeed(false),
      head: (path, bytes) => {
        const entry = entries.get(path);
        return Effect.succeed(
          entry?.kind === "file"
            ? Option.some(entry.text.slice(0, bytes))
            : Option.none(),
        );
      },
      modeOf: (path) =>
        Effect.succeed(
          Option.map(
            Option.fromUndefinedOr(entries.get(path)),
            ({ mode }) => mode,
          ),
        ),
    }),
  );
  return { files, layer };
};
