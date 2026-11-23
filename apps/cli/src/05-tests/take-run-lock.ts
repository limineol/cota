// A run that takes the lock at its first argument at the moment its standard
// input names after "go", prints whether it took it, and holds it until its
// input ends.
import { Effect } from "effect";
import { RunLock } from "#02-application/interfaces/run-lock.ts";
import * as NodeRunLock from "#04-infrastructure/node-run-lock.ts";

const path = process.argv[2] ?? "";
const lock = Effect.runSync(
  Effect.provide(
    Effect.gen(function* () {
      return yield* RunLock;
    }),
    NodeRunLock.layer,
  ),
);
const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
console.log("ready");
let said = "";
while (!said.includes("\n")) {
  const { value, done } = await reader.read();
  if (done) process.exit(1);
  said += decoder.decode(value);
}
// Every run starts at the moment the "go" names, so that they take at once.
const at = Number(said.split(/\s+/)[1] ?? 0);
while (performance.timeOrigin + performance.now() < at) {}
const took = await Effect.runPromise(lock.take(path));
console.log(took ? "took" : "held");
while (!(await reader.read()).done) {}
if (took) await Effect.runPromise(lock.release(path));
