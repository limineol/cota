import { Effect, Layer } from "effect";
import { Terminal } from "#02-application/interfaces/terminal.ts";

const interrupt = "\u0003";
const endOfInput = "\u0004";
const backspaces = ["\u007f", "\b"];

const written = (stream: NodeJS.WriteStream, text: string) =>
  Effect.callback<void>((resume) => {
    stream.write(text, () => resume(Effect.void));
  });

/** Reads one line from the terminal in raw mode, so that nothing typed is echoed; an interrupt ends `cota` as a terminal would. */
const readHidden = (question: string) =>
  Effect.callback<string>((resume) => {
    const stdin = process.stdin;
    let line = "";
    const done = (answer: string) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      resume(Effect.succeed(answer));
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (
          character === "\r" ||
          character === "\n" ||
          character === endOfInput
        ) {
          done(line);
          return;
        }
        if (character === interrupt) {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        line = backspaces.includes(character)
          ? [...line].slice(0, -1).join("")
          : line + character;
      }
    };
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });

/** The process's own standard streams. */
export const layer: Layer.Layer<Terminal> = Layer.sync(Terminal, () =>
  Terminal.of({
    interactive: process.stdin.isTTY === true,
    input: Effect.promise(() => Bun.stdin.text()),
    secret: readHidden,
    print: (text) => written(process.stdout, text),
    printError: (text) => written(process.stderr, text),
  }),
);
