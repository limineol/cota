import type { RequestRecord } from "./queries.ts";

const conversations = new Set(["messages", "chat", "responses"]);

const operationWords: Readonly<Record<string, string>> = {
  count_tokens: "A token count",
  models: "A model listing",
  search: "A web search",
  image: "An image",
};

/** Whether a request was imported from the prototype's log: its protocol is a source form, whose items are as Bifrost logged them (ADR-0025). */
export const imported = (request: RequestRecord) =>
  request.protocol === "bifrost-responses" ||
  request.protocol === "bifrost-chat";

/** Whether a request answered or failed: failed for an error or a refusal, the two the Error tab is for. */
export const failed = (request: RequestRecord) =>
  request.outcome === "error" || request.outcome === "refused";

/** What a request was, in words: an answer from its model when one came, else its operation. */
export const titleOf = (
  request: RequestRecord,
  modelName: (model: string) => string,
) => {
  const model = request.model === "" ? null : modelName(request.model);
  if (conversations.has(request.operation) && request.outcome === "ok") {
    return model === null ? "An answer" : `An answer from ${model}`;
  }
  const words = conversations.has(request.operation)
    ? undefined
    : operationWords[request.operation];
  if (words === undefined) {
    return model === null ? "A request" : `A request to ${model}`;
  }
  return model === null || request.operation === "models"
    ? words
    : `${words} for ${model}`;
};

/** How a request ended, as its badge says it. */
export const outcomeText = (request: RequestRecord) => {
  const status = request.upstreamStatus > 0 ? ` ${request.upstreamStatus}` : "";
  switch (request.outcome) {
    case "ok":
      return "OK";
    case "error":
      return `Error${status}`;
    case "refused":
      return `Refused${status}`;
    case "cancelled":
      return "Cancelled";
  }
};

const startedFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** A moment to the second, its day always written: `Nov 15, 2026, 14:05:12`. */
export const toTheSecond = (at: number) => startedFormat.format(at);
