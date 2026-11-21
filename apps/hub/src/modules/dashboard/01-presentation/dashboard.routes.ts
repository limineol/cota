import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpStaticServer,
} from "effect/http";

export interface Options {
  /** The folder of the built dashboard: `apps/web/dist` unless the configuration names another. */
  readonly directory: string;
}

/** The folder of the build whose files carry a hash of their content in their names. */
const hashed = "/assets/";

const cachedForAYear = "public, max-age=31536000, immutable";
const neverCached = "no-cache";

/** The first segments of the paths the hub answers itself: the API, the relay and `/health`. */
const hubPaths: ReadonlyArray<string> = ["api", "pools", "health"];

const rawPathOf = (url: string): string => {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
};

const decoded = (path: string): string | undefined => {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
};

const isTheHubs = (path: string): boolean => {
  const first = path.split("/").find((segment) => segment !== "");
  return first !== undefined && hubPaths.includes(first);
};

const notFound = (request: HttpServerRequest.HttpServerRequest) =>
  new HttpServerError.HttpServerError({
    reason: new HttpServerError.RouteNotFound({ request }),
  });

const isNotFound = (error: HttpServerError.HttpServerError): boolean =>
  error.reason._tag === "RouteNotFound";

const withUrl = (url: string) =>
  Effect.updateService(HttpServerRequest.HttpServerRequest, (request) =>
    request.modify({ url }),
  );

/**
 * The dashboard's built files, for every `GET` and `HEAD` the hub does not
 * answer otherwise; nothing when the folder holds no `index.html`.
 */
export const layer = (options: Options) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const index = join(options.directory, "index.html");
      const built = yield* Effect.promise(() =>
        stat(index).then(
          (info) => info.isFile(),
          () => false,
        ),
      );
      if (!built) {
        yield* Effect.logInfo(
          `the dashboard is not built: ${index} does not exist; bun run web:build builds it`,
        );
        return Layer.empty;
      }

      const pages = yield* HttpStaticServer.make({
        root: options.directory,
        cacheControl: neverCached,
      });
      const assets = yield* HttpStaticServer.make({
        root: join(options.directory, hashed),
        index: undefined,
        cacheControl: cachedForAYear,
      });

      const files = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const raw = rawPathOf(request.url);
        const wanted = decoded(raw);
        if (wanted === undefined || isTheHubs(wanted)) {
          return yield* notFound(request);
        }
        if (raw.startsWith(hashed)) {
          return yield* assets.pipe(
            withUrl(request.url.slice(hashed.length - 1)),
          );
        }
        // HttpStaticServer's own fallback (`spa`) answers the index only to a
        // request that accepts HTML, and redirects a folder by the request's
        // original URL, so the index is asked for here, by its name.
        return yield* pages.pipe(
          Effect.catchIf(
            (error) => isNotFound(error) && extname(wanted) === "",
            () => pages.pipe(withUrl("/index.html")),
          ),
        );
      }).pipe(Effect.withSpan("DashboardRoutes.files"));

      return HttpRouter.add("GET", "/*", files);
    }),
  );
