import { BunRuntime } from "@effect/platform-bun";
import {
  Cause,
  Console,
  Effect,
  Exit,
  HashMap,
  Layer,
  Option,
  type Runtime,
} from "effect";
import { HttpServer } from "effect/http";
import * as HubConfig from "#config/config.ts";
import { RecorderUnavailable } from "#modules/recording/04-infrastructure/file-system-recording-directory.ts";
import * as Recording from "#modules/recording/module.ts";
import * as FileSystemArchiveDirectory from "#modules/request-log/04-infrastructure/archive/file-system-archive-directory.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";
import * as Hub from "./hub.ts";

const announce = (config: HubConfig.HubConfig) =>
  Layer.effectDiscard(
    HttpServer.addressFormattedWith((address) => {
      const pools = [...HashMap.values(config.pools)]
        .map((pool) =>
          pool.kind === "observed"
            ? `${pool.id} (observed)`
            : `${pool.id} (${pool.protocol})`,
        )
        .sort()
        .join(", ");
      return Effect.logInfo(
        `cota hub listening on ${address}, with pools ${pools || "none"}`,
      );
    }),
  );

const main = Effect.gen(function* () {
  const { file, text } = yield* HubConfig.read();
  const config = yield* HubConfig.parse(file, text);
  if (Option.isSome(config.archive)) {
    yield* FileSystemArchiveDirectory.check(config.archive.value.directory);
  }
  return yield* Layer.launch(
    announce(config).pipe(
      Layer.provideMerge(Hub.layer(config)),
      Layer.provide(Recording.fromEnvironment),
      Layer.provide(RequestLog.layer(config)),
      Layer.provide(
        HubStore.layer({ path: config.store.path, steps: Hub.storeSteps }),
      ),
    ),
  );
});

// A signal stops the hub as it is meant to stop, so it exits 0, not 130.
const teardown: Runtime.Teardown = (exit, onExit) =>
  onExit(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1);

const reported = (cause: Cause.Cause<unknown>) => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void;
  const error = Cause.findErrorOption(cause);
  return Console.error(
    Option.isSome(error) &&
      (error.value instanceof HubConfig.ConfigInvalid ||
        error.value instanceof RecorderUnavailable ||
        error.value instanceof HubStore.HubStoreRefused ||
        error.value instanceof
          FileSystemArchiveDirectory.ArchiveDirectoryRefused)
      ? error.value.message
      : Cause.pretty(cause),
  );
};

BunRuntime.runMain(main.pipe(Effect.tapCause(reported)), {
  disableErrorReporting: true,
  teardown,
});
