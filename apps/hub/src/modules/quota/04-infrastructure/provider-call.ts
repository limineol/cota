import {
  type DateTime,
  Duration,
  Option,
  Result,
  Schema,
  SchemaIssue,
} from "effect";
import { ReadFailure } from "#modules/quota/03-domain/readings.ts";
import hub from "#package.json" with { type: "json" };

/** What every call to a provider's usage or token endpoint says it is (U6). */
export const userAgent = `cota/${hub.version}`;

/** How long after it was sent a call is abandoned (U6). */
export const longestCall = Duration.seconds(10);

export const failure = (
  kind: ReadFailure["kind"],
  status: Option.Option<number>,
  detail: string,
  retryAt: Option.Option<DateTime.Utc> = Option.none(),
) => new ReadFailure({ kind, status, detail, retryAt });

export const parseJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown),
);

const missing = "is missing";

const reasonFormatter = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: (issue) => (issue._tag === "MissingKey" ? missing : ""),
  checkHook: () => "",
});

const pathOf = (
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>,
) =>
  path
    .map((segment) => (typeof segment === "object" ? segment.key : segment))
    .map((key, index) =>
      typeof key === "number"
        ? `[${key}]`
        : `${index === 0 ? "" : "."}${String(key)}`,
    )
    .join("");

/**
 * Decodes the part of an answer found at `at` (`data.limits[2]`, or empty
 * for the whole answer), or says why it does not: the path of the first
 * field that did not decode, and whether it is missing or malformed.
 */
export const decodeAt = <A>(
  schema: Schema.Codec<A, unknown>,
  value: unknown,
  at: string,
): Result.Result<A, string> =>
  Result.mapError(Schema.decodeUnknownResult(schema)(value), ({ issue }) => {
    const [first] = reasonFormatter(issue).issues;
    const inside = pathOf(first?.path ?? []);
    const path =
      inside === "" || inside.startsWith("[") || at === ""
        ? `${at}${inside}`
        : `${at}.${inside}`;
    const what = first?.message === missing ? missing : "is malformed";
    return `${path === "" ? "it" : path} ${what}`;
  });
