import { Button } from "@cota/ui/components/button";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { Note } from "@cota/ui/components/note";
import {
  Segment,
  SegmentHead,
  SegmentMeta,
  SegmentShow,
  SegmentTitle,
} from "@cota/ui/components/segment";
import { TranscriptSkeleton } from "@cota/ui/components/transcript";
import { type ReactNode, useState } from "react";
import { tokens } from "#shared/domain/quantities.ts";
import { Problem } from "#shared/problem.tsx";
import { ReportedMark } from "#shared/reported.tsx";
import {
  type Entry,
  type Expansion,
  type Hideable,
  TranscriptView,
} from "#shared/transcript/transcript.tsx";
import { counted, millis, plural, stretch } from "#shared/words.ts";
import {
  type SessionAnswer,
  type Segment as Stretch,
  useRequest,
} from "./queries.ts";

const nextBegan: Record<Stretch["startedBy"], string> = {
  start: "",
  size: "the next began when the prompt fell below half its size",
  compaction: "the next began when the client compacted the conversation",
};

function SegmentHeading({
  segment,
  of,
  next,
  now,
  children,
}: {
  readonly segment: Stretch;
  readonly of: number;
  readonly next: Stretch | undefined;
  readonly now: number;
  readonly children?: ReactNode;
}) {
  const facts = [
    stretch(millis(segment.startedAt), millis(segment.endedAt), now),
    plural(segment.requests, "main request"),
    segment.promptSize === null
      ? null
      : `its tip's prompt ${tokens(segment.promptSize)}`,
    next === undefined ? null : nextBegan[next.startedBy],
  ].filter((each) => each !== null && each !== "");
  return (
    <SegmentHead>
      <SegmentTitle>
        Segment {counted(segment.index + 1)} of {counted(of)}
      </SegmentTitle>
      <SegmentMeta>{facts.join(" · ")}</SegmentMeta>
      {children}
    </SegmentHead>
  );
}

function EarlierSegment({
  segment,
  of,
  next,
  now,
  hidden,
  expansion,
}: {
  readonly segment: Stretch;
  readonly of: number;
  readonly next: Stretch | undefined;
  readonly now: number;
  readonly hidden: ReadonlySet<Hideable>;
  readonly expansion: Expansion;
}) {
  const [shown, setShown] = useState(false);
  const tip = useRequest(segment.tip, shown);
  const entries: ReadonlyArray<Entry> =
    tip.data === undefined
      ? []
      : [
          ...(tip.data.system ?? []),
          ...(tip.data.input ?? []),
          ...(tip.data.output ?? []),
        ];
  return (
    <Segment aria-label={`Segment ${segment.index + 1} of ${of}`}>
      <SegmentHeading segment={segment} of={of} next={next} now={now}>
        {shown ? (
          <Button variant="ghost" size="sm" onClick={() => setShown(false)}>
            Hide
          </Button>
        ) : null}
      </SegmentHeading>
      {!shown ? (
        <SegmentShow onClick={() => setShown(true)}>
          Show this segment's transcript
          <span>read from its tip, the last request that answered</span>
        </SegmentShow>
      ) : tip.isError ? (
        <Problem
          title="The hub could not read this segment's transcript."
          error={tip.error}
          onRetry={() => tip.refetch()}
        />
      ) : tip.data === undefined ? (
        <div role="status" aria-label="The segment's transcript is loading">
          <TranscriptSkeleton />
        </div>
      ) : (
        <TranscriptView
          entries={entries}
          request={segment.tip}
          cutCharacters={tip.data.cutCharacters}
          hidden={hidden}
          expansion={expansion}
        />
      )}
    </Segment>
  );
}

export function Conversation({
  answer,
  now,
  hidden,
  expansion,
}: {
  readonly answer: SessionAnswer;
  readonly now: number;
  readonly hidden: ReadonlySet<Hideable>;
  readonly expansion: Expansion;
}) {
  const { transcript, segments } = answer;
  const last = segments.at(-1);

  if (transcript === null) {
    return (
      <section aria-label="Conversation" className="min-w-0">
        <Empty>
          <EmptyTitle>There is no stored conversation.</EmptyTitle>
          <EmptyDescription>
            A transcript is read from a session's main requests, and this
            session has none that carried a conversation: its requests were
            token counts, titles or side questions, or they failed before a
            conversation was stored.
          </EmptyDescription>
        </Empty>
      </section>
    );
  }

  const tip = answer.requests.find(({ id }) => id === transcript.request);
  return (
    <section aria-label="Conversation" className="flex min-w-0 flex-col gap-6">
      {tip?.origin === "reported" ? (
        <div className="flex items-baseline gap-2">
          <ReportedMark />
          <Note>
            The steps as the client recorded them. After a compaction the record
            still holds every step, so a segment's transcript shows them all,
            though the model was sent less.
          </Note>
        </div>
      ) : null}
      {segments.slice(0, -1).map((segment, index) => (
        <EarlierSegment
          key={segment.index}
          segment={segment}
          of={segments.length}
          next={segments[index + 1]}
          now={now}
          hidden={hidden}
          expansion={expansion}
        />
      ))}
      <Segment
        aria-label={
          last === undefined
            ? "The conversation"
            : `Segment ${last.index + 1} of ${segments.length}`
        }
      >
        {last === undefined || segments.length === 1 ? null : (
          <SegmentHeading
            segment={last}
            of={segments.length}
            next={undefined}
            now={now}
          />
        )}
        <TranscriptView
          entries={transcript.entries}
          request={transcript.request}
          cutCharacters={transcript.cutCharacters}
          hidden={hidden}
          expansion={expansion}
        />
      </Segment>
    </section>
  );
}
