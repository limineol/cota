import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { Note } from "@cota/ui/components/note";
import { type ReactNode, useState } from "react";
import { TranscriptControls } from "#shared/transcript/controls.tsx";
import {
  type Entry,
  type Expansion,
  type Hideable,
  hiddenCounts,
  TranscriptView,
} from "#shared/transcript/transcript.tsx";
import { plural } from "#shared/words.ts";
import type { RequestRecord } from "./queries.ts";

/** Where the body the hub rebuilds for a request is read, which opens as JSON in a tab of its own. */
export const bodyPath = (request: string) =>
  `/api/requests/${encodeURIComponent(request)}/body`;

/** What the body the hub rebuilds is, by the request's origin, as the middle of a sentence. */
export const bodyWords = (request: RequestRecord) => {
  switch (request.origin) {
    case "imported":
      return "the body as Bifrost logged it";
    case "reported":
      return "the steps as the client recorded them";
    case "forwarded":
      return "the body as the hub forwarded it";
  }
};

/** The link to where a cut text is whole: the body the hub rebuilds. */
const bodyLinkOf = (request: RequestRecord): ReactNode => (
  <a href={bodyPath(request.id)} target="_blank" rel="noreferrer">
    {bodyWords(request)}
  </a>
);

const operationsWithout: Readonly<Record<string, string>> = {
  models:
    "A model listing asks which models exist, and carries no conversation.",
  count_tokens: "This token count's body was not stored as a conversation.",
  search: "A web search carries a query, not a conversation.",
  image: "An image request carries a prompt, not a conversation.",
};

/** Why a request has no conversation to show, from what it was. */
const whyNone = (request: RequestRecord) =>
  operationsWithout[request.operation] ??
  "The request log stored no conversation for this request: its body could not be read as one, or it never reached the provider.";

export function Conversation({
  part,
  entries,
  request,
  cutCharacters,
  hidden,
  onHiddenChange,
}: {
  readonly part: "input" | "output";
  readonly entries: ReadonlyArray<Entry> | null;
  readonly request: RequestRecord;
  readonly cutCharacters: number;
  readonly hidden: ReadonlySet<Hideable>;
  readonly onHiddenChange: (switched: Hideable, hide: boolean) => void;
}) {
  const [expansion, setExpansion] = useState<Expansion>({ open: false });
  if (entries === null) {
    return (
      <Empty>
        <EmptyTitle>There is no conversation.</EmptyTitle>
        <EmptyDescription>{whyNone(request)}</EmptyDescription>
      </Empty>
    );
  }
  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyTitle>
          {part === "output" ? "Nothing came back." : "Nothing was sent."}
        </EmptyTitle>
        <EmptyDescription>
          {part === "output"
            ? request.outcome === "ok"
              ? "The provider answered with no output item."
              : "The request ended before the provider gave any output."
            : "The request carried no system prompt and no input item."}
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <TranscriptControls
        counts={hiddenCounts(entries)}
        hidden={hidden}
        onHiddenChange={onHiddenChange}
        onExpansion={setExpansion}
      />
      {cutCharacters > 0 ? (
        <Note>
          Each text is shown up to 100,000 characters;{" "}
          {plural(cutCharacters, "character")} were left out of this request's
          texts, and {bodyLinkOf(request)} has them.
        </Note>
      ) : null}
      <TranscriptView
        entries={entries}
        request={request.id}
        uncut={bodyLinkOf(request)}
        cutCharacters={0}
        hidden={hidden}
        expansion={expansion}
      />
    </div>
  );
}
