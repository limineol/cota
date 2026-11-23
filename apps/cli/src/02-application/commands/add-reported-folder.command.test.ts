import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { keptFolderOf } from "./add-reported-folder.command.ts";

/** Folders by the directory each resolves to: `/data/a` became a link to `/data/b`. */
const reals = new Map([
  ["/data/a", "/data/b"],
  ["/data/b", "/data/b"],
  ["/data/link", "/data/b"],
  ["/data/c", "/data/c"],
]);
const realOf = (folder: string) =>
  Effect.succeed(Option.fromUndefinedOr(reals.get(folder)));

const a = { folder: "/data/a", pool: "gemini" };
const b = { folder: "/data/b", pool: "gemini-work" };

describe("the kept folder a path names", () => {
  it.effect(
    "is the one kept by that very path, before one kept by another path to its directory",
    () =>
      Effect.gen(function* () {
        expect(yield* keptFolderOf([b, a], "/data/a", realOf)).toEqual(
          Option.some(a),
        );
        expect(yield* keptFolderOf([a, b], "/data/b", realOf)).toEqual(
          Option.some(b),
        );
      }),
  );

  it.effect(
    "is the one kept by another path to its directory when it alone is",
    () =>
      Effect.gen(function* () {
        expect(yield* keptFolderOf([b], "/data/link", realOf)).toEqual(
          Option.some(b),
        );
        expect(yield* keptFolderOf([a, b], "/data/c", realOf)).toEqual(
          Option.none(),
        );
      }),
  );

  it.effect("is refused when two kept paths lead to its directory", () =>
    Effect.gen(function* () {
      const answer = yield* Effect.result(
        keptFolderOf([a, b], "/data/link", realOf),
      );
      expect(answer._tag === "Failure" && answer.failure.problem).toContain(
        "/data/a and /data/b",
      );
    }),
  );
});
