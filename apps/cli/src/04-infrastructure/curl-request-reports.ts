import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, Redacted } from "effect";
import { RequestReports } from "#02-application/interfaces/request-reports.ts";
import { tagOf } from "#03-domain/launch.ts";
import { HubUnreachable } from "#03-domain/machine.ts";
import { answerOf } from "./request-answers.ts";

/** A value in double quotes, as curl reads one in its configuration. */
const quoted = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * curl's configuration for one report: everything but the body, the hub key
 * among it, which reaches curl on its standard input and never in its
 * arguments; the body is the file named, which curl reads.
 */
export const configurationOf = (
  url: string,
  key: string,
  machine: string,
  bodyFile: string,
): string =>
  [
    `url = ${quoted(url)}`,
    'request = "POST"',
    `header = ${quoted(`x-cota-key: ${key}`)}`,
    `header = ${quoted(`x-cota-machine: ${tagOf(machine)}`)}`,
    'header = "content-type: application/json"',
    `data-binary = ${quoted(`@${bodyFile}`)}`,
    "silent",
    "show-error",
    "max-time = 120",
    'write-out = "\\n%{http_code}"',
    "",
  ].join("\n");

/** The reports sent by curl, a program of the system's own, as the title reporter's are (ADR-0022). */
export const layer = (curl: string): Layer.Layer<RequestReports> =>
  Layer.succeed(
    RequestReports,
    RequestReports.of({
      send: Effect.fn("RequestReports.send")(
        function* (hub, key, machine, body, scratch) {
          const ran = yield* Effect.tryPromise({
            try: async () => {
              await mkdir(scratch, { recursive: true, mode: 0o700 });
              const directory = await mkdtemp(join(scratch, "report-"));
              try {
                const bodyFile = join(directory, "body.json");
                await writeFile(bodyFile, body, { mode: 0o600 });
                // -q first: no .curlrc of the user's is read, so that only
                // this configuration says what curl sends and prints.
                const child = Bun.spawn([curl, "-q", "--config", "-"], {
                  stdin: new TextEncoder().encode(
                    configurationOf(
                      `${hub}/api/reported-requests`,
                      Redacted.value(key),
                      machine,
                      bodyFile,
                    ),
                  ),
                  stdout: "pipe",
                  stderr: "ignore",
                });
                const [output, exitCode] = await Promise.all([
                  new Response(child.stdout).text(),
                  child.exited,
                ]);
                return { output, exitCode };
              } finally {
                await rm(directory, { recursive: true, force: true });
              }
            },
            catch: () => new HubUnreachable(),
          });
          if (ran.exitCode !== 0) return yield* new HubUnreachable();
          const split = ran.output.lastIndexOf("\n");
          const answer = answerOf(
            Number(ran.output.slice(split + 1).trim()),
            ran.output.slice(0, Math.max(split, 0)),
          );
          return "_tag" in answer ? yield* answer : answer;
        },
      ),
    }),
  );
