import { Clock, DateTime, Effect } from "effect";
import { useApiQuery } from "#shared/api.ts";
import { fifteenMinutes } from "#shared/range.ts";

/** When the request log begins, which all time starts from; read only while all time is chosen. */
export const useLogBegins = (enabled: boolean) =>
  useApiQuery(
    ["log-begins"],
    (client) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const answer = yield* client.traffic.overview({
          query: {
            from: DateTime.makeUnsafe(now - fifteenMinutes),
            to: DateTime.makeUnsafe(now),
          },
        });
        return answer.firstRequestAt === null
          ? null
          : DateTime.toEpochMillis(answer.firstRequestAt);
      }),
    { enabled },
  );
