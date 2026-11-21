import { Effect, Layer, Redacted } from "effect";
import { TitleReports } from "#02-application/interfaces/title-reports.ts";
import {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";

/** How the stand-in hub answers a batch: 204, a status of its own, or no answer at all. */
export type Answer = 204 | 401 | 503 | "never";

export interface Sent {
  readonly key: string;
  readonly machine: string;
  readonly titles: ReadonlyMap<string, string>;
  readonly answer: Answer;
}

/** A hub that answers each batch as the test says, and remembers every batch it was sent. */
export const make = (
  answerOf: (titles: ReadonlyMap<string, string>) => Answer = () => 204,
): {
  readonly sent: Array<Sent>;
  readonly layer: Layer.Layer<TitleReports>;
} => {
  const sent: Array<Sent> = [];
  const layer = Layer.succeed(
    TitleReports,
    TitleReports.of({
      send: (_hub, key, machine, titles) =>
        Effect.suspend(
          (): Effect.Effect<
            void,
            HubUnreachable | HubKeyUnknown | HubFailed
          > => {
            const answer = answerOf(titles);
            sent.push({ key: Redacted.value(key), machine, titles, answer });
            switch (answer) {
              case 204:
                return Effect.void;
              case 401:
                return Effect.fail(new HubKeyUnknown());
              case 503:
                return Effect.fail(new HubFailed({ status: 503 }));
              case "never":
                return Effect.fail(new HubUnreachable());
            }
          },
        ),
    }),
  );
  return { sent, layer };
};
