import { Stat, StatLabel, StatNote, StatValue } from "@cota/ui/components/stat";
import { tokens } from "#shared/domain/quantities.ts";
import { costText, dollarsOf, durationOf } from "#shared/words.ts";
import type { RequestRecord } from "./queries.ts";
import { notInTheRecord, reported as wasReported } from "./words.ts";

const unreported = "not reported";

function Status({ request }: { readonly request: RequestRecord }) {
  if (wasReported(request)) {
    return (
      <>
        <StatValue>none</StatValue>
        <StatNote>
          {request.stopReason === ""
            ? notInTheRecord
            : `${notInTheRecord}; stopped: ${request.stopReason}`}
        </StatNote>
      </>
    );
  }
  if (request.upstreamStatus === 0) {
    return (
      <>
        <StatValue>none</StatValue>
        <StatNote>the provider never answered</StatNote>
      </>
    );
  }
  return (
    <>
      <StatValue tone={request.outcome === "error" ? "danger" : "default"}>
        {request.upstreamStatus}
      </StatValue>
      <StatNote>
        {request.stopReason === ""
          ? "the provider's HTTP status"
          : `stopped: ${request.stopReason}`}
      </StatNote>
    </>
  );
}

export function Figures({ request }: { readonly request: RequestRecord }) {
  const reported = request.usageReported;
  const noUsage = wasReported(request)
    ? "the client's record had no usage"
    : "the provider gave no usage";
  const cacheWrites =
    request.cacheWriteShortTokens + request.cacheWriteLongTokens;
  return (
    <section
      aria-label="Figures"
      className="mb-10 grid grid-cols-2 gap-2.5 @3xl:grid-cols-5 wide:gap-3"
    >
      <Stat variant="tile">
        <StatLabel>Duration</StatLabel>
        <StatValue>{durationOf(request.durationMs)}</StatValue>
        <StatNote>
          {wasReported(request)
            ? `as the client recorded it; first byte ${notInTheRecord}`
            : request.firstByteMs === null
              ? "no byte came back"
              : `first byte after ${durationOf(request.firstByteMs)}`}
        </StatNote>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Prompt size</StatLabel>
        <StatValue>
          {request.promptSize === null
            ? unreported
            : tokens(request.promptSize)}
        </StatValue>
        <StatNote>
          {reported
            ? `${tokens(request.inputTokens)} uncached, ${tokens(request.cacheReadTokens)} cache reads, ${tokens(cacheWrites)} cache writes`
            : noUsage}
        </StatNote>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Output tokens</StatLabel>
        <StatValue>
          {reported ? tokens(request.outputTokens) : unreported}
        </StatValue>
        <StatNote>
          {reported
            ? `${tokens(request.reasoningTokens)} of reasoning in it`
            : noUsage}
        </StatNote>
      </Stat>
      <Stat variant="tile">
        <StatLabel>Cost</StatLabel>
        <StatValue>
          {request.costUsd === null
            ? "no price"
            : costText(dollarsOf(request.costUsd), 0)}
        </StatValue>
        <StatNote>
          {request.costUsd !== null
            ? `at list prices${request.serviceTier === "" ? "" : `, ${request.serviceTier} tier`}`
            : reported
              ? "its model has no price in the price list"
              : "no usage to price"}
        </StatNote>
      </Stat>
      <Stat variant="tile" className="col-span-2 @3xl:col-span-1">
        <StatLabel>Upstream status</StatLabel>
        <Status request={request} />
      </Stat>
    </section>
  );
}
