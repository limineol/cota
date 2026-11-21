import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option, Schema } from "effect";
import * as Archive from "./archive.ts";

const day = Archive.Day.make("2026-11-10");
const sha256 = `3f2a9c0d4e5b6a71${"0".repeat(48)}`;

const manifest = Archive.manifestOf(
  day,
  DateTime.makeUnsafe("2026-11-11T01:00:00.5Z"),
  {
    version: "26.8.36.3",
    database: "cota",
    tables: {
      items: {
        columns: [{ name: "first_seen", type: "DateTime64(3, 'UTC')" }],
        create: "CREATE TABLE cota.items",
      },
      request_items: { columns: [], create: "" },
      requests: { columns: [], create: "" },
      session_titles: { columns: [], create: "" },
    },
  },
  {
    items: {
      file: Option.some({ bytes: 120, sha256 }),
      measure: { rows: 3, checksum: "18446744073709551615", fingerprint: "9" },
    },
    request_items: { file: Option.none(), measure: Archive.nothingLoaded },
    requests: { file: Option.none(), measure: Archive.nothingLoaded },
    session_titles: { file: Option.none(), measure: Archive.nothingLoaded },
  },
);

const encoded = () => JSON.parse(Archive.textOf(manifest));

const whyOf = (text: string) => {
  const reading = Archive.readManifest(day, text);
  return reading._tag === "Unreadable" ? reading.why : "readable";
};

describe("Archive.Day", () => {
  it("takes a calendar day written YYYY-MM-DD, and nothing else", () => {
    expect(
      [
        "2026-11-10",
        "2028-02-29",
        "2026-02-29",
        "2026-13-01",
        "2026-11-1",
        "20261110",
        "../x",
      ].map((text) => Schema.is(Archive.Day)(text)),
    ).toEqual([true, true, false, false, false, false, false]);
  });
});

describe("Archive.readManifest", () => {
  it("reads back the manifest it writes, whose text has two-space indentation and the time it was archived in milliseconds", () => {
    const text = Archive.textOf(manifest);
    expect(text).toContain('\n  "archived_at": "2026-11-11T01:00:00.500Z",\n');
    expect(text).toContain(
      `\n      "file": "items.3f2a9c0d4e5b6a71.jsonl.zst",\n`,
    );
    expect(Archive.readManifest(day, text)).toEqual({
      _tag: "Readable",
      manifest,
    });
  });

  it("cannot read a manifest that is not JSON, of another archive, of another day, or not of a manifest's shape", () => {
    expect([
      whyOf("{ not json"),
      whyOf(JSON.stringify({ ...encoded(), archive: 2 })),
      whyOf(JSON.stringify({ ...encoded(), day: "2026-11-09" })),
      whyOf(
        JSON.stringify({ ...encoded(), tables: encoded().tables.slice(1) }),
      ).startsWith("it is not a manifest: "),
    ]).toEqual([
      "it is not JSON",
      "its archive is 2, not 1",
      "it is the manifest of 2026-11-09",
      true,
    ]);
  });

  it("cannot read a manifest that names a file other than its table's, by its SHA-256, so that no other file is ever read or removed for it", () => {
    const named = (file: unknown) => {
      const text = encoded();
      text.tables[0].file = file;
      return whyOf(JSON.stringify(text)).startsWith("it is not a manifest: ");
    };
    expect([
      named("../../etc/passwd"),
      named("requests.3f2a9c0d4e5b6a71.jsonl.zst"),
      named("items.3f2a9c0d4e5b6a72.jsonl.zst"),
      named(null),
      named("items.3f2a9c0d4e5b6a71.jsonl.zst"),
    ]).toEqual([true, true, true, true, false]);
  });
});
