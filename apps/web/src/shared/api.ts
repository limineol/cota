import { Api } from "@cota/hub/api";
import {
  keepPreviousData,
  type QueryClient,
  type QueryKey,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Effect, type Layer, Predicate } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { createContext, use } from "react";

export type Client = HttpApiClient.ForApi<typeof Api>;

/** One call of the API's client, as a screen asks for it. */
export type Call<A, E> = (client: Client) => Effect.Effect<A, E>;

/** Runs one call over an `HttpClient`, resolving with its decoded answer or rejecting with its typed failure. */
export type Caller = <A, E>(
  call: Call<A, E>,
  signal?: AbortSignal,
) => Promise<A>;

export const callerOver =
  (http: Layer.Layer<HttpClient.HttpClient>): Caller =>
  (call, signal) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(Api);
        return yield* call(client);
      }).pipe(Effect.provide(http)),
      signal === undefined ? undefined : { signal },
    );

/* The dashboard is served from the hub's own origin, so `fetch`'s default
   credentials ("same-origin") already send the sign-in's cookie. */
export const ApiCaller = createContext<Caller>(
  callerOver(FetchHttpClient.layer),
);

/** Whether a call failed because nobody, or no longer anybody, is signed in. */
export const isSignInRequired = (error: unknown): boolean =>
  Predicate.isTagged(error, "SignInRequired");

/**
 * A TanStack query of one call, keyed by the endpoint and its parameters, or
 * of nothing yet when the call is `null`. With `keepPrevious`, the answer to
 * the last key stays while a new key is read, marked as placeholder data.
 */
export const useApiQuery = <A, E>(
  key: QueryKey,
  call: Call<A, E> | null,
  options: {
    readonly refetchInterval?: number;
    readonly keepPrevious?: boolean;
    readonly enabled?: boolean;
  } = {},
) => {
  const caller = use(ApiCaller);
  return useQuery({
    queryKey: key,
    queryFn: call === null ? skipToken : ({ signal }) => caller(call, signal),
    ...(options.refetchInterval === undefined
      ? {}
      : {
          refetchInterval: options.refetchInterval,
          staleTime: options.refetchInterval,
        }),
    ...(options.keepPrevious === true
      ? { placeholderData: keepPreviousData }
      : {}),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
};

/** A TanStack mutation of one call; the mutation is done once `onSuccess` is. */
export const useApiMutation = <V, A, E>(
  call: (variables: V) => Call<A, E>,
  onSuccess: (answer: A, queries: QueryClient) => Promise<unknown>,
) => {
  const caller = use(ApiCaller);
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => caller(call(variables)),
    onSuccess: (answer: A) => onSuccess(answer, queries),
  });
};
