import { Context, type Effect } from "effect";
import type * as Readers from "#modules/quota/03-domain/readers.ts";
import type {
  QuotaLoginExpired,
  ReadFailure,
} from "#modules/quota/03-domain/readings.ts";
import type { QuotaReading } from "#modules/quota/03-domain/sources.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";

/** Asks a pool's provider for its quota windows and plan, once, with the reader and credential `Readers.readerOf` gives it. */
export class QuotaReader extends Context.Service<
  QuotaReader,
  {
    /**
     * A quota reading whose windows were observed when the answer ended, or
     * the failure of the read; an answer that cannot be read, or gives no
     * window, is the failure `unreadable` (U5).
     */
    readonly read: (
      pool: Pool.Pool,
      reader: Readers.Reader,
    ) => Effect.Effect<QuotaReading, ReadFailure | QuotaLoginExpired>;
  }
>()("@cota/hub/quota/QuotaReader") {}
