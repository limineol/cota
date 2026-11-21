import { Badge } from "@cota/ui/components/badge";
import { Button } from "@cota/ui/components/button";
import { Identifier } from "@cota/ui/components/identifier";
import { Note } from "@cota/ui/components/note";
import {
  PageDescription,
  PageHeader,
  PageTitle,
} from "@cota/ui/components/page";
import { Tag, Tags } from "@cota/ui/components/tag";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { rememberedList } from "#shared/last-list.ts";
import { type Kind, useNameOf } from "#shared/names.tsx";
import type { Dimension } from "#shared/sessions-search.ts";
import { counted, millis } from "#shared/words.ts";
import { bodyPath } from "./conversation.tsx";
import type { Inspected, RequestRecord } from "./queries.ts";
import { imported, outcomeText, titleOf, toTheSecond } from "./words.ts";

const tagged: ReadonlyArray<{
  readonly key: "pool" | "project" | "client" | "machine" | "model";
  readonly dimension: Dimension & Kind;
  readonly label: string;
}> = [
  { key: "pool", dimension: "pool", label: "Pool" },
  { key: "project", dimension: "project", label: "Project" },
  { key: "client", dimension: "client", label: "Client" },
  { key: "machine", dimension: "machine", label: "Machine" },
  { key: "model", dimension: "model", label: "Model" },
];

const roleWords = {
  main: "Main request",
  subagent: "Subagent request",
  title: "Title request",
  utility: "Utility request",
} as const;

function Sent({ request }: { readonly request: RequestRecord }) {
  const nameOf = useNameOf();
  const served =
    request.servedModel !== "" && request.servedModel !== request.model
      ? `Asked for ${request.model}, served by ${request.servedModel}; sent`
      : "Sent";
  const client = [nameOf("client", request.client), request.clientVersion]
    .filter((each) => each !== "")
    .join(" ");
  return (
    <>
      {served} by {client} on {toTheSecond(millis(request.startedAt))}
    </>
  );
}

function Facts({
  request,
  followedBy,
}: {
  readonly request: RequestRecord;
  readonly followedBy: string | null;
}) {
  const nameOf = useNameOf();
  const facts: Array<ReactNode> = [];
  if (imported(request)) {
    facts.push(
      <span key="imported">
        Imported from a Bifrost log: its conversation is as Bifrost logged it,
        not what the client sent.{" "}
      </span>,
    );
  }
  if (request.divertedFrom !== null) {
    facts.push(
      <span key="from">
        Diverted from {nameOf("pool", request.divertedFrom)} to{" "}
        {nameOf("pool", request.pool)}, whose login the provider had refused.
      </span>,
    );
  }
  if (request.follows !== null) {
    facts.push(
      <span key="follows">
        {" "}
        It was sent again after{" "}
        <Link to="/requests/$id" params={{ id: request.follows }}>
          the refused request
        </Link>
        .
      </span>,
    );
  }
  if (followedBy !== null) {
    facts.push(
      <span key="followed">
        {" "}
        The provider refused it, and the hub sent it again as{" "}
        <Link to="/requests/$id" params={{ id: followedBy }}>
          another request
        </Link>
        .
      </span>,
    );
  }
  return facts.length === 0 ? null : <Note>{facts}</Note>;
}

export function Header({
  answer,
  markOf,
}: {
  readonly answer: Inspected;
  readonly markOf: (pool: string) => ReactNode;
}) {
  const nameOf = useNameOf();
  const { request } = answer;
  const { range } = rememberedList();
  const conversation = answer.params !== null;
  return (
    <header className="mb-8 flex flex-col gap-3">
      <PageHeader className="mb-0">
        <div>
          <PageTitle>
            {titleOf(request, (model) => nameOf("model", model))}
          </PageTitle>
          <PageDescription>
            <Sent request={request} />
          </PageDescription>
        </div>
        {conversation ? (
          <div className="flex flex-col items-start gap-1 wide:items-end">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a
                  href={bodyPath(request.id)}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              {imported(request)
                ? "The body as Bifrost logged it"
                : "The body as the hub forwarded it"}
              <ExternalLink aria-hidden="true" />
            </Button>
            <Note>Rebuilt from the request log; opens in a new tab</Note>
          </div>
        ) : null}
      </PageHeader>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={request.outcome === "error" ? "danger" : "outline"}>
          {outcomeText(request)}
        </Badge>
        {answer.requestRole === null ? null : (
          <Badge>{roleWords[answer.requestRole]}</Badge>
        )}
        {answer.segment === null ? null : (
          <Badge>Segment {counted(answer.segment + 1)}</Badge>
        )}
      </div>
      <Identifier value={request.id} label="request id" />
      <Tags aria-label="What the request was made with">
        {tagged.flatMap(({ key, dimension, label }) => {
          const value = request[key];
          return value === ""
            ? []
            : [
                <Tag
                  key={dimension}
                  dimension={label}
                  title={`The sessions of ${label.toLowerCase()} ${nameOf(dimension, value)}`}
                  render={
                    <Link
                      to="/sessions"
                      search={{
                        ...(range === undefined ? {} : { range }),
                        [dimension]: [value],
                      }}
                    />
                  }
                >
                  {dimension === "pool" ? markOf(value) : null}
                  <span title={value}>{nameOf(dimension, value)}</span>
                </Tag>,
              ];
        })}
      </Tags>
      <Facts request={request} followedBy={answer.followedBy} />
    </header>
  );
}
