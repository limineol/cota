import { Context, Effect, Layer } from "effect";

export interface Seen {
  readonly method: string;
  readonly target: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: Uint8Array;
  readonly signal: AbortSignal;
}

export interface Script {
  readonly status?: number;
  readonly headers?: ReadonlyArray<readonly [string, string]>;
  readonly chunks?: ReadonlyArray<Uint8Array | string>;
  readonly headersAfterMs?: number | "never";
  readonly chunkEveryMs?: number;
  readonly afterwards?: "close" | "hold" | "fail";
}

export class FakeProvider extends Context.Service<
  FakeProvider,
  {
    readonly url: string;
    readonly answer: (script: Script | ((seen: Seen) => Script)) => void;
    readonly seen: () => ReadonlyArray<Seen>;
    readonly last: () => Seen;
    readonly forget: () => void;
  }
>()("@cota/hub/FakeProvider") {}

const encoder = new TextEncoder();

const bytesOf = (chunk: Uint8Array | string): Uint8Array<ArrayBuffer> =>
  typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk);

const untilAborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

const bodyOf = (
  script: Script,
  signal: AbortSignal,
): ReadableStream<Uint8Array> | null => {
  const chunks = script.chunks;
  if (chunks === undefined) return null;
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (script.chunkEveryMs !== undefined)
        await Bun.sleep(script.chunkEveryMs);
      const chunk = chunks[index];
      index++;
      if (chunk !== undefined) return controller.enqueue(bytesOf(chunk));
      switch (script.afterwards ?? "close") {
        case "close":
          return controller.close();
        case "fail":
          return controller.error(new Error("the provider fell over"));
        case "hold":
          await untilAborted(signal);
          return controller.close();
      }
    },
  });
};

export const layer: Layer.Layer<FakeProvider> = Layer.effect(
  FakeProvider,
  Effect.gen(function* () {
    const seen: Array<Seen> = [];
    let answer: (seen: Seen) => Script = () => ({ chunks: ["{}"] });

    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 0,
          async fetch(request) {
            const origin = new URL(request.url).origin;
            const one: Seen = {
              method: request.method,
              target: request.url.slice(origin.length),
              headers: [...request.headers],
              body: new Uint8Array(await request.arrayBuffer()),
              signal: request.signal,
            };
            seen.push(one);
            const script = answer(one);
            if (script.headersAfterMs === "never") {
              await untilAborted(request.signal);
            } else if (script.headersAfterMs !== undefined) {
              await Bun.sleep(script.headersAfterMs);
            }
            return new Response(bodyOf(script, request.signal), {
              status: script.status ?? 200,
              headers: (script.headers ?? []).map(([name, value]) => [
                name,
                value,
              ]),
            });
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    );

    return FakeProvider.of({
      url: `http://127.0.0.1:${server.port}`,
      answer: (script) => {
        answer = typeof script === "function" ? script : () => script;
      },
      seen: () => seen,
      last: () => {
        const one = seen.at(-1);
        if (one === undefined) throw new Error("the provider saw no request");
        return one;
      },
      forget: () => {
        seen.length = 0;
      },
    });
  }),
);
