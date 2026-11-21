import { Button } from "@cota/ui/components/button";
import { Empty, EmptyTitle } from "@cota/ui/components/empty";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFilters,
  ListPanelFoot,
  ListPanelHead,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { RequestEnded, RequestRole } from "@cota/ui/components/request-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableMagnitude,
  TableRow,
  TableSecondary,
} from "@cota/ui/components/table";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { tokens } from "#shared/domain/quantities.ts";
import { countedIn, ValuesFilter } from "#shared/filter.tsx";
import { useNameOf } from "#shared/names.tsx";
import {
  costText,
  counted,
  dollarsOf,
  durationOf,
  millis,
  plural,
} from "#shared/words.ts";
import type { RequestSummary } from "./queries.ts";
import { type Outcome, outcomes, type Role, roles } from "./search.ts";

/** How many rows the list shows at first, and adds each time the reader asks for more. */
export const shownAtOnce = 200;

/** The DOM id of a request's link, which the context columns lead to. */
export const rowIdOf = (request: string) => `request-${request}`;

export const roleWords: Record<Role, string> = {
  main: "Main",
  subagent: "Subagent",
  title: "Title",
  utility: "Utility",
};

const outcomeWords: Record<Outcome, string> = {
  ok: "Answered",
  error: "Errors",
  refused: "Refused",
  cancelled: "Cancelled",
};

const secondsOf = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The requests the filters keep, newest first. */
export const listedOf = (
  requests: ReadonlyArray<RequestSummary>,
  role: ReadonlyArray<Role>,
  outcome: ReadonlyArray<Outcome>,
) =>
  requests
    .filter(
      (each) =>
        (role.length === 0 || role.includes(each.requestRole)) &&
        (outcome.length === 0 || outcome.includes(each.outcome)),
    )
    .toReversed();

const countsOf = <T extends string>(
  values: ReadonlyArray<T>,
  of: (request: RequestSummary) => T,
  requests: ReadonlyArray<RequestSummary>,
) =>
  values.flatMap((value) => {
    const count = requests.filter((each) => of(each) === value).length;
    return count === 0 ? [] : [{ value, requests: count }];
  });

const sizeOf = (size: number | null) =>
  size === null ? "unreported" : tokens(size);

const costOf = (request: RequestSummary) =>
  request.costUsd === null
    ? "no price"
    : costText(dollarsOf(request.costUsd), 0);

function Ended({ request }: { readonly request: RequestSummary }) {
  const nameOf = useNameOf();
  if (request.outcome === "error") {
    return (
      <RequestEnded tone="danger">
        {request.upstreamStatus > 0
          ? `error ${request.upstreamStatus}`
          : "error"}
      </RequestEnded>
    );
  }
  if (request.outcome === "refused") {
    return <RequestEnded>refused</RequestEnded>;
  }
  if (request.outcome === "cancelled") {
    return <RequestEnded>cancelled</RequestEnded>;
  }
  if (request.divertedFrom !== null) {
    return (
      <RequestEnded tone="quiet">
        diverted from {nameOf("pool", request.divertedFrom)}
      </RequestEnded>
    );
  }
  return <RequestEnded tone="unseen">answered</RequestEnded>;
}

function RequestsHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">Time</TableHead>
        <TableHead scope="col">Role</TableHead>
        <TableHead scope="col" from="lg">
          Model
        </TableHead>
        <TableHead scope="col" numeric from="md">
          Prompt
        </TableHead>
        <TableHead scope="col" numeric from="md">
          Output
        </TableHead>
        <TableHead scope="col" numeric from="md">
          Cost
        </TableHead>
        <TableHead scope="col" numeric from="lg">
          Lasted
        </TableHead>
        <TableHead scope="col" numeric>
          Ended
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function RequestItem({
  request,
  peak,
  marked,
}: {
  readonly request: RequestSummary;
  readonly peak: number;
  readonly marked: boolean;
}) {
  const nameOf = useNameOf();
  return (
    <TableBody linked marked={marked}>
      <TableRow>
        <TableCell>
          <TableLabel
            render={
              <Link
                id={rowIdOf(request.id)}
                to="/requests/$id"
                params={{ id: request.id }}
              />
            }
          >
            {secondsOf.format(millis(request.startedAt))}
          </TableLabel>
          <TableSecondary className="@2xl/panel:hidden">
            {sizeOf(request.promptSize)} → {sizeOf(request.outputTokens)} ·{" "}
            {costOf(request)}
          </TableSecondary>
        </TableCell>
        <TableCell className="align-top @2xl/panel:align-middle">
          <RequestRole main={request.requestRole === "main"}>
            {roleWords[request.requestRole]}
          </RequestRole>
        </TableCell>
        <TableCell from="lg" className="w-full max-w-0">
          <span className="block truncate" title={request.model}>
            {nameOf("model", request.model)}
          </span>
        </TableCell>
        <TableCell numeric from="md">
          {sizeOf(request.promptSize)}
          <TableMagnitude fraction={(request.promptSize ?? 0) / peak} />
        </TableCell>
        <TableCell numeric from="md">
          {sizeOf(request.outputTokens)}
        </TableCell>
        <TableCell numeric from="md">
          {costOf(request)}
        </TableCell>
        <TableCell numeric from="lg">
          {durationOf(request.durationMs)}
        </TableCell>
        <TableCell numeric className="align-top @2xl/panel:align-middle">
          <Ended request={request} />
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

export function Requests({
  requests,
  requestsCut,
  role,
  outcome,
  onRoleChange,
  onOutcomeChange,
  onReset,
  shown,
  onShowMore,
  marked,
}: {
  readonly requests: ReadonlyArray<RequestSummary>;
  readonly requestsCut: number;
  readonly role: ReadonlyArray<Role>;
  readonly outcome: ReadonlyArray<Outcome>;
  readonly onRoleChange: (role: Role, on: boolean) => void;
  readonly onOutcomeChange: (outcome: Outcome, on: boolean) => void;
  readonly onReset: () => void;
  readonly shown: number;
  readonly onShowMore: () => void;
  readonly marked: string | null;
}) {
  const listed = listedOf(requests, role, outcome);
  const peak = Math.max(1, ...requests.map((each) => each.promptSize ?? 0));
  const older = listed.length - shown;
  return (
    <ListPanel aria-label="Requests">
      <ListPanelHead>
        <ListPanelFilters
          end={
            role.length + outcome.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={onReset}>
                Reset <X aria-hidden="true" />
              </Button>
            ) : null
          }
        >
          <ValuesFilter
            label="Role"
            values={countsOf(roles, (each) => each.requestRole, requests)}
            failed={false}
            chosen={role}
            nameOf={(each) => roleWords[each]}
            onToggle={onRoleChange}
            note={countedIn}
          />
          <ValuesFilter
            label="Outcome"
            values={countsOf(outcomes, (each) => each.outcome, requests)}
            failed={false}
            chosen={outcome}
            nameOf={(each) => outcomeWords[each]}
            onToggle={onOutcomeChange}
            note={countedIn}
          />
        </ListPanelFilters>
      </ListPanelHead>
      <ListPanelBody>
        {listed.length === 0 ? (
          <Empty>
            <EmptyTitle>No listed request has these filters.</EmptyTitle>
          </Empty>
        ) : (
          <Table aria-label="Requests, newest first">
            <RequestsHead />
            {listed.slice(0, shown).map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                peak={peak}
                marked={request.id === marked}
              />
            ))}
          </Table>
        )}
      </ListPanelBody>
      <ListPanelFoot>
        <div className="flex flex-col gap-1">
          <span>
            {listed.length === requests.length
              ? plural(requests.length, "request")
              : `${counted(listed.length)} of ${plural(requests.length, "request")}`}
          </span>
          {requestsCut > 0 ? (
            <Note>
              {counted(requestsCut)} older{" "}
              {requestsCut === 1 ? "request is" : "requests are"} left out: the
              hub lists only a session's latest {counted(requests.length)}.
            </Note>
          ) : null}
        </div>
        {older > 0 ? (
          <Button variant="outline" size="sm" onClick={onShowMore}>
            Show {counted(Math.min(shownAtOnce, older))} older
          </Button>
        ) : null}
      </ListPanelFoot>
    </ListPanel>
  );
}
