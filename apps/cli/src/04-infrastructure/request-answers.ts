import { Option, Schema } from "effect";
import {
  ReportRefused,
  type Stored,
} from "#02-application/interfaces/request-reports.ts";
import { HubFailed, HubKeyUnknown } from "#03-domain/machine.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const StoredAnswer = Schema.Struct({ stored: Count, held: Count });
const Problem = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
});

const jsonOf = (text: string): Option.Option<unknown> => {
  try {
    return Option.some<unknown>(JSON.parse(text));
  } catch {
    return Option.none();
  }
};

/** What the hub's answer to a report says, by its status and its body, from whichever sent it. */
export const answerOf = (
  status: number,
  body: string,
): Stored | HubKeyUnknown | ReportRefused | HubFailed => {
  if (status === 200) {
    return Option.match(
      Option.flatMap(jsonOf(body), Schema.decodeUnknownOption(StoredAnswer)),
      {
        onNone: () => new HubFailed({ status }),
        onSome: (stored) => stored,
      },
    );
  }
  if (status === 401) return new HubKeyUnknown();
  if (status >= 300 && status < 400) return new HubFailed({ status });
  if (!Number.isInteger(status) || status < 100) return new HubFailed({});
  const problem = Option.getOrElse(
    Option.flatMap(jsonOf(body), Schema.decodeUnknownOption(Problem)),
    (): typeof Problem.Type => ({}),
  );
  return new ReportRefused({
    status,
    type: problem.type ?? "",
    detail: problem.detail ?? "",
  });
};
