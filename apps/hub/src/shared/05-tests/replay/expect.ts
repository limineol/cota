import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Replay from "./replay.ts";

const asObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);

const rewrite = Effect.gen(function* () {
  for (const loaded of Replay.load()) {
    const played = yield* Replay.replay(loaded, "whole");
    const path = join(Replay.directory, loaded.file);
    const file = asObject(readFileSync(path, "utf8"));
    const expects = { logged: Replay.expectationOf(played.logged) };
    writeFileSync(path, `${JSON.stringify({ ...file, expects }, null, 2)}\n`);
    console.log(`exchanges/${loaded.file}`);
  }
});

await Effect.runPromise(
  rewrite.pipe(
    Effect.provide(Layer.provideMerge(Replay.layer, TestClock.layer())),
  ),
);
