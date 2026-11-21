import { Context, Effect, Layer, Option, type Schema } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import {
  type RequestRole,
  rolesOf,
} from "#modules/request-log/03-domain/request-role.ts";
import * as Segment from "#modules/request-log/03-domain/segment.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

export interface Inspected extends Session.RequestRecord {
  /** None for a traffic request older than its session's latest 10,000, which the role rules do not read. */
  readonly requestRole: Option.Option<RequestRole>;
  readonly segment: Option.Option<number>;
  /** Its body without its conversation's parts; none without a conversation. */
  readonly params: Option.Option<Schema.JsonObject>;
  /** Its tool definitions; none without a conversation. */
  readonly tools: Option.Option<ReadonlyArray<Transcript.Tool>>;
  /** Its conversation's system, input and output parts rendered; none without a conversation. */
  readonly entries: Option.Option<ReadonlyArray<Transcript.Entry>>;
  readonly followedBy: Option.Option<Request.RequestId>;
}

export class InspectRequest extends Context.Service<
  InspectRequest,
  {
    /** One request, whatever its operation, with its role in its session and its conversation rendered; none when there is no such request. */
    readonly execute: (
      id: Request.RequestId,
    ) => Effect.Effect<Option.Option<Inspected>, RequestLogUnavailable>;
  }
>()("@cota/hub/request-log/InspectRequest") {}

export const layer: Layer.Layer<
  InspectRequest,
  never,
  RequestLogReader | Transcripts
> = Layer.effect(
  InspectRequest,
  Effect.gen(function* () {
    const reader = yield* RequestLogReader;
    const transcripts = yield* Transcripts;
    return InspectRequest.of({
      execute: Effect.fn("InspectRequest.execute")(function* (
        id: Request.RequestId,
      ) {
        const found = yield* reader.request(id);
        if (Option.isNone(found)) return Option.none<Inspected>();
        const { record, params, followedBy } = found.value;
        const { session, protocol } = record.request;
        const roled = rolesOf(
          (yield* reader.sessionRequests(
            [session],
            Session.read,
            Session.mostListedRequests,
          )).get(session) ?? [],
        );
        const segment = Segment.segmentsOf(roled).find(({ requests }) =>
          requests.some((request) => request.id === id),
        );
        const parts = Option.isSome(params)
          ? (yield* reader.items([
              {
                session,
                id,
                parts: ["system", "tools", "input", "output"],
              },
            ])).get(id)
          : undefined;
        const read = roled.find(({ request }) => request.id === id);
        return Option.some({
          ...record,
          requestRole:
            read !== undefined
              ? Option.some(read.requestRole)
              : Traffic.isTraffic(record.request)
                ? Option.none()
                : Option.some<RequestRole>("utility"),
          segment: Option.map(
            Option.fromUndefinedOr(segment),
            ({ index }) => index,
          ),
          params,
          tools: Option.map(params, () =>
            transcripts.toolsOf(protocol, parts?.tools ?? []),
          ),
          entries: Option.map(params, () =>
            transcripts.entriesOf(
              protocol,
              {
                system: parts?.system ?? [],
                input: parts?.input ?? [],
                output: parts?.output ?? [],
              },
              Transcript.longest.inspector,
            ),
          ),
          followedBy,
        });
      }),
    });
  }),
);
