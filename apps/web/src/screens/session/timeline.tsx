import {
  ContextColumns,
  ContextKey,
  type ContextLayout,
} from "@cota/ui/components/context-columns";
import { Legend } from "@cota/ui/components/legend";
import {
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from "@cota/ui/components/page";
import { contextColumns } from "#shared/domain/context.ts";
import type { Hue } from "#shared/domain/hues.ts";
import { span, tokens } from "#shared/domain/quantities.ts";
import { useNameOf } from "#shared/names.tsx";
import { counted, millis, plural, when } from "#shared/words.ts";
import type { RequestSummary, Segment } from "./queries.ts";

/** A request as the context columns read it: a main request in its segment, any other in none. */
const contextOf = (request: RequestSummary) => ({
  segment: request.requestRole === "main" ? (request.segment ?? 0) : null,
  promptSize: request.promptSize,
  error: request.outcome === "error",
  diverted: request.divertedFrom !== null,
});

const secondsOf = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The shape of the session's main conversation in a sentence, for a reader who cannot see the chart. */
export const shapeOf = (
  requests: ReadonlyArray<RequestSummary>,
  segments: number,
) => {
  const main = requests.filter((each) => each.requestRole === "main");
  const first = main[0];
  const last = main.at(-1);
  const peak = Math.max(0, ...main.map((each) => each.promptSize ?? 0));
  const lasted =
    first === undefined || last === undefined
      ? 0
      : millis(last.startedAt) - millis(first.startedAt);
  return `${plural(main.length, "main request")} over ${span(lasted)} in ${plural(
    Math.max(1, segments),
    "segment",
  )}; the prompt peaked at ${tokens(peak)} tokens`;
};

export function Timeline({
  requests,
  segments,
  hue,
  now,
  onActivate,
}: {
  readonly requests: ReadonlyArray<RequestSummary>;
  readonly segments: ReadonlyArray<Segment>;
  readonly hue: Hue;
  readonly now: number;
  readonly onActivate: (request: RequestSummary) => void;
}) {
  const nameOf = useNameOf();
  const main = requests.filter((each) => each.requestRole === "main");
  const first = main[0];
  const last = main.at(-1);
  if (first === undefined || last === undefined) return null;
  const startedBy = new Map(
    segments.map((segment) => [segment.index, segment.startedBy]),
  );
  const unit = contextColumns(requests.map(contextOf), 1).unit;

  const fit = (capacity: number): ContextLayout => ({
    columns: contextColumns(requests.map(contextOf), capacity).columns.map(
      (column) => {
        const stretch = requests.slice(column.from, column.to);
        const own = stretch.filter((each) => each.requestRole === "main");
        const start = own[0] ?? stretch[0];
        const end = own.at(-1) ?? stretch.at(-1);
        const output = own.reduce(
          (sum, each) => sum + (each.outputTokens ?? 0),
          0,
        );
        const diverted = [
          ...new Set(
            stretch.flatMap((each) =>
              each.divertedFrom === null ? [] : [each.divertedFrom],
            ),
          ),
        ];
        const times =
          start === undefined || end === undefined
            ? ""
            : start === end
              ? secondsOf.format(millis(start.startedAt))
              : `${secondsOf.format(millis(start.startedAt))}–${secondsOf.format(millis(end.startedAt))}`;
        return {
          key: String(column.from),
          blocks: column.blocks,
          others: column.others,
          danger: column.errors > 0,
          opens:
            column.opens && column.segment !== (first.segment ?? 0)
              ? startedBy.get(column.segment) === "compaction"
                ? "compacted"
                : "new segment"
              : null,
          readout: (
            <>
              <strong>{times}</strong>
              <span>{plural(column.main, "main request")}</span>
              <span>
                largest prompt{" "}
                <strong>
                  {column.peak === null ? "unreported" : tokens(column.peak)}
                </strong>
              </span>
              <span>{tokens(output)} output</span>
              {column.others > 0 ? (
                <span>
                  {plural(column.others, "other request")} beside them
                </span>
              ) : null}
              {column.errors > 0 ? (
                <span>{plural(column.errors, "error")}</span>
              ) : null}
              {diverted.length > 0 ? (
                <span>
                  {counted(column.diverted)} diverted from{" "}
                  {diverted.map((pool) => nameOf("pool", pool)).join(", ")}
                </span>
              ) : null}
            </>
          ),
        };
      },
    ),
  });

  return (
    <Section aria-labelledby="context-title" className="mt-0 wide:mt-0">
      <SectionHeader>
        <div>
          <SectionTitle id="context-title">
            Context, request by request
          </SectionTitle>
          <SectionDescription>
            Each column is the prompt one main request sent, and a drop is a new
            segment. Hover or focus a column to read it; a click shows its
            requests.
          </SectionDescription>
        </div>
      </SectionHeader>
      <ContextColumns
        fit={fit}
        hue={hue}
        label={shapeOf(requests, segments.length)}
        start={when(millis(first.startedAt), now)}
        end={when(millis(last.startedAt), now)}
        onActivate={(key) => {
          const request = requests[Number(key)];
          if (request !== undefined) onActivate(request);
        }}
      />
      <Legend>
        <ContextKey mark="column" hue={hue}>
          One block is {tokens(unit)} tokens of prompt; a column shows the
          largest of the requests it holds
        </ContextKey>
        {requests.length > main.length ? (
          <ContextKey mark="other">
            A subagent, title or utility request
          </ContextKey>
        ) : null}
        {requests.some((each) => each.outcome === "error") ? (
          <ContextKey mark="error">An error</ContextKey>
        ) : null}
        {segments.length > 1 ? (
          <ContextKey mark="segment">A new segment</ContextKey>
        ) : null}
      </Legend>
    </Section>
  );
}
