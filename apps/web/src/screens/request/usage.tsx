import { JsonView } from "@cota/ui/components/json-view";
import { Note } from "@cota/ui/components/note";
import { Subheading } from "@cota/ui/components/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
} from "@cota/ui/components/table";
import { cost } from "#shared/domain/quantities.ts";
import { counted, dollarsOf } from "#shared/words.ts";
import type { RequestRecord } from "./queries.ts";
import { reported as wasReported } from "./words.ts";

const classes: ReadonlyArray<{
  readonly name: string;
  readonly tokens: (request: RequestRecord) => number;
}> = [
  { name: "Input, uncached", tokens: (request) => request.inputTokens },
  { name: "Cache read", tokens: (request) => request.cacheReadTokens },
  {
    name: "Cache write, the provider's default lifetime",
    tokens: (request) => request.cacheWriteShortTokens,
  },
  {
    name: "Cache write, a longer lifetime",
    tokens: (request) => request.cacheWriteLongTokens,
  },
  { name: "Output", tokens: (request) => request.outputTokens },
  {
    name: "Of the output, reasoning",
    tokens: (request) => request.reasoningTokens,
  },
];

function Priced({ request }: { readonly request: RequestRecord }) {
  if (request.costUsd !== null) {
    return (
      <Note>
        The hub priced it at {cost(dollarsOf(request.costUsd))} at its price
        list's prices
        {request.serviceTier === ""
          ? ""
          : `, for the ${request.serviceTier} tier`}
        , once, when it was written to the request log.
      </Note>
    );
  }
  return (
    <Note>
      {request.usageReported
        ? "The hub has no price for this model, so it has no cost. It is not counted as nothing."
        : "With no usage reported, the hub priced nothing."}
    </Note>
  );
}

export function UsagePanel({ request }: { readonly request: RequestRecord }) {
  const reported = request.usageReported;
  const fromARecord = wasReported(request);
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <section
        aria-labelledby="usage-classes"
        className="flex max-w-3xl flex-col gap-2.5"
      >
        <Subheading level={2} id="usage-classes">
          By class
        </Subheading>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead numeric>Tokens</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {classes.map(({ name, tokens }) => (
              <TableRow key={name}>
                <TableCell>
                  <TableLabel>{name}</TableLabel>
                </TableCell>
                <TableCell numeric>
                  {reported ? counted(tokens(request)) : "not reported"}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell>
                <TableLabel>
                  Prompt size: input, cache reads and writes
                </TableLabel>
              </TableCell>
              <TableCell numeric>
                {request.promptSize === null
                  ? "not reported"
                  : counted(request.promptSize)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Priced request={request} />
      </section>
      <section
        aria-labelledby="usage-reported"
        className="flex flex-col gap-2.5"
      >
        <Subheading level={2} id="usage-reported">
          {fromARecord
            ? "As the client's record holds it"
            : "As the provider reported it"}
        </Subheading>
        {request.usage === null ? (
          <Note>
            {fromARecord
              ? "The client's record had no usage for this call."
              : `The provider reported no usage for this request${
                  request.readingComplete
                    ? "."
                    : ", and its answer could not be read to the end."
                }`}
          </Note>
        ) : (
          <JsonView value={request.usage} />
        )}
      </section>
    </div>
  );
}
