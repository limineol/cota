import { Option } from "effect";
import type { Roled } from "./request-role.ts";
import type { SessionRequest } from "./session.ts";

/**
 * Why a segment began: the session's start, or a prompt under half the
 * previous one's. No client's own compaction is recorded yet
 * (`docs/specs/sessions/spec.md`, Segments), so none begins a segment.
 */
export type StartedBy = "start" | "size";

export interface Segment {
  readonly index: number;
  readonly startedBy: StartedBy;
  /** Its main requests, in order; never empty. */
  readonly requests: ReadonlyArray<SessionRequest>;
  /** The request its transcript is read from: its last `ok` request, else its last request (T7). */
  readonly tip: SessionRequest;
}

interface Open {
  readonly startedBy: StartedBy;
  readonly requests: Array<SessionRequest>;
  /** The prompt size of its latest `ok` request that has one. */
  sized: Option.Option<number>;
}

/** Its last `ok` request, else its last request. */
const tipOf = (requests: ReadonlyArray<SessionRequest>): SessionRequest =>
  requests.reduce((tip, request) =>
    request.outcome === "ok" || tip.outcome !== "ok" ? request : tip,
  );

/** Under half: `2 × size(r) < size(p)`. */
const dropsUnderHalf = (size: number, previous: number): boolean =>
  2 * size < previous;

/**
 * Cuts a session's main requests, in order, into segments
 * (`docs/specs/sessions/spec.md`, Segments): a new one begins at an `ok`
 * request whose prompt size is under half that of the latest `ok` request
 * with a prompt size in the current one (T4 to T7).
 */
export const segmentsOf = (
  roled: ReadonlyArray<Roled>,
): ReadonlyArray<Segment> => {
  const open: Array<Open> = [];
  for (const { request, requestRole } of roled) {
    if (requestRole !== "main") continue;
    const current = open[open.length - 1];
    const size =
      request.outcome === "ok" ? request.promptSize : Option.none<number>();
    const cuts =
      current !== undefined &&
      Option.isSome(size) &&
      Option.isSome(current.sized) &&
      dropsUnderHalf(size.value, current.sized.value);
    if (current === undefined || cuts) {
      open.push({
        startedBy: current === undefined ? "start" : "size",
        requests: [request],
        sized: size,
      });
      continue;
    }
    current.requests.push(request);
    if (Option.isSome(size)) current.sized = size;
  }
  return open.map(({ startedBy, requests }, index) => ({
    index,
    startedBy,
    requests,
    tip: tipOf(requests),
  }));
};
