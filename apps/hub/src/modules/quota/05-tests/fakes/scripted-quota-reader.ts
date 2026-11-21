import { Effect, Layer } from "effect";
import { QuotaReader } from "#modules/quota/02-application/interfaces/quota-reader.ts";

/** A quota reader that answers every read with `read`; by default, it reads no pool and a read dies. */
export const layer = (
  read: QuotaReader["Service"]["read"] = () =>
    Effect.die("the scripted quota reader was not asked to read"),
): Layer.Layer<QuotaReader> =>
  Layer.succeed(QuotaReader, QuotaReader.of({ read }));
