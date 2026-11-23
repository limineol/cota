import { Effect, Layer, Redacted } from "effect";
import {
  ReportRefused,
  RequestReports,
  type Stored,
} from "#02-application/interfaces/request-reports.ts";
import {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";

/** A report as the stand-in hub was sent it. */
export interface Report {
  readonly pool: string;
  readonly through: string | null;
  readonly calls: ReadonlyArray<{
    readonly call: string;
    readonly after: {
      readonly call: string;
      readonly startedAt: string;
    } | null;
    readonly session: string;
    readonly [field: string]: unknown;
  }>;
}

/** How the stand-in hub answers a report: stored, a problem of its own, or no answer at all. */
export type Answer = 200 | 401 | 409 | 503 | "undecodable" | "never";

export interface Sent {
  readonly key: string;
  readonly machine: string;
  readonly body: string;
  readonly report: Report;
  readonly answer: Answer;
}

const isReport = (value: unknown): value is Report =>
  typeof value === "object" &&
  value !== null &&
  "calls" in value &&
  Array.isArray(value.calls);

/** A hub that answers each report as the test says, and remembers every report it was sent. */
export const make = (
  answerOf: (report: Report) => Answer = () => 200,
): {
  readonly sent: Array<Sent>;
  readonly layer: Layer.Layer<RequestReports>;
} => {
  const sent: Array<Sent> = [];
  const layer = Layer.succeed(
    RequestReports,
    RequestReports.of({
      send: (_hub, key, machine, body) =>
        Effect.suspend(
          (): Effect.Effect<
            Stored,
            HubUnreachable | HubKeyUnknown | ReportRefused | HubFailed
          > => {
            const parsed: unknown = JSON.parse(body);
            if (!isReport(parsed)) return Effect.die("not a report");
            const answer = answerOf(parsed);
            sent.push({
              key: Redacted.value(key),
              machine,
              body,
              report: parsed,
              answer,
            });
            switch (answer) {
              case 200:
                return Effect.succeed({
                  stored: parsed.calls.length,
                  held: 0,
                });
              case 401:
                return Effect.fail(new HubKeyUnknown());
              case 409:
                return Effect.fail(
                  new ReportRefused({
                    status: 409,
                    type: "urn:cota:report-out-of-order",
                    detail: "",
                  }),
                );
              case 503:
                return Effect.fail(
                  new ReportRefused({
                    status: 503,
                    type: "urn:cota:request-log-unavailable",
                    detail: "",
                  }),
                );
              case "undecodable":
                return Effect.fail(new HubFailed({ status: 200 }));
              case "never":
                return Effect.fail(new HubUnreachable());
            }
          },
        ),
    }),
  );
  return { sent, layer };
};
