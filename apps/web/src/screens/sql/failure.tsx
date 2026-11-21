import {
  Alert,
  AlertCode,
  AlertDescription,
  AlertTitle,
} from "@cota/ui/components/alert";
import { Button } from "@cota/ui/components/button";
import { Predicate } from "effect";
import { CircleAlert } from "lucide-react";
import { Problem } from "#shared/problem.tsx";
import { counted } from "#shared/words.ts";

const detailOf = (error: unknown) =>
  Predicate.hasProperty(error, "detail") && typeof error.detail === "string"
    ? error.detail
    : "";

interface ClickHouseMessage {
  readonly message: string;
  readonly name: string | null;
  readonly code: string | null;
  /** Where in the statement ClickHouse stopped, from 1, when it says. */
  readonly position: number | null;
  readonly line: string | null;
}

/** ClickHouse's message without its code and exception prefix, its error's name and code apart, and where it stopped when it says. */
export const readClickHouse = (detail: string): ClickHouseMessage => {
  const coded = /^Code: (\d+)\. (?:DB::Exception: )?/.exec(detail);
  const body = coded === null ? detail : detail.slice(coded[0].length);
  const named = /\s*\(([A-Z][A-Z0-9_]+)\)$/.exec(body);
  const message = named === null ? body : body.slice(0, named.index);
  const position = /failed at position (\d+)/.exec(message);
  const line = /\(line (\d+), col (\d+)\)/.exec(message);
  return {
    message: message.trim(),
    name: named?.[1] ?? null,
    code: coded?.[1] ?? null,
    position: position === null ? null : Number(position[1]),
    line: line === null ? null : `line ${line[1]}, column ${line[2]}`,
  };
};

/**
 * What a run that failed says, in words: ClickHouse's message set out, with
 * where it stopped and a button to show it in the editor, or what to do about
 * a refused format, SQL too long, or SQL that is unavailable.
 */
export function RunFailure({
  error,
  sql,
  onShow,
  onRetry,
}: {
  readonly error: unknown;
  readonly sql: string;
  readonly onShow: ((position: number) => void) | null;
  readonly onRetry: () => void;
}) {
  if (Predicate.isTagged(error, "QueryFailedProblem")) {
    const said = readClickHouse(detailOf(error));
    const where =
      said.line ??
      (said.position === null ? null : `character ${counted(said.position)}`);
    const { position } = said;
    return (
      <Alert variant="danger">
        <CircleAlert />
        <AlertTitle>ClickHouse refused or stopped the query</AlertTitle>
        <AlertDescription>
          {said.name === null ? (
            "Its message:"
          ) : (
            <>
              <code>{said.name}</code>
              {said.code === null ? "" : ` (code ${said.code})`}
              {where === null ? "" : `, at ${where}`}.
            </>
          )}
        </AlertDescription>
        <AlertCode>{said.message}</AlertCode>
        {position === null || onShow === null ? null : (
          <div className="col-start-2 mt-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShow(position)}
            >
              Show in the editor
            </Button>
          </div>
        )}
      </Alert>
    );
  }
  if (Predicate.isTagged(error, "FormatNotAllowedProblem")) {
    return (
      <Alert variant="danger">
        <CircleAlert />
        <AlertTitle>The query names its own format</AlertTitle>
        <AlertDescription>
          The hub chooses the format it asks ClickHouse for, so that it can cap
          the answer and give each column its type. Take the <code>FORMAT</code>{" "}
          clause out and run the query again.
        </AlertDescription>
      </Alert>
    );
  }
  if (Predicate.isTagged(error, "QueryTooLongProblem")) {
    return (
      <Alert variant="danger">
        <CircleAlert />
        <AlertTitle>The SQL is too long</AlertTitle>
        <AlertDescription>
          It has {counted(sql.length)} characters, and the hub takes at most
          100,000. Shorten it, or select one statement and run that alone.
        </AlertDescription>
      </Alert>
    );
  }
  if (Predicate.isTagged(error, "SqlUnavailableProblem")) {
    return <SqlUnavailable detail={detailOf(error)} />;
  }
  return (
    <Problem
      title="The query could not be run."
      error={error}
      onRetry={onRetry}
    />
  );
}

/** Why the hub cannot answer SQL, and what its configuration needs, from `docs/specs/sql/spec.md`. */
export function SqlUnavailable({ detail }: { readonly detail: string }) {
  return (
    <Alert variant="danger">
      <CircleAlert />
      <AlertTitle>SQL is unavailable on this hub</AlertTitle>
      <AlertDescription>
        <p>
          The hub answers SQL as a ClickHouse user of its own,{" "}
          <code>&lt;database&gt;_sql</code>, which it makes when it starts. Its
          own ClickHouse user needs access management for that; give it{" "}
          <code>access_management</code> and restart the hub. If ClickHouse
          could not be reached, the hub tries again by itself. Its log says what
          went wrong.
        </p>
      </AlertDescription>
      {detail === "" ? null : <AlertCode>{detail}</AlertCode>}
    </Alert>
  );
}
