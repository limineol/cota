import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as MachineHandlers from "#modules/admission/01-presentation/machine.handlers.ts";
import * as AdmitRequest from "#modules/admission/02-application/queries/admit-request.query.ts";
import * as IdentifyHubKey from "#modules/admission/02-application/queries/identify-hub-key.query.ts";
import * as ReadMachine from "#modules/admission/02-application/queries/read-machine.query.ts";
import * as Admission from "#modules/admission/03-domain/admission.ts";
import * as Sha256HubKeyHasher from "#modules/admission/04-infrastructure/sha256-hub-key-hasher.ts";

/** Admission under the given policy: its hub keys, and its pools' kinds. */
export const layer = (
  policy: Admission.Policy,
): Layer.Layer<AdmitRequest.AdmitRequest | IdentifyHubKey.IdentifyHubKey> =>
  Layer.mergeAll(AdmitRequest.layer(policy), IdentifyHubKey.layer(policy)).pipe(
    Layer.provide(Admission.layer(policy)),
    Layer.provide(Sha256HubKeyHasher.layer),
  );

/** What a caller is and the pools of the configuration it opens, over the request log's models of each pool and the display names. */
export const machine = ReadMachine.layer;

/** The handlers of the `machine` group. */
export const api = HttpApiBuilder.group(Api, "machine", MachineHandlers.build);
