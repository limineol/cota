import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import * as Shims from "./shims.ts";

const shims = "/home/me/.local/share/cota/bin";
const line = Shims.pathLineOf(shims);

/** A shell file's line: the owner's, some of them naming `cota`, or one of `cota`'s, today's or an older one. */
const Line = Schema.Literals([
  "export EDITOR=vim",
  "",
  "  ",
  "alias c='cota claude'",
  "# cota was installed here",
  'export PATH="/opt/bin:$PATH"',
  "fi",
  "cota's line",
  "an older cota line",
]);

const lineOf = (drawn: typeof Line.Type) =>
  drawn === "cota's line"
    ? line
    : drawn === "an older cota line"
      ? `export PATH="/old/cota/bin:$PATH" ${Shims.pathLineMarker}`
      : drawn;

const isCotas = (drawn: typeof Line.Type) =>
  drawn === "cota's line" || drawn === "an older cota line";

const file = Arbitrary.all({
  lines: Arbitrary.schema(Schema.Array(Line)),
  finalLineBreak: Arbitrary.schema(Schema.Boolean),
});

describe("shims laws", () => {
  it.effect.prop(
    "J10: After `cota shims`, the shell's file holds `cota`'s line exactly once, as its last line, and every other line as it was, in order.",
    { file },
    ({ file: { lines, finalLineBreak } }) =>
      Effect.sync(() => {
        const written = lines.map(lineOf);
        const lastIsEmpty = written.at(-1) === "";
        const text =
          written.length === 0
            ? ""
            : finalLineBreak || lastIsEmpty
              ? `${written.join("\n")}\n`
              : written.join("\n");
        const after = Shims.withPathLineLast(text, line);
        const others = lines
          .filter((each) => !isCotas(each))
          .map((each) => lineOf(each));
        expect(after.split("\n")).toEqual([...others, line, ""]);
        expect(Shims.isPathLineLast(after)).toBe(true);
        expect(Shims.withPathLineLast(after, line)).toBe(after);
      }),
    { arbitrary: { runs: 1000 } },
  );

  it("removes cota's line and nothing else, and leaves a file without one as it was", () => {
    const owner = "export EDITOR=vim\n# cota was installed here\n";
    expect(Shims.withoutPathLine(`${owner}${line}\n`)).toBe(owner);
    expect(Shims.withoutPathLine(owner)).toBe(owner);
    expect(Shims.withoutPathLine("export EDITOR=vim")).toBe(
      "export EDITOR=vim",
    );
  });

  it("writes shims that run the cota that wrote them, read back from their text", () => {
    const cota = "/Users/O'Neil/bin/cota";
    const posix = Shims.shimOf("darwin", cota, "claude");
    expect(posix.name).toBe("claude");
    expect(Shims.isShim(posix.text)).toBe(true);
    expect(Shims.cotaOf(posix.text)).toEqual(Option.some(cota));
    const windows = Shims.shimOf(
      "win32",
      "C:\\Users\\me\\cota\\cota.exe",
      "codex",
    );
    expect(windows.name).toBe("codex.cmd");
    expect(Shims.isShim(windows.text)).toBe(true);
    expect(Shims.cotaOf(windows.text)).toEqual(
      Option.some("C:\\Users\\me\\cota\\cota.exe"),
    );
  });
});
