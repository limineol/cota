import { describe, expect, it } from "vitest";
import { runGate } from "./fixture.ts";

const workspace = {
  "package.json": JSON.stringify({ workspaces: ["apps/*", "proofs"] }),
  "apps/hub/package.json": JSON.stringify({
    name: "@cota/hub",
    exports: { "./fallback": "./src/modules/relay/03-domain/fallback.ts" },
  }),
  "proofs/package.json": JSON.stringify({ name: "@cota/proofs" }),
};

const hub = (files: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, content]) => [
      `apps/hub/src/${path}`,
      content,
    ]),
  );

const inProcess =
  "the domain imports from Effect only modules that stay inside the process: Schema, Option, Result, DateTime, Duration, HashMap, HashSet, Array, Order, Equal, Data, Match, Predicate, Function, Effect, Context, Layer, Ref, Clock, Redacted, Fiber (ADR-0003)";

describe("boundaries", () => {
  it("passes a tree that keeps every rule", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "modules/relay/03-domain/fallback.ts":
          'import { DateTime, Effect, Layer, Schema } from "effect";\nimport { PoolId } from "#shared/03-domain/ids.ts";\nimport * as Client from "#shared/03-domain/client.ts";\n',
        "modules/relay/03-domain/fallback.test.ts":
          'import { expect, it } from "@effect/vitest";\nimport { Arbitrary } from "effect";\nimport { TestClock } from "effect/testing";\nimport * as Hub from "#hub.ts";\nimport * as Fake from "#modules/relay/05-tests/fake.ts";\nimport * as Fallback from "./fallback.ts";\n',
        "modules/relay/01-presentation/relay.routes.ts":
          'import * as AdmitRequest from "#modules/admission/02-application/queries/admit-request.query.ts";\nimport * as ForwardRequest from "#modules/relay/02-application/commands/forward-request.command.ts";\nimport * as Fallback from "#modules/relay/03-domain/fallback.ts";\nimport * as HubError from "./hub-error.ts";\n',
        "modules/relay/01-presentation/hub-error.ts":
          'import { Schema } from "effect";\n',
        "modules/relay/02-application/commands/forward-request.command.ts":
          'import * as Provider from "#modules/relay/02-application/interfaces/provider.ts";\nimport * as Fallback from "#modules/relay/03-domain/fallback.ts";\nimport * as Shutdown from "#shared/04-infrastructure/shutdown.ts";\n',
        "modules/relay/02-application/interfaces/provider.ts":
          'import type * as Fallback from "#modules/relay/03-domain/fallback.ts";\n',
        "modules/relay/04-infrastructure/provider/http-provider.ts":
          'import { HttpClient } from "effect/http";\nimport * as Copy from "#lib/copy.ts";\nimport * as RecordExchange from "#modules/recording/02-application/commands/record-exchange.command.ts";\nimport * as Provider from "#modules/relay/02-application/interfaces/provider.ts";\nimport type * as Fallback from "#modules/relay/03-domain/fallback.ts";\nimport * as Headers from "./headers.ts";\n',
        "modules/relay/04-infrastructure/provider/headers.ts": "",
        "modules/relay/05-tests/fake.ts":
          'import * as HttpProvider from "#modules/relay/04-infrastructure/provider/http-provider.ts";\nimport * as Harness from "#shared/05-tests/harness.ts";\n',
        "modules/relay/module.ts":
          'import * as Config from "#config/config.ts";\nimport * as HttpProvider from "#modules/relay/04-infrastructure/provider/http-provider.ts";\nimport { Api } from "#api.ts";\n',
        "modules/relay/01-presentation/relay.api.ts":
          'import { HttpApiGroup } from "effect/http-api";\nimport { CallerMiddleware } from "#shared/01-presentation/caller.middleware.ts";\nimport * as Fallback from "#modules/relay/03-domain/fallback.ts";\n',
        "shared/01-presentation/caller.middleware.ts":
          'import { HttpApiMiddleware } from "effect/http-api";\nimport type { Caller } from "#shared/03-domain/client.ts";\n',
        "api.ts":
          'import { HttpApi } from "effect/http-api";\nimport * as RelayApi from "#modules/relay/01-presentation/relay.api.ts";\nimport { CallerMiddleware } from "#shared/01-presentation/caller.middleware.ts";\n',
        "modules/admission/02-application/queries/admit-request.query.ts": "",
        "modules/recording/02-application/commands/record-exchange.command.ts":
          'import type * as Tee from "#lib/tee.ts";\nimport * as Scrubber from "#modules/recording/03-domain/scrubber/scrubber.ts";\n',
        "modules/recording/03-domain/scrubber/scrubber.ts":
          'import * as Client from "#shared/03-domain/client.ts";\n',
        "shared/03-domain/ids.ts": 'import { Schema } from "effect";\n',
        "shared/03-domain/client.ts": "",
        "shared/04-infrastructure/shutdown.ts":
          'import { Effect } from "effect";\nimport * as Copy from "#lib/copy.ts";\nimport type { PoolId } from "#shared/03-domain/ids.ts";\n',
        "shared/05-tests/harness.ts":
          'import * as Hub from "#hub.ts";\nimport * as Relay from "#modules/relay/module.ts";\nimport * as Provider from "#modules/relay/02-application/interfaces/provider.ts";\n',
        "lib/copy.ts":
          'import { Stream } from "effect";\nimport type * as Tee from "./tee.ts";\n',
        "lib/tee.ts": 'import type * as Copy from "#lib/copy.ts";\n',
        "config/config.ts":
          'import * as Fallback from "#modules/relay/03-domain/fallback.ts";\nimport * as Copy from "#lib/copy.ts";\n',
        "hub.ts":
          'import * as Config from "#config/config.ts";\nimport * as Provider from "#modules/relay/02-application/interfaces/provider.ts";\nimport * as Relay from "#modules/relay/module.ts";\nimport { Api } from "#api.ts";\n',
        "main.ts":
          'import * as Config from "#config/config.ts";\nimport * as Hub from "./hub.ts";\n',
      }),
      "proofs/fallback/agreement.test.ts":
        'import * as Fallback from "@cota/hub/fallback";\n',
    });

    expect(gate).toMatchObject({
      exitCode: 0,
      stdout: "boundaries: 26 files, no crossings\n",
    });
  });

  it("reports a domain file that imports from Effect what reaches outside the process, or a test library outside a test", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      "apps/hub/src/modules/relay/03-domain/fallback.ts":
        'import { Arbitrary, Effect, FileSystem } from "effect";\nimport { HttpClient } from "effect/http";\nimport { it } from "@effect/vitest";\n',
      "apps/hub/src/shared/03-domain/ids.ts":
        'import * as Effect from "effect";\n',
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/hub/src/modules/relay/03-domain/fallback.ts: imports "@effect/vitest", and ${inProcess}`,
      `apps/hub/src/modules/relay/03-domain/fallback.ts: imports "effect/http", and ${inProcess}`,
      `apps/hub/src/modules/relay/03-domain/fallback.ts: imports Arbitrary, FileSystem from "effect", and ${inProcess}`,
      `apps/hub/src/shared/03-domain/ids.ts: imports all of "effect", and ${inProcess}`,
      "",
    ]);
  });

  it("reports an import that climbs out of its folder", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      "apps/hub/src/modules/quota/03-domain/quota.ts":
        'import { PoolId } from "../../../shared/03-domain/ids.ts";\n',
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr).toBe(
      'apps/hub/src/modules/quota/03-domain/quota.ts: imports "../../../shared/03-domain/ids.ts", which climbs out of its folder: reach a sibling folder through a # import, and another package through its exports (ADR-0002)\n',
    );
  });

  it("reports a crossing the table does not allow, an import the target does not export, and a package without a row", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      "apps/agent/package.json": JSON.stringify({ name: "@cota/agent" }),
      "apps/hub/src/modules/relay/03-domain/fallback.ts":
        'import { model } from "@cota/proofs/fallback";\n',
      "proofs/fallback/agreement.test.ts":
        'import { decide } from "@cota/hub";\n',
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      "apps/agent/package.json: @cota/agent has no row in tooling/boundaries.ts; add it before its first file (ADR-0002)",
      'apps/hub/src/modules/relay/03-domain/fallback.ts: imports "@cota/proofs/fallback", and @cota/hub may not import @cota/proofs (ADR-0002)',
      'proofs/fallback/agreement.test.ts: imports "@cota/hub", which @cota/hub does not export: import one of its concepts, ./fallback (ADR-0002)',
      "",
    ]);
  });

  it("reports the web importing of the hub anything but its API, or a package export that does not exist", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      "package.json": JSON.stringify({
        workspaces: ["apps/*", "packages/*", "proofs"],
      }),
      "apps/hub/package.json": JSON.stringify({
        name: "@cota/hub",
        exports: { "./api": "./src/api.ts", "./ids": "./src/ids.ts" },
      }),
      "packages/ui/package.json": JSON.stringify({
        name: "@cota/ui",
        exports: { "./components/*": "./src/components/*.tsx" },
      }),
      "apps/web/package.json": JSON.stringify({ name: "@cota/web" }),
      "apps/web/src/shared/api.ts":
        'import { Api } from "@cota/hub/api";\nimport { SignInId } from "@cota/hub/ids";\n',
      "apps/web/src/screens/home/home.tsx":
        'import { Button } from "@cota/ui/components/button";\nimport { cn } from "@cota/ui/lib/utils";\n',
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      'apps/web/src/screens/home/home.tsx: imports "@cota/ui/lib/utils", which @cota/ui does not export: import one of its concepts, ./components/* (ADR-0002)',
      'apps/web/src/shared/api.ts: imports "@cota/hub/ids", and @cota/web may import of @cota/hub only @cota/hub/api (ADR-0002)',
      "",
    ]);
  });

  it("reports the CLI's layers crossing, a file outside its layers, its domain leaving the process, and shipped code importing the hub's harness", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      "apps/hub/package.json": JSON.stringify({
        name: "@cota/hub",
        exports: {
          "./api": "./src/api.ts",
          "./harness": "./src/shared/05-tests/harness.ts",
        },
      }),
      "apps/cli/package.json": JSON.stringify({ name: "@cota/cli" }),
      "apps/cli/src/main.ts":
        'import * as Cota from "#01-presentation/cota.ts";\nimport * as Cli from "./cli.ts";\n',
      "apps/cli/src/cli.ts":
        'import * as Join from "#02-application/commands/join.command.ts";\n',
      "apps/cli/src/01-presentation/cota.ts":
        'import * as Join from "#02-application/commands/join.command.ts";\nimport * as Cli from "#cli.ts";\n',
      "apps/cli/src/02-application/commands/join.command.ts":
        'import * as Files from "#04-infrastructure/node-files.ts";\nimport { HttpClient } from "effect/http";\n',
      "apps/cli/src/02-application/join-rules.ts": "",
      "apps/cli/src/03-domain/paths.ts":
        'import { FileSystem, Option } from "effect";\nimport * as Fakes from "#05-tests/fakes.ts";\n',
      "apps/cli/src/04-infrastructure/http-hub.ts":
        'import { Api } from "@cota/hub/api";\nimport * as Harness from "@cota/hub/harness";\n',
      "apps/cli/src/05-tests/fakes.ts":
        'import * as Harness from "@cota/hub/harness";\nimport * as Cli from "#cli.ts";\n',
      "apps/cli/src/01-presentation/cota.contract.test.ts":
        'import * as Harness from "@cota/hub/harness";\nimport * as Cli from "#cli.ts";\n',
      "apps/cli/src/helpers.ts": "",
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      'apps/cli/src/01-presentation/cota.ts: imports "#cli.ts", which is the CLI\'s composition root: main.ts and cli.ts assemble the layers, which never import them',
      'apps/cli/src/02-application/commands/join.command.ts: imports "#04-infrastructure/node-files.ts", and in the CLI, 02-application may import only 02-application, 03-domain, not 04-infrastructure',
      "apps/cli/src/02-application/commands/join.command.ts: imports \"effect/http\", and 02-application speaks the CLI's own terms: HTTP's types stay in 01-presentation and 04-infrastructure",
      "apps/cli/src/02-application/join-rules.ts: is in 02-application but not under commands, queries or interfaces, which hold its use cases and ports: a value or rule they share goes in 03-domain, and an adapter in 04-infrastructure",
      `apps/cli/src/03-domain/paths.ts: imports "#05-tests/fakes.ts", and in the CLI, 03-domain may import only 03-domain, not 05-tests, which only tests import`,
      `apps/cli/src/03-domain/paths.ts: imports FileSystem from "effect", and ${inProcess}`,
      'apps/cli/src/04-infrastructure/http-hub.ts: imports "@cota/hub/harness", which only tests and 05-tests import',
      "apps/cli/src/helpers.ts: is not under a layer: the CLI's src holds main.ts and cli.ts and the layer folders 01-presentation to 05-tests, so that every file falls under the layer rules",
      "",
    ]);
  });

  it("reports the web's domain importing React, a package, the rest of the app, or Effect's modules that leave the process, but not its tests", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      "package.json": JSON.stringify({
        workspaces: ["apps/*", "packages/*", "proofs"],
      }),
      "packages/ui/package.json": JSON.stringify({
        name: "@cota/ui",
        exports: { "./components/*": "./src/components/*.tsx" },
      }),
      "apps/web/package.json": JSON.stringify({ name: "@cota/web" }),
      "apps/web/src/shared/api.ts": "",
      "packages/ui/src/components/block-meter.tsx": "",
      "apps/web/src/shared/domain/meter.ts":
        'import { Option, Schema } from "effect";\nimport * as Blocks from "./blocks.ts";\nimport * as Hues from "#shared/domain/hues.ts";\n',
      "apps/web/src/shared/domain/blocks.ts":
        'import { useMemo } from "react";\nimport { BlockMeter } from "@cota/ui/components/block-meter";\nimport { useApiQuery } from "#shared/api.ts";\nimport { HttpClient } from "effect/http";\n',
      "apps/web/src/shared/domain/hues.ts": "",
      "apps/web/src/shared/domain/meter.laws.test.ts":
        'import { it } from "@effect/vitest";\nimport { Arbitrary } from "effect";\nimport { useApiQuery } from "#shared/api.ts";\n',
    });

    const domain =
      "the web's domain imports only itself and Effect's modules that stay inside the process: no React, no DOM, no API (ADR-0019)";
    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/web/src/shared/domain/blocks.ts: imports "#shared/api.ts", and ${domain}`,
      `apps/web/src/shared/domain/blocks.ts: imports "@cota/ui/components/block-meter", and ${domain}`,
      `apps/web/src/shared/domain/blocks.ts: imports "effect/http", and ${inProcess}`,
      `apps/web/src/shared/domain/blocks.ts: imports "react", and ${inProcess}`,
      "",
    ]);
  });

  it("reports a screen importing the app or another screen, shared importing the app or a screen, and shipped code importing story support", () => {
    const web = (files: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(files).map(([path, content]) => [
          `apps/web/src/${path}`,
          content,
        ]),
      );
    const gate = runGate("boundaries.ts", {
      ...workspace,
      "apps/web/package.json": JSON.stringify({ name: "@cota/web" }),
      ...web({
        "main.tsx": 'import { App } from "./app/app.tsx";\n',
        "app/app.tsx":
          'import { routeTree } from "#route-tree.gen.ts";\nimport { Home } from "#screens/home/home.tsx";\nimport { useApiQuery } from "#shared/api.ts";\n',
        "app/router.tsx": 'import { page } from "#stories/page.tsx";\n',
        "shared/api.ts": "",
        "shared/theme.tsx":
          'import { App } from "#app/app.tsx";\nimport { Home } from "#screens/home/home.tsx";\n',
        "screens/home/home.tsx":
          'import { useApiQuery } from "#shared/api.ts";\nimport { Row } from "./row.tsx";\nimport { App } from "#app/app.tsx";\nimport { Sessions } from "#screens/sessions/sessions.tsx";\n',
        "screens/home/home.stories.tsx":
          'import { page } from "#stories/page.tsx";\nimport { Home } from "./home.tsx";\n',
        "screens/home/row.tsx": "",
        "screens/sessions/sessions.tsx": "",
        "stories/page.tsx":
          'import { App } from "#app/app.tsx";\nimport { useApiQuery } from "#shared/api.ts";\n',
      }),
    });

    const screen =
      "a screen imports only itself, #shared and @cota/ui, never the app or another screen: move what both need into shared (ADR-0019)";
    const shared =
      "shared never imports the app or a screen: move what both need into shared (ADR-0019)";
    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      'apps/web/src/app/router.tsx: imports "#stories/page.tsx", which is story support: only stories and tests import it (ADR-0019)',
      `apps/web/src/screens/home/home.tsx: imports "#app/app.tsx", and ${screen}`,
      `apps/web/src/screens/home/home.tsx: imports "#screens/sessions/sessions.tsx", and ${screen}`,
      `apps/web/src/shared/theme.tsx: imports "#app/app.tsx", and ${shared}`,
      `apps/web/src/shared/theme.tsx: imports "#screens/home/home.tsx", and ${shared}`,
      "",
    ]);
  });

  it("reports a layer of a module that imports a layer it may not, its module's module.ts, or test support", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "modules/relay/01-presentation/relay.routes.ts":
          'import * as Headers from "#modules/relay/04-infrastructure/provider/headers.ts";\n',
        "modules/relay/02-application/commands/forward-request.command.ts":
          'import * as HttpProvider from "#modules/relay/04-infrastructure/provider/http-provider.ts";\nimport * as Relay from "#modules/relay/module.ts";\n',
        "modules/relay/03-domain/fallback.ts":
          'import type * as Provider from "#modules/relay/02-application/interfaces/provider.ts";\n',
        "modules/relay/04-infrastructure/provider/http-provider.ts":
          'import * as HubError from "#modules/relay/01-presentation/hub-error.ts";\nimport * as Fake from "#modules/relay/05-tests/fake.ts";\n',
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      'apps/hub/src/modules/relay/01-presentation/relay.routes.ts: imports "#modules/relay/04-infrastructure/provider/headers.ts", and in the module relay, 01-presentation may import only 01-presentation, 02-application, 03-domain, not 04-infrastructure',
      'apps/hub/src/modules/relay/02-application/commands/forward-request.command.ts: imports "#modules/relay/04-infrastructure/provider/http-provider.ts", and in the module relay, 02-application may import only 02-application, 03-domain, not 04-infrastructure',
      'apps/hub/src/modules/relay/02-application/commands/forward-request.command.ts: imports "#modules/relay/module.ts", and in the module relay, 02-application may import only 02-application, 03-domain, not module.ts',
      'apps/hub/src/modules/relay/03-domain/fallback.ts: imports "#modules/relay/02-application/interfaces/provider.ts", and in the module relay, 03-domain may import only 03-domain, not 02-application',
      'apps/hub/src/modules/relay/04-infrastructure/provider/http-provider.ts: imports "#modules/relay/01-presentation/hub-error.ts", and in the module relay, 04-infrastructure may import only 04-infrastructure, 02-application, 03-domain, not 01-presentation',
      'apps/hub/src/modules/relay/04-infrastructure/provider/http-provider.ts: imports "#modules/relay/05-tests/fake.ts", and in the module relay, 04-infrastructure may import only 04-infrastructure, 02-application, 03-domain, not 05-tests, which only tests import',
      "",
    ]);
  });

  it("reports a module that imports another module's anything but its commands and queries", () => {
    const another =
      "another module may import only its 02-application/commands and 02-application/queries; ask it through a command or query, or move a type both need to shared/03-domain";
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "modules/relay/01-presentation/relay.routes.ts":
          'import * as AdmitRequest from "#modules/admission/02-application/queries/admit-request.query.ts";\nimport * as Admission from "#modules/admission/module.ts";\n',
        "modules/relay/04-infrastructure/provider/http-provider.ts":
          'import * as RecordRequest from "#modules/request-log/02-application/commands/record-request.command.ts";\nimport type * as Prices from "#modules/request-log/02-application/interfaces/prices.ts";\nimport * as Recorder from "#modules/recording/04-infrastructure/recorder.ts";\n',
        "modules/recording/03-domain/scrubber/scrubber.ts":
          'import * as Client from "#modules/relay/03-domain/client.ts";\n',
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/hub/src/modules/recording/03-domain/scrubber/scrubber.ts: imports "#modules/relay/03-domain/client.ts", which is inside the module relay: ${another}`,
      `apps/hub/src/modules/relay/01-presentation/relay.routes.ts: imports "#modules/admission/module.ts", which is inside the module admission: ${another}`,
      `apps/hub/src/modules/relay/04-infrastructure/provider/http-provider.ts: imports "#modules/recording/04-infrastructure/recorder.ts", which is inside the module recording: ${another}`,
      `apps/hub/src/modules/relay/04-infrastructure/provider/http-provider.ts: imports "#modules/request-log/02-application/interfaces/prices.ts", which is inside the module request-log: ${another}`,
      "",
    ]);
  });

  it("reports shared importing a module, a layer of shared importing one it may not, and a module importing shared's test support", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "shared/03-domain/request.entity.ts":
          'import * as Client from "#modules/relay/03-domain/client.ts";\nimport * as Shutdown from "#shared/04-infrastructure/shutdown.ts";\n',
        "shared/04-infrastructure/shutdown.ts":
          'import * as ForwardRequest from "#modules/relay/02-application/commands/forward-request.command.ts";\n',
        "modules/relay/04-infrastructure/provider/http-provider.ts":
          'import * as Harness from "#shared/05-tests/harness.ts";\n',
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/hub/src/modules/relay/04-infrastructure/provider/http-provider.ts: imports "#shared/05-tests/harness.ts", which is shared's test support: only tests and 05-tests import 05-tests`,
      'apps/hub/src/shared/03-domain/request.entity.ts: imports "#modules/relay/03-domain/client.ts", and shared imports no module: move what both need into shared',
      'apps/hub/src/shared/03-domain/request.entity.ts: imports "#shared/04-infrastructure/shutdown.ts", and in shared, 03-domain may import only 03-domain, not 04-infrastructure',
      'apps/hub/src/shared/04-infrastructure/shutdown.ts: imports "#modules/relay/02-application/commands/forward-request.command.ts", and shared imports no module: move what both need into shared',
      "",
    ]);
  });

  it("reports lib importing anything of Cota", () => {
    const knowsNothing =
      "and lib knows nothing of Cota: it imports only lib and outside packages; move the file out of lib, or give lib what it needs as an argument";
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "lib/copy.ts":
          'import { Stream } from "effect";\nimport * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";\nimport * as Tee from "./tee.ts";\n',
        "lib/tee.ts":
          'import type * as Copy from "#lib/copy.ts";\nimport type { RequestId } from "#shared/03-domain/request.entity.ts";\n',
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/hub/src/lib/copy.ts: imports "#modules/relay/02-application/interfaces/protocol.ts", ${knowsNothing}`,
      `apps/hub/src/lib/tee.ts: imports "#shared/03-domain/request.entity.ts", ${knowsNothing}`,
      "",
    ]);
  });

  it("reports a module, shared or lib importing config, hub.ts, main.ts, api.ts or restore-archive.ts", () => {
    const compositionRoot =
      "which is the composition root: config/, hub.ts, main.ts, api.ts, restore-archive.ts and import.ts assemble modules, shared and lib, which never import them; take what they give as an argument or a service";
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "modules/request-log/04-infrastructure/persistence/clickhouse/client.ts":
          'import * as HubConfig from "#config/config.ts";\n',
        "shared/04-infrastructure/shutdown.ts":
          'import { grace } from "#hub.ts";\n',
        "lib/tee.ts": 'import * as Main from "#main.ts";\n',
        "modules/sign-in/01-presentation/sign-in.handlers.ts":
          'import { Api } from "#api.ts";\n',
        "shared/01-presentation/caller.middleware.ts":
          'import { Api } from "#api.ts";\n',
        "modules/request-log/01-presentation/restore.ts":
          'import * as Restore from "#restore-archive.ts";\n',
        "restore-archive.ts":
          'import * as HubConfig from "#config/config.ts";\nimport * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";\n',
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/hub/src/lib/tee.ts: imports "#main.ts", ${compositionRoot}`,
      `apps/hub/src/modules/request-log/01-presentation/restore.ts: imports "#restore-archive.ts", ${compositionRoot}`,
      `apps/hub/src/modules/request-log/04-infrastructure/persistence/clickhouse/client.ts: imports "#config/config.ts", ${compositionRoot}`,
      `apps/hub/src/modules/sign-in/01-presentation/sign-in.handlers.ts: imports "#api.ts", ${compositionRoot}`,
      `apps/hub/src/shared/01-presentation/caller.middleware.ts: imports "#api.ts", ${compositionRoot}`,
      `apps/hub/src/shared/04-infrastructure/shutdown.ts: imports "#hub.ts", ${compositionRoot}`,
      "",
    ]);
  });

  it("reports a file outside a layer of its module or of shared, so that no folder escapes the rules", () => {
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "modules/relay/limits.ts": "",
        "modules/relay/domain/fallback.ts":
          'import * as Http from "#modules/relay/04-infrastructure/provider/http-provider.ts";\n',
        "modules/relay/module.ts": "",
        "shared/ids.ts": "",
        "shared/util/strings.ts": "",
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      'apps/hub/src/modules/relay/domain/fallback.ts: is under "domain", which is not a layer: a module holds module.ts and the layer folders 01-presentation, 02-application, 03-domain, 04-infrastructure and 05-tests, so that every file falls under the layer rules',
      "apps/hub/src/modules/relay/limits.ts: is directly in the module relay, which holds module.ts and the layer folders 01-presentation, 02-application, 03-domain, 04-infrastructure and 05-tests, so that every file falls under the layer rules: move it into its layer",
      "apps/hub/src/shared/ids.ts: is directly in shared, which holds only layer folders: move it into its layer",
      'apps/hub/src/shared/util/strings.ts: is under "util", which is not a layer: shared holds only the layer folders 01-presentation to 05-tests',
      "",
    ]);
  });

  it("reports a file in 02-application outside its commands, queries and interfaces, but not a test beside it", () => {
    const outside =
      "is in 02-application but not under commands, queries or interfaces, which hold its use cases and ports: a value or rule they share goes in 03-domain, and an adapter in 04-infrastructure";
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "modules/relay/02-application/limits.ts": "",
        "modules/relay/02-application/credential-plan.test.ts": "",
        "modules/relay/02-application/plans/credential-plan.ts": "",
        "modules/relay/02-application/commands/forward-request.command.ts": "",
        "modules/relay/02-application/queries/plan-credential.query.ts": "",
        "modules/relay/02-application/interfaces/provider.ts": "",
        "shared/02-application/clock.ts": "",
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/hub/src/modules/relay/02-application/limits.ts: ${outside}`,
      `apps/hub/src/modules/relay/02-application/plans/credential-plan.ts: ${outside}`,
      `apps/hub/src/shared/02-application/clock.ts: ${outside}`,
      "",
    ]);
  });

  it("reports a file in 02-application or 03-domain that imports effect/http, if only a type, but not a test or another layer", () => {
    const http =
      "speaks its module's own terms: HTTP's types stay in 01-presentation and 04-infrastructure, and a value the module needs from them, such as a method, is its own in 03-domain";
    const gate = runGate("boundaries.ts", {
      ...workspace,
      ...hub({
        "modules/relay/02-application/commands/forward-request.command.ts":
          'import type { HttpMethod } from "effect/http";\n',
        "modules/relay/02-application/commands/forward-request.command.test.ts":
          'import { HttpClient } from "effect/http";\n',
        "modules/relay/02-application/interfaces/provider.ts":
          'import { Cookies } from "effect/http";\nimport type * as HttpMethod from "effect/http/HttpMethod";\n',
        "modules/relay/03-domain/method.ts":
          'import type { HttpMethod } from "effect/http";\n',
        "modules/relay/01-presentation/relay.routes.ts":
          'import { HttpRouter } from "effect/http";\n',
        "modules/relay/04-infrastructure/provider/http-provider.ts":
          'import { HttpClient } from "effect/http";\n',
      }),
    });

    expect(gate.exitCode).toBe(1);
    expect(gate.stderr.split("\n")).toEqual([
      `apps/hub/src/modules/relay/02-application/commands/forward-request.command.ts: imports "effect/http", and 02-application ${http}`,
      `apps/hub/src/modules/relay/02-application/interfaces/provider.ts: imports "effect/http", and 02-application ${http}`,
      `apps/hub/src/modules/relay/02-application/interfaces/provider.ts: imports "effect/http/HttpMethod", and 02-application ${http}`,
      `apps/hub/src/modules/relay/03-domain/method.ts: imports "effect/http", and ${inProcess}`,
      "",
    ]);
  });
});
