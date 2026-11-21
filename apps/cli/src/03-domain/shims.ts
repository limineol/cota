import { isShim, shimHeadBytes, shimMarker } from "@cota/hub/shim";
import { Option } from "effect";
import type { Command } from "./client.ts";
import type { System } from "./system.ts";

export { isShim, shimHeadBytes, shimMarker };

/** The words that end `cota`'s line in a shell's file. */
export const pathLineMarker = "# cota: keep last";

/** A shim's file name and text on a system. */
export interface Shim {
  readonly name: string;
  readonly text: string;
}

/** A word as a POSIX shell reads it back exactly: in single quotes. */
export const shellQuoted = (word: string): string =>
  `'${word.replaceAll("'", "'\\''")}'`;

/** The shim of a client: on macOS and Linux a shell script that runs `cota <client>` with its arguments, on Windows a `.cmd` file. */
export const shimOf = (system: System, cota: string, command: Command): Shim =>
  system === "win32"
    ? {
        name: `${command}.cmd`,
        text: `@rem ${shimMarker}; cota shims rewrites it.\r\n@"${cota}" ${command} %*\r\n`,
      }
    : {
        name: command,
        text: `#!/bin/sh\n# ${shimMarker}; cota shims rewrites it.\nexec ${shellQuoted(cota)} ${command} "$@"\n`,
      };

/** The `cota` a shim runs, read back from its text. */
export const cotaOf = (text: string): Option.Option<string> => {
  const posix = text.match(/^exec '((?:[^']|'\\'')*)' /m);
  if (posix !== null) {
    return Option.some((posix[1] ?? "").replaceAll("'\\''", "'"));
  }
  const windows = text.match(/^@"([^"]*)" /m);
  return windows === null ? Option.none() : Option.some(windows[1] ?? "");
};

const doubleQuoted = (word: string) => word.replace(/["\\$`]/g, "\\$&");

/** `cota`'s line in a POSIX shell's file, which puts the shims' directory first on `PATH`. */
export const pathLineOf = (shims: string): string =>
  `export PATH="${doubleQuoted(shims)}:$PATH" ${pathLineMarker}`;

const isPathLine = (line: string) => line.trimEnd().endsWith(pathLineMarker);

const linesOf = (text: string): ReadonlyArray<string> =>
  text === "" ? [] : text.replace(/\n$/, "").split("\n");

/**
 * A shell's file with `cota`'s line once, as its last line: every line of
 * `cota`'s removed where it stands, and the line written at the end; every
 * other line as it was, in order.
 */
export const withPathLineLast = (text: string, line: string): string =>
  `${[...linesOf(text).filter((each) => !isPathLine(each)), line].join("\n")}\n`;

/** A shell's file without `cota`'s line; a file that held none is returned as it was. */
export const withoutPathLine = (text: string): string => {
  const lines = linesOf(text);
  const others = lines.filter((each) => !isPathLine(each));
  if (others.length === lines.length) return text;
  return others.length === 0 ? "" : `${others.join("\n")}\n`;
};

/** Whether `cota`'s line is the last line of a shell's file. */
export const isPathLineLast = (text: string): boolean => {
  const lines = linesOf(text);
  const last = lines.at(-1);
  return (
    last !== undefined &&
    isPathLine(last) &&
    lines.filter((each) => isPathLine(each)).length === 1
  );
};

/** The lines after `cota`'s last line in a shell's file that change `PATH`, putting their directories before the shims. */
export const pathLinesAfterCotas = (text: string): ReadonlyArray<string> => {
  const lines = linesOf(text);
  const at = lines.findLastIndex(isPathLine);
  if (at === -1) return [];
  return lines
    .slice(at + 1)
    .filter(
      (line) => !line.trimStart().startsWith("#") && /\bpath\b/i.test(line),
    );
};

/** `cota`'s own file in fish's `conf.d`, which puts the shims' directory first on `PATH`. */
export const fishFileOf = (shims: string): string =>
  `# cota: this file is cota's; cota shims --remove removes it.\nfish_add_path --prepend --move --path ${shellQuoted(shims)}\n`;

/** The shells whose files `cota` writes its `PATH` line to, from `$SHELL`'s name. */
export type Shell = "zsh" | "bash" | "fish" | "posix";

export const shellOf = (shell: string | undefined): Shell => {
  const name = (shell ?? "").split("/").at(-1) ?? "";
  return name === "zsh" || name === "bash" || name === "fish" ? name : "posix";
};

/** The files bash reads as a login shell, the first that exists being the one it reads. */
export const bashLoginFiles = [".bash_profile", ".bash_login", ".profile"];

/** Whether a bash login file reads `~/.bashrc` itself. */
export const readsBashrc = (text: string): boolean => text.includes(".bashrc");
