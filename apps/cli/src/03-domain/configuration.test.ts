import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import * as Configuration from "./configuration.ts";

const written = `hub = "http://127.0.0.1:18080"
machine = "studio \\"two\\""
allow_plain_http = true

[launch]
wait = "7 seconds"
wait_routed = "1500 millis"

[clients.codex]
own_pool = "chatgpt"
`;

describe("the configuration", () => {
  it("reads back what it writes, so that joining again writes nothing", () => {
    const read = Configuration.decode(Bun.TOML.parse(written));
    expect(Result.map(read, Configuration.textOf)).toEqual(
      Result.succeed(written),
    );
  });

  it("refuses an http hub on another machine unless plain http is allowed, under the key hub", () => {
    expect(
      Configuration.decode({ hub: "http://cota.internal:8080", machine: "a" }),
    ).toEqual(
      Result.fail(
        'http://cota.internal:8080 is plain http to another machine, which sends every hub key in the clear: use https, or allow it with --allow-plain-http\n  at ["hub"]',
      ),
    );
  });
});
