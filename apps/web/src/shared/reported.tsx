import { Badge } from "@cota/ui/components/badge";

/** The mark of a reported request, and of a session made only of them: one word, the same on every screen. */
export function ReportedMark() {
  return <Badge>Reported</Badge>;
}

/** Whether a session's requests were all reported, from its distinct origins. */
export const onlyReported = <Origin extends string>(
  origins: ReadonlyArray<Origin>,
) => origins.length === 1 && origins[0] === "reported";
