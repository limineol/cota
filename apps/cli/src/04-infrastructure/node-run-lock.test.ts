import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RunLock } from "#02-application/interfaces/run-lock.ts";
import * as NodeRunLock from "./node-run-lock.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-run-lock-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const taker = join(import.meta.dirname, "../05-tests/take-run-lock.ts");

/** A process id no process holds: one that ran and was waited for. */
const deadPid = () => Bun.spawnSync(["true"]).pid;

/** Lines of a child's output, one at a time. */
const linesOf = (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return async () => {
    for (;;) {
      const end = buffered.indexOf("\n");
      if (end >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) return "";
      buffered += decoder.decode(value);
    }
  };
};

/** Runs takers that all try at once, and gives what each answered. */
const race = async (path: string, takers: number) => {
  const children = Array.from({ length: takers }, () => {
    const child = Bun.spawn([process.execPath, taker, path], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    return { child, next: linesOf(child.stdout) };
  });
  for (const { next } of children) expect(await next()).toBe("ready");
  const at = performance.timeOrigin + performance.now() + 100;
  for (const { child } of children) child.stdin.write(`go ${at}\n`);
  for (const { child } of children) child.stdin.flush();
  const answers = await Promise.all(children.map(({ next }) => next()));
  for (const { child } of children) child.stdin.end();
  await Promise.all(children.map(({ child }) => child.exited));
  return answers;
};

const J27 =
  "J27: Of runs that take the lock at once, over no lock or one whose process is gone, exactly one takes it; the lock appears whole, naming its owner, or not at all; and a run removes only its own lock.";

describe("the request reporter's run lock", () => {
  it.effect(
    J27,
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          for (let round = 0; round < 24; round += 1) {
            const directory = mkdtempSync(join(scratch, "round-"));
            const path = join(directory, "requests.lock");
            if (round % 3 === 1) writeFileSync(path, `${deadPid()}\n`);
            if (round % 3 === 2) writeFileSync(path, `${deadPid()} gone\n`);
            const answers = await race(path, 6);
            expect(answers.filter((each) => each === "took")).toHaveLength(1);
            expect(answers.filter((each) => each === "held")).toHaveLength(5);
            expect(readdirSync(directory)).toEqual([]);
          }
        });
        const lock = yield* RunLock;
        // While a live run takes over a dead run's lock, under the lock named
        // after the dead one's text, no other run removes it or takes it.
        const taking = mkdtempSync(join(scratch, "taking-"));
        const dead = join(taking, "requests.lock");
        const deadText = `${deadPid()} gone\n`;
        writeFileSync(dead, deadText);
        const digest = createHash("sha256").update(deadText).digest("hex");
        writeFileSync(
          `${dead}.taking-${digest.slice(0, 32)}`,
          `${process.pid} the run taking it over\n`,
        );
        expect(yield* lock.take(dead)).toBe(false);
        expect(readFileSync(dead, "utf8")).toBe(deadText);
        const directory = mkdtempSync(join(scratch, "own-"));
        const path = join(directory, "requests.lock");
        expect(yield* lock.take(path)).toBe(true);
        expect(yield* lock.take(path)).toBe(false);
        writeFileSync(path, `${process.pid} another run\n`);
        yield* lock.release(path);
        expect(readdirSync(directory)).toEqual(["requests.lock"]);
        rmSync(path);
        expect(yield* lock.take(path)).toBe(true);
        yield* lock.release(path);
        expect(readdirSync(directory)).toEqual([]);
      }).pipe(Effect.provide(NodeRunLock.layer)),
    120_000,
  );
});
