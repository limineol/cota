import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as Hub from "#hub.ts";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import * as QuotaLoginsFixtures from "#modules/quota/05-tests/quota-logins.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";
import * as SqliteQuotaLogins from "./sqlite-quota-logins.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-sqlite-quota-logins-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const at = QuotaLoginsFixtures.at("2026-11-13T10:00:00Z");

/** Which of the store's files, the write-ahead log among them, hold `text`. */
const holding = (path: string, text: string) =>
  [path, `${path}-wal`].filter(
    (file) =>
      existsSync(file) && readFileSync(file).toString("latin1").includes(text),
  );

it.effect(
  "leaves no token of a quota login forgotten or replaced in the store's files, its write-ahead log included",
  () =>
    Effect.gen(function* () {
      const path = join(scratch, "cota.sqlite");
      const store = yield* QuotaLogins;
      const forgotten = "refresh-token-forgotten-0b7e".repeat(4);
      const replaced = "refresh-token-replaced-91c3".repeat(4);
      yield* store.give(
        QuotaLoginsFixtures.claudeLogin(
          "claude",
          { access: `access-${forgotten}`, refresh: forgotten },
          at,
          at,
        ),
      );
      yield* store.forget(PoolId.make("claude"));
      for (const refresh of [replaced, "refresh-token-kept-5d20"]) {
        yield* store.give(
          QuotaLoginsFixtures.chatGptLogin(
            "codex",
            { access: `access-${refresh}`, refresh },
            at,
            at,
          ),
        );
      }
      expect({
        forgotten: holding(path, forgotten),
        replaced: holding(path, replaced),
        kept: holding(path, "refresh-token-kept-5d20").length > 0,
      }).toEqual({ forgotten: [], replaced: [], kept: true });
    }).pipe(
      Effect.provide(
        SqliteQuotaLogins.layer.pipe(
          Layer.provide(
            Layer.orDie(
              HubStore.layer({
                path: join(scratch, "cota.sqlite"),
                steps: Hub.storeSteps,
              }),
            ),
          ),
        ),
      ),
    ),
);
