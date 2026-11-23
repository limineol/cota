import { HttpApi, OpenApi } from "effect/http-api";
import * as MachineApi from "#modules/admission/01-presentation/machine.api.ts";
import * as DisplayNamesApi from "#modules/display-names/01-presentation/display-names.api.ts";
import * as PoolsApi from "#modules/quota/01-presentation/pools.api.ts";
import * as ReportsApi from "#modules/request-log/01-presentation/reports.api.ts";
import * as RequestsApi from "#modules/request-log/01-presentation/requests.api.ts";
import * as SearchApi from "#modules/request-log/01-presentation/search.api.ts";
import * as SessionsApi from "#modules/request-log/01-presentation/sessions.api.ts";
import * as SqlApi from "#modules/request-log/01-presentation/sql.api.ts";
import * as TrafficApi from "#modules/request-log/01-presentation/traffic.api.ts";
import * as RoutesApi from "#modules/routes/01-presentation/routes.api.ts";
import * as SignInApi from "#modules/sign-in/01-presentation/sign-in.api.ts";
import { withSecuritySchemes } from "#shared/01-presentation/caller.middleware.ts";

/**
 * The hub's API, every group of it under `/api` (ADR-0011). Its OpenAPI
 * document is committed as `apps/hub/openapi.json`.
 */
export const Api = HttpApi.make("cota")
  .add(SignInApi.group)
  .add(TrafficApi.group)
  .add(SessionsApi.group)
  .add(RequestsApi.group)
  .add(SearchApi.group)
  .add(SqlApi.group)
  .add(DisplayNamesApi.group)
  .add(PoolsApi.group)
  .add(MachineApi.group)
  .add(RoutesApi.group)
  .add(ReportsApi.group)
  .annotate(OpenApi.Title, "Cota hub")
  .annotate(
    OpenApi.Description,
    "What the dashboard and the owner's agents read the request log and the pools' quotas through. The owner signs in; an agent sends a reader key.",
  )
  .annotate(OpenApi.Transform, withSecuritySchemes);
