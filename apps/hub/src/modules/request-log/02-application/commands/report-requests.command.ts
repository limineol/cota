import {
  Context,
  DateTime,
  Effect,
  HashMap,
  Layer,
  Option,
  Semaphore,
} from "effect";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import { ReportedThrough } from "#modules/request-log/02-application/interfaces/reported-through.ts";
import {
  type PricedRequest,
  RequestsRepository,
  type RequestsRepositoryDeclined,
  type RequestsRepositoryFailed,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as Cost from "#modules/request-log/03-domain/cost.ts";
import * as Report from "#modules/request-log/03-domain/report.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type { RecordForm } from "#shared/03-domain/record-form.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";

/** How many of a report's calls were stored, and how many the log already held. */
export interface Answer {
  readonly stored: number;
  readonly held: number;
}

export type Refusal =
  | Report.NoSuchPool
  | Report.PoolNotObserved
  | Report.ReportRefused
  | Report.ReportOutOfOrder;

export class ReportRequests extends Context.Service<
  ReportRequests,
  {
    /**
     * Checks a report, and stores what the log does not already hold of it
     * before it answers (`docs/specs/reported-requests/spec.md`, Storing),
     * one report at a time. A refusal stores nothing; a failure of the log
     * or the hub store may have stored part of it, which the report sent
     * again finds held.
     */
    readonly execute: (
      report: Report.Report,
      caller: Report.Caller,
    ) => Effect.Effect<
      Answer,
      Refusal | RequestLogUnavailable | HubStoreUnavailable
    >;
  }
>()("@cota/hub/request-log/ReportRequests") {}

const unavailable = (
  error: RequestsRepositoryFailed | RequestsRepositoryDeclined,
) =>
  error._tag === "RequestsRepositoryDeclined"
    ? new RequestLogUnavailable({ reason: "failed", code: error.code })
    : new RequestLogUnavailable({ reason: "unreachable", code: "" });

const tokenOf = (ids: ReadonlyArray<Request.RequestId>): string =>
  new Bun.CryptoHasher("sha256")
    .update(ids.join(","))
    .digest("hex")
    .slice(0, 32);

const millis = DateTime.toEpochMillis;

export const layer = (
  pools: HashMap.HashMap<PoolId, Pool.Pool>,
): Layer.Layer<
  ReportRequests,
  never,
  RequestsRepository | Prices | ReportedThrough
> =>
  Layer.effect(
    ReportRequests,
    Effect.gen(function* () {
      const repository = yield* RequestsRepository;
      const prices = yield* Prices;
      const reportedThrough = yield* ReportedThrough;
      const lock = yield* Semaphore.make(1);

      const observedOf = Effect.fn("ReportRequests.observedOf")(function* (
        id: PoolId,
      ) {
        const pool = HashMap.get(pools, id);
        if (Option.isNone(pool)) {
          return yield* new Report.NoSuchPool({ pool: id });
        }
        if (pool.value.kind !== "observed") {
          return yield* new Report.PoolNotObserved({ pool: id });
        }
        return pool.value;
      });

      /** The call before of each call whose call before is not earlier in the report, as the log holds it in the call's session. */
      const beforesFromLog = Effect.fn("ReportRequests.beforesFromLog")(
        function* (checked: Report.CheckedReport, reporter: Report.Reporter) {
          const found = new Map<number, Report.Before>();
          const earlier = new Set<string>();
          for (const each of checked.calls) {
            const { call } = each;
            if (
              Option.isSome(call.after) &&
              !earlier.has(call.after.value.call)
            ) {
              const after = call.after.value;
              const id = Report.idOf(
                reporter,
                checked.report.client,
                after.call,
                after.startedAt,
              );
              const parts = yield* repository.partsOf(
                id,
                call.session.toWellFormed(),
                after.startedAt,
              );
              if (Option.isSome(parts)) {
                const lastIdx = Report.lastIdxOf(parts.value.output);
                if (Option.isSome(lastIdx)) {
                  found.set(each.place, {
                    id,
                    input: parts.value.requestItems.input,
                    output: parts.value.requestItems.output,
                    lastIdx: lastIdx.value,
                  });
                }
              }
            }
            earlier.add(call.call);
          }
          return found;
        },
      );

      const pricedOf = Effect.fn("ReportRequests.pricedOf")(function* (
        request: Request.Request,
        form: RecordForm,
      ) {
        const cost = yield* Option.match(request.usage, {
          onNone: () => Effect.succeedNone,
          onSome: (usage) =>
            Cost.of(
              usage.tokens,
              prices.of({
                pool: request.pool,
                model: request.model,
                protocol: form,
                servedModel: "",
                serviceTier: "",
              }),
            ),
        });
        return { request, cost } satisfies PricedRequest;
      });

      const store = Effect.fn("ReportRequests.store")(function* (
        checked: Report.CheckedReport,
        pool: Pick<Pool.Pool, "id" | "provider">,
        reporter: Report.Reporter,
      ) {
        const fromLog = yield* beforesFromLog(checked, reporter);
        const built = yield* Report.builtAll(checked, pool, reporter, (each) =>
          Option.fromUndefinedOr(fromLog.get(each.place)),
        );
        if (built.length === 0) return { stored: 0, held: 0 };
        const starts = built.map(({ request }) => millis(request.startedAt));
        const held = yield* repository.held({
          requests: built.map(({ request }) => ({
            id: request.id,
            session: request.session,
          })),
          from: DateTime.makeUnsafe(Math.min(...starts)),
          to: DateTime.makeUnsafe(Math.max(...starts)),
        });
        const sessions = [
          ...new Set(built.map(({ request }) => request.session)),
        ];
        const known = new Set(
          (yield* repository.known(sessions)).map(({ session, digest }) =>
            JSON.stringify([session, digest]),
          ),
        );
        const form = Report.formOf[checked.report.client];
        const requests: Array<PricedRequest> = [];
        for (const each of built) {
          if (held.requests.has(each.request.id)) continue;
          const one = yield* pricedOf(each.request, form);
          if (!repository.holds(one)) {
            return yield* new Report.ReportRefused({
              detail: `${Report.nameOf(each.place, each.call)} has a value the request log cannot hold.`,
            });
          }
          requests.push(one);
        }
        const items: Array<StoredItems.StoredItem> = [];
        for (const item of built.flatMap((each) => each.items)) {
          const key = JSON.stringify([item.session, item.digest]);
          if (known.has(key)) continue;
          known.add(key);
          items.push(item);
        }
        const requestItems = built
          .filter(({ request }) => !held.requestItems.has(request.id))
          .map(({ requestItems }) => requestItems);
        if (items.length + requestItems.length + requests.length > 0) {
          yield* repository.store(
            { items, requestItems, requests },
            tokenOf(built.map(({ request }) => request.id)),
          );
        }
        return {
          stored: requests.length,
          held: built.length - requests.length,
        };
      });

      return ReportRequests.of({
        execute: Effect.fn("ReportRequests.execute")(function* (
          report: Report.Report,
          caller: Report.Caller,
        ) {
          const pool = yield* observedOf(report.pool);
          const checked = yield* Report.check(report, caller);
          return yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const answer = yield* store(checked, pool, caller.reporter).pipe(
                Effect.catchTags({
                  RequestsRepositoryFailed: (error) =>
                    Effect.fail(unavailable(error)),
                  RequestsRepositoryDeclined: (error) =>
                    Effect.fail(unavailable(error)),
                }),
              );
              if (Option.isSome(report.through)) {
                yield* reportedThrough.keep({
                  machine: checked.machine,
                  client: report.client,
                  pool: pool.id,
                  through: report.through.value,
                  reportedAt: yield* DateTime.now,
                  reportedBy: Report.reportedByText(caller.reporter),
                });
              }
              return answer;
            }),
          );
        }),
      });
    }),
  );
