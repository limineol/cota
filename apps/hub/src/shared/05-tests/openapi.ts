import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OpenApi } from "effect/http-api";
import { Api } from "#api.ts";

/** Where the reviewed copy of the API's OpenAPI document is committed. */
export const committed = fileURLToPath(
  new URL("../../../openapi.json", import.meta.url),
);

export const document = () => OpenApi.fromApi(Api);

if (import.meta.main) {
  writeFileSync(committed, `${JSON.stringify(document(), null, 2)}\n`);
  console.log("apps/hub/openapi.json");
}
