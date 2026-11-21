import { Effect, Layer, Redacted } from "effect";
import { TitleReports } from "#02-application/interfaces/title-reports.ts";
import { tagOf } from "#03-domain/launch.ts";
import {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";

/** A value in double quotes, as curl reads one in its configuration. */
const quoted = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * curl's configuration for one batch: everything it sends, the hub key
 * among it, which reaches curl on its standard input and never in its
 * arguments.
 */
export const configurationOf = (
  url: string,
  key: string,
  machine: string,
  body: string,
): string =>
  [
    `url = ${quoted(url)}`,
    'request = "PUT"',
    `header = ${quoted(`x-cota-key: ${key}`)}`,
    `header = ${quoted(`x-cota-machine: ${tagOf(machine)}`)}`,
    'header = "content-type: application/json"',
    `data-binary = ${quoted(body)}`,
    "silent",
    "show-error",
    "max-time = 30",
    'output = "/dev/null"',
    'write-out = "%{http_code}"',
    "",
  ].join("\n");

/**
 * The batches sent by curl, a program of the system's own: macOS lets a
 * launchd job of a program that is not Apple's reach the local network only
 * once the owner allows it, which a scheduled run cannot ask for (ADR-0022).
 */
export const layer = (curl: string): Layer.Layer<TitleReports> =>
  Layer.succeed(
    TitleReports,
    TitleReports.of({
      send: Effect.fn("TitleReports.send")(
        function* (hub, key, machine, titles) {
          const configuration = configurationOf(
            `${hub}/api/session-titles`,
            Redacted.value(key),
            machine,
            JSON.stringify({ titles: Object.fromEntries(titles) }),
          );
          const ran = yield* Effect.tryPromise({
            try: async () => {
              const child = Bun.spawn([curl, "--config", "-"], {
                stdin: new TextEncoder().encode(configuration),
                stdout: "pipe",
                stderr: "ignore",
              });
              const [status, exitCode] = await Promise.all([
                new Response(child.stdout).text(),
                child.exited,
              ]);
              return { status, exitCode };
            },
            catch: () => new HubUnreachable(),
          });
          if (ran.exitCode !== 0) return yield* new HubUnreachable();
          const status = Number(ran.status.trim());
          if (status === 204) return;
          if (status === 401) return yield* new HubKeyUnknown();
          return yield* new HubFailed(
            Number.isInteger(status) && status > 0 ? { status } : {},
          );
        },
      ),
    }),
  );
