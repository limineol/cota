import {
  Context,
  DateTime,
  Effect,
  HashMap,
  Layer,
  Option,
  Schema,
  type Scope,
} from "effect";
import * as Copy from "#lib/copy.ts";
import {
  AdmitRequest,
  type Rejection,
} from "#modules/admission/02-application/queries/admit-request.query.ts";
import * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as Provider from "#modules/relay/02-application/interfaces/provider.ts";
import * as PlanCredential from "#modules/relay/02-application/queries/plan-credential.query.ts";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import type * as Credential from "#modules/relay/03-domain/credential.ts";
import type * as FinishedRequest from "#modules/relay/03-domain/finished-request.ts";
import type { Limits } from "#modules/relay/03-domain/limits.ts";
import type { Method } from "#modules/relay/03-domain/method.ts";
import { bearerOf } from "#shared/03-domain/bearer-token.ts";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import * as Request from "#shared/03-domain/request.entity.ts";

/**
 * A client's request as it arrived: the pool it names, the path and query
 * under it, its method when the hub relays it, its headers, and its body,
 * which is read only when it runs and is none when it is over the limit.
 */
export interface Incoming<E> {
  readonly pool: PoolId;
  readonly path: string;
  readonly query: string;
  readonly method: Option.Option<Method>;
  readonly headers: ClientRequest.Headers;
  readonly body: Effect.Effect<Option.Option<Uint8Array>, E>;
}

export type Handled =
  | { readonly _tag: "Rejected"; readonly reason: Rejection }
  | {
      readonly _tag: "UnknownPath";
      readonly protocol: ProtocolName;
      readonly clientPrefix: string;
    }
  | { readonly _tag: "UnknownMethod" }
  | { readonly _tag: "BodyTooLarge" }
  | { readonly _tag: "Forwarded"; readonly answer: Provider.Answer };

export class ForwardRequest extends Context.Service<
  ForwardRequest,
  {
    /**
     * Admits a request before its body is read, then forwards it to its
     * pool's provider with the credential its pool's kind chooses, and once
     * more to the fallback pool when its refusal diverts it.
     */
    readonly execute: <E>(
      incoming: Incoming<E>,
    ) => Effect.Effect<Handled, E, Scope.Scope>;
  }
>()("@cota/hub/relay/ForwardRequest") {}

const servesPath = (prefix: string, path: string): boolean =>
  prefix === "" || path === prefix || path.startsWith(`${prefix}/`);

const jsonOf = (bytes: Uint8Array): Option.Option<unknown> =>
  Schema.decodeOption(Schema.fromJsonString(Schema.Unknown))(
    new TextDecoder().decode(bytes),
  );

export interface Options {
  readonly pools: HashMap.HashMap<PoolId, Pool.Pool>;
  readonly limits: Limits;
}

export const layer = (
  options: Options,
): Layer.Layer<
  ForwardRequest,
  never,
  | AdmitRequest
  | Protocol.Protocols
  | Provider.Provider
  | PlanCredential.PlanCredential
> =>
  Layer.effect(
    ForwardRequest,
    Effect.gen(function* () {
      const admitRequest = yield* AdmitRequest;
      const protocols = yield* Protocol.Protocols;
      const provider = yield* Provider.Provider;
      const planCredential = yield* PlanCredential.PlanCredential;
      const limits = options.limits;

      const execute = Effect.fn("ForwardRequest.execute")(function* <E>(
        incoming: Incoming<E>,
      ): Effect.fn.Return<Handled, E, Scope.Scope> {
        const startedAt = yield* DateTime.now;
        const { headers } = incoming;
        const decision = yield* admitRequest.execute({
          pool: incoming.pool,
          cotaKey: headers["x-cota-key"],
          bearer: bearerOf(headers.authorization),
          apiKey: headers["x-api-key"],
        });
        if (decision._tag === "Rejected") {
          yield* Effect.logInfo("request rejected", {
            reason: decision.reason,
            pool: incoming.pool,
          });
          return { _tag: "Rejected", reason: decision.reason };
        }

        const configured = HashMap.get(options.pools, incoming.pool);
        if (Option.isNone(configured)) {
          return { _tag: "Rejected", reason: "UnknownPool" };
        }
        const pool = configured.value;
        const protocol = protocols.of(pool.protocol);

        const prefix = protocol.clientPrefix;
        if (!servesPath(prefix, incoming.path)) {
          return {
            _tag: "UnknownPath",
            protocol: protocol.name,
            clientPrefix: prefix,
          };
        }
        if (Option.isNone(incoming.method)) return { _tag: "UnknownMethod" };
        const method = incoming.method.value;

        const body = yield* incoming.body;
        if (Option.isNone(body)) return { _tag: "BodyTooLarge" };

        const path = incoming.path.slice(prefix.length);
        const decoded = yield* Copy.decodedBody(
          body.value,
          headers["content-encoding"],
          limits.maxDecodedBodyBytes,
        ).pipe(Effect.option);
        const described: ClientRequest.ClientRequest = {
          method,
          path,
          headers,
          body: Option.flatMap(decoded, jsonOf),
        };
        const description = protocol.describe(described);
        const loginFingerprint =
          pool.kind === "subscription"
            ? protocol.fingerprint(described)
            : Option.none();
        const conversationRules = protocol.conversation(description);

        const exchange = Effect.fn("ForwardRequest.exchange")(function* (
          chosen: Credential.Plan,
          follows: Option.Option<Request.RequestId>,
        ) {
          const at = Option.isSome(follows) ? yield* DateTime.now : startedAt;
          const id = Request.RequestId.make(
            Bun.randomUUIDv7("hex", DateTime.toEpochMillis(at)),
          );
          const start: FinishedRequest.Start = {
            id,
            startedAt: at,
            pool: chosen.pool,
            protocol: protocol.name,
            hubKey: decision.hubKey,
            description,
            conversationRules,
            headers,
            target: `${incoming.path}${incoming.query}`,
            body: described.body,
            decodedBody: decoded,
            requestBytes: body.value.byteLength,
            loginFingerprint,
            divertedFrom: chosen.divertedFrom,
            follows,
          };
          const result = yield* provider
            .exchange(
              start,
              protocol,
              {
                method,
                url: `${chosen.pool.baseUrl}${path}${incoming.query}`,
                credential: chosen.credential,
                body: body.value,
              },
              chosen.onRefusal,
            )
            .pipe(
              Effect.annotateLogs({
                request: id,
                pool: chosen.pool.id,
                operation: description.operation,
              }),
            );
          return { id, result };
        });

        const first = yield* exchange(
          yield* planCredential.execute(
            pool,
            protocol,
            loginFingerprint,
            description.model,
          ),
          Option.none(),
        );
        if (first.result._tag !== "Diverted") {
          return { _tag: "Forwarded", answer: first.result };
        }
        const second = yield* exchange(
          first.result.plan,
          Option.some(first.id),
        );
        if (second.result._tag !== "Diverted") {
          return { _tag: "Forwarded", answer: second.result };
        }
        return yield* Effect.die("a diverted request was diverted again");
      });

      return ForwardRequest.of({ execute });
    }),
  );
