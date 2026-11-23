import { Stat, StatLabel, StatNote, StatValue } from "@cota/ui/components/stat";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { ago, span, tokens } from "#shared/domain/quantities.ts";
import {
  costText,
  counted,
  dollarsOf,
  inputIn,
  millis,
  plural,
  timeOf,
  when,
} from "#shared/words.ts";
import type { SessionAnswer } from "./queries.ts";
import { type Role, roles } from "./search.ts";

/** How many of the listed requests each role has, the roles the session has alone. */
export const roleCounts = (requests: SessionAnswer["requests"]) =>
  roles.flatMap((role) => {
    const count = requests.filter((each) => each.requestRole === role).length;
    return count === 0 ? [] : [{ role, count }];
  });

export const roleNames: Record<Role, string> = {
  main: "main",
  subagent: "subagent",
  title: "title",
  utility: "utility",
};

/** A count of tokens over the requests that reported usage, written as a lower bound while any did not. */
const atLeast = (count: number, unreported: number) =>
  unreported > 0 ? `≥${tokens(count)}` : tokens(count);

export function Figures({
  answer,
  now,
}: {
  readonly answer: SessionAnswer;
  readonly now: number;
}) {
  const row = answer.session;
  const started = millis(row.startedAt);
  const ended = millis(row.endedAt);
  const { usage } = row;
  const refused = answer.requests.filter(
    (each) => each.outcome === "refused",
  ).length;
  const cancelled = answer.requests.filter(
    (each) => each.outcome === "cancelled",
  ).length;
  const unreported =
    row.usageUnreported > 0
      ? `; ${plural(row.usageUnreported, "request")} reported none`
      : "";
  return (
    <section
      aria-label="Figures"
      className="mb-10 grid grid-cols-2 gap-2.5 @3xl:grid-cols-4 @7xl:grid-cols-8 wide:mb-12 wide:gap-3"
    >
      <Stat variant="tile">
        <StatLabel>Started</StatLabel>
        <StatValue>{when(started, now)}</StatValue>
        <StatNote>{ago(now - started)}</StatNote>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Lasted</StatLabel>
        <StatValue>{span(ended - started)}</StatValue>
        <StatNote>last request at {timeOf(ended)}</StatNote>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Requests</StatLabel>
        <StatValue>{counted(row.requests)}</StatValue>
        <StatNote>
          {roleCounts(answer.requests)
            .map(({ role, count }) => `${counted(count)} ${roleNames[role]}`)
            .join(" · ")}
          {answer.requestsCut > 0 ? " of the latest listed" : ""}
        </StatNote>
      </Stat>
      <Stat
        variant="tile"
        {...(row.errors > 0
          ? {
              render: (
                <Link
                  to="/sessions/$session"
                  params={{ session: row.id }}
                  search={(previous) => ({
                    ...previous,
                    tab: "requests",
                    outcome: ["error"],
                  })}
                  resetScroll={false}
                />
              ),
            }
          : {})}
      >
        <StatLabel>
          Errors
          {row.errors > 0 ? <ArrowUpRight aria-hidden="true" /> : null}
        </StatLabel>
        <StatValue tone={row.errors > 0 ? "danger" : "default"}>
          {counted(row.errors)}
        </StatValue>
        <StatNote>
          {refused + cancelled === 0
            ? "no request refused or cancelled"
            : [
                refused > 0 ? `${counted(refused)} refused` : null,
                cancelled > 0 ? `${counted(cancelled)} cancelled` : null,
              ]
                .filter((each) => each !== null)
                .join(", ")
                .concat(" besides")}
        </StatNote>
      </Stat>
      <Stat variant="tile" className="col-span-2">
        <StatLabel>Prompt tokens</StatLabel>
        <StatValue>{atLeast(inputIn(usage), row.usageUnreported)}</StatValue>
        <StatNote>
          every request's prompt: {tokens(usage.input)} uncached,{" "}
          {tokens(usage.cacheRead)} cache reads,{" "}
          {tokens(usage.cacheWriteShort + usage.cacheWriteLong)} cache writes
          {unreported}
        </StatNote>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Output tokens</StatLabel>
        <StatValue>{atLeast(usage.output, row.usageUnreported)}</StatValue>
        <StatNote>
          every answer, {tokens(usage.reasoning)} of reasoning in it
        </StatNote>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Cost</StatLabel>
        <StatValue>
          {costText(dollarsOf(row.costUsd), row.unpricedRequests)}
        </StatValue>
        <StatNote>
          at list prices
          {row.unpricedRequests > 0
            ? `; ${plural(row.unpricedRequests, "request")} without a price`
            : ""}
        </StatNote>
      </Stat>
    </section>
  );
}
