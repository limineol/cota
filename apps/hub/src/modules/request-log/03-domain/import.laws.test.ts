import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Option, Schema } from "effect";
import * as Cost from "#modules/request-log/03-domain/cost.ts";
import * as Import from "#modules/request-log/03-domain/import.ts";
import * as Title from "#modules/request-log/03-domain/title.ts";
import * as Generated from "#modules/request-log/05-tests/import-source.ts";
import { pick } from "#modules/request-log/05-tests/sessions.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const built = (generated: Generated.GeneratedSource) =>
  Effect.gen(function* () {
    const read = Generated.pageRead(generated);
    const requests = yield* Effect.forEach(read.requests, (row) =>
      Import.requestOf(row, Generated.targets, Generated.priceOf),
    );
    const page = Import.pageOf(
      Generated.day,
      requests,
      read.rows,
      read.listed,
      read.firstNamings,
    );
    const chunk = Import.chunkOf(page, read.contents, new Set());
    const conversations = Import.conversationsOf(page, new Map(chunk.digests));
    return { read, requests, page, chunk, conversations };
  });

describe("an import's rows", () => {
  it.effect.prop(
    "Z5: a source request always gives the same id, a UUID version 7 whose time is its start, and two different source ids never give one",
    {
      // Ids are text, which a lone surrogate is not: it has no UTF-8 bytes to hash.
      ids: Arbitrary.array(
        Arbitrary.schema(Schema.String.check(Schema.isMaxLength(40))).pipe(
          Arbitrary.filter((id) => id.isWellFormed()),
        ),
        { minLength: 1, maxLength: 20 },
      ),
      at: int(0, 2 ** 42),
    },
    ({ ids, at }) =>
      Effect.sync(() => {
        const startedAt = DateTime.makeUnsafe(at);
        const given = new Map<string, string>();
        for (const id of ids) {
          const made = Import.requestIdOf(id, startedAt);
          expect(made).toBe(Import.requestIdOf(id, startedAt));
          expect(made).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
          expect(
            Number.parseInt(made.replaceAll("-", "").slice(0, 12), 16),
          ).toBe(at);
          const before = given.get(made);
          expect(before === undefined || before === id).toBe(true);
          given.set(made, id);
        }
      }),
  );

  it.effect.prop(
    "Z6: each source request of a day is built once, and each of its request items is built or counted under one reason not carried",
    { generated: Generated.source },
    ({ generated }) =>
      Effect.gen(function* () {
        const { read, requests, page, conversations } = yield* built(generated);

        expect(requests.map(({ record }) => record.request.id).sort()).toEqual(
          read.requests
            .map(({ id, startedAt }) => Import.requestIdOf(id, startedAt))
            .sort(),
        );
        expect(new Set(requests.map(({ source }) => source.id)).size).toBe(
          read.requests.length,
        );
        expect(
          conversations.requestItems.length +
            conversations.unresolved +
            page.withoutRequest,
        ).toBe(read.rows.length);
        expect(conversations.requestItems.length).toBeLessThanOrEqual(
          requests.length,
        );
      }),
  );

  it.effect.prop(
    "Z8: each imported request's items, in order, are the source's items for it, each the same JSON value as the source's content",
    { generated: Generated.source },
    ({ generated }) =>
      Effect.gen(function* () {
        const { read, chunk, conversations } = yield* built(generated);
        const contentOfDigest = new Map(
          chunk.items.map((item) => [item.digest, item.content]),
        );
        for (const row of conversations.requestItems) {
          const source = read.rows.find(
            (each) =>
              Import.requestIdOf(each.requestId, each.startedAt) ===
              row.requestId,
          );
          expect(source).toBeDefined();
          if (source === undefined) continue;
          for (const [digests, hashes] of [
            [row.tools, source.tools],
            [row.input, source.input],
            [row.output, source.output],
          ] as const) {
            expect(digests.length).toBe(hashes.length);
            hashes.forEach((hash, index) => {
              const value: Schema.Json = JSON.parse(Generated.contentOf(hash));
              const digest = digests[index];
              expect(digest).toBe(
                Conversation.digestOf(Conversation.canonical(value)),
              );
              const content =
                digest === undefined ? undefined : contentOfDigest.get(digest);
              if (content !== undefined) {
                expect(JSON.parse(content)).toEqual(value);
              }
            });
          }
          expect(row.system).toEqual([]);
          expect(row.params).not.toHaveProperty("tools");
        }
      }),
  );

  it.effect.prop(
    "Z9: an imported request's token classes add up to the source's prompt and completion tokens, and its cost is the price lists' for them, never the source's",
    { generated: Generated.source },
    ({ generated }) =>
      Effect.gen(function* () {
        const { requests } = yield* built(generated);
        for (const { source, record, usage } of requests) {
          const reported = record.request.usage;
          expect(Option.isSome(reported)).toBe(usage === "Carried");
          if (Option.isNone(reported)) {
            expect(Option.isNone(record.cost)).toBe(true);
            continue;
          }
          const { tokens } = reported.value;
          expect(
            tokens.input +
              tokens.cacheRead +
              tokens.cacheWriteShort +
              tokens.cacheWriteLong,
          ).toBe(source.promptTokens);
          expect(tokens.output).toBe(source.completionTokens);
          const priced = yield* Cost.of(
            tokens,
            Generated.priceOf(
              Generated.targets.pools.get(Import.sourcePoolOf(source)) ?? {
                id: record.request.pool,
                provider: "",
                protocol: "openai-chat",
              },
              source.model,
            ),
          );
          expect(record.cost).toEqual(priced);
        }
      }),
  );

  it.prop(
    "Z12: an import sets a display name only for a kind and key the owner has not named, once, and never one the file does not give",
    {
      renames: Arbitrary.array(
        Arbitrary.all({
          kind: pick(["pool", "model", "client", "host", "project", "colour"]),
          key: pick(["claude-max", "old-laptop", "gpt-5.5", "unmapped", ""]),
          name: pick(["Work", "  Laptop ", "", "x".repeat(81)]),
        }),
        { maxLength: 8 },
      ),
      named: Arbitrary.array(
        Arbitrary.all({
          kind: pick(["pool", "model", "machine"] as const),
          key: pick(["claude", "laptop", "gpt-5.5"]),
        }),
        { maxLength: 3 },
      ),
    },
    ({ renames, named }) => {
      const file: Record<string, Record<string, string>> = {};
      for (const { kind, key, name } of renames) {
        file[kind] = { ...file[kind], [key]: name };
      }
      const owners = new Set(
        named.map(({ kind, key }) => Import.nameKeyOf(kind, key)),
      );
      const planned = Import.renamesOf(
        { renames: file },
        Generated.targets,
        owners,
      );
      const set = planned.toSet.map(({ kind, key }) =>
        Import.nameKeyOf(kind, key),
      );
      expect(set.some((key) => owners.has(key))).toBe(false);
      expect(new Set(set).size).toBe(set.length);
      for (const rename of planned.toSet) {
        expect(rename.name).toBe(rename.name.trim());
        expect(rename.name.length).toBeGreaterThan(0);
        const sourceKind = rename.kind === "machine" ? "host" : rename.kind;
        const given = Object.values(file[sourceKind] ?? {}).map((name) =>
          name.trim(),
        );
        expect(given).toContain(rename.name);
      }
    },
  );

  it.prop(
    "Z13: an imported title is never the latest report of a session a machine reported after the import's source ended",
    {
      titles: Arbitrary.array(
        Arbitrary.all({
          session: pick(["s1", "s2", "s3"]),
          title: pick(["Fix the build", "", "  "]),
        }),
        { maxLength: 4 },
      ),
      lastRequest: int(0, 10_000),
      later: Arbitrary.array(
        Arbitrary.all({ session: pick(["s1", "s2"]), after: int(1, 1_000) }),
        { maxLength: 3 },
      ),
    },
    ({ titles, lastRequest, later }) => {
      const latest = new Map([
        ["s1", DateTime.makeUnsafe(lastRequest)],
        ["s2", DateTime.makeUnsafe(Math.max(0, lastRequest - 5))],
      ]);
      const imported = Import.titlesOf(titles, latest);
      const machines: Array<Title.Report> = later.map(({ session, after }) => ({
        session,
        title: "Machine's",
        reportedAt: DateTime.makeUnsafe(lastRequest + after),
        machine: "laptop",
        reportedBy: "fleet",
      }));
      const winners = Title.latestReports([...imported.reports, ...machines]);
      for (const { session } of machines) {
        expect(winners.get(session)?.reportedBy).toBe("fleet");
      }
      expect(imported.reports.every(({ title }) => title !== "")).toBe(true);
    },
  );
});
