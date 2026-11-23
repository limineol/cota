import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const hubKeys = [
  Harness.secrets.fleetHubKey,
  Harness.secrets.clientsHubKey,
  Harness.secrets.readerHubKey,
];

const paths = [
  "/pools/gemini/models",
  "/pools/gemini/v1/messages",
  "/pools/gemini/responses",
  "/pools/gemini/chat/completions",
];

const rejection = (type: string) => ({
  status: 403,
  body: { type: "error", error: { type, message: expect.any(String) } },
});

layer(Harness.layer())("an observed pool at the relay", (it) => {
  it.effect(
    "L15: no request admitted by the relay names an observed pool: every hub key in x-cota-key is answered 403 cota_hub_key_scope there, as the bearer token or in x-api-key 403 cota_hub_key_rejected, and nothing is forwarded or recorded",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.forget();
        const answers = [];
        const expected = [];
        for (const path of paths) {
          for (const hubKey of hubKeys) {
            for (const [headers, type] of [
              [{ "x-cota-key": hubKey }, "cota_hub_key_scope"],
              [{ authorization: `Bearer ${hubKey}` }, "cota_hub_key_rejected"],
              [{ "x-api-key": hubKey }, "cota_hub_key_rejected"],
            ] as const) {
              const response = yield* Harness.send(path, {
                method: "POST",
                headers: { ...headers, "content-type": "application/json" },
                body: "{}",
              });
              const body: unknown = JSON.parse(yield* Harness.textOf(response));
              answers.push({ status: response.status, body });
              expected.push(rejection(type));
            }
          }
        }
        expect(answers).toEqual(expected);
        expect(fake.seen()).toEqual([]);
        expect(yield* Harness.recorded(0)).toEqual([]);
      }),
  );
});
