import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@cota/ui/components/alert";
import { Button } from "@cota/ui/components/button";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { Predicate } from "effect";
import { CircleAlert } from "lucide-react";

/** What a failed read says: the problem's own sentence, or that the hub did not answer. */
export const problemOf = (error: unknown) => {
  if (
    Predicate.hasProperty(error, "detail") &&
    typeof error.detail === "string"
  ) {
    return error.detail;
  }
  if (
    Predicate.hasProperty(error, "title") &&
    typeof error.title === "string"
  ) {
    return error.title;
  }
  return "The hub did not answer. Check that it is running and reachable from this browser.";
};

/** A failed read: an alert above what it concerns, or, `inside` the panel it fills, its empty state. */
export function Problem({
  title,
  error,
  onRetry,
  inside = false,
}: {
  readonly title: string;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly inside?: boolean;
}) {
  if (inside) {
    return (
      <Empty role="alert">
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{problemOf(error)}</EmptyDescription>
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      </Empty>
    );
  }
  return (
    <Alert variant="danger" className="mb-4.5">
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{problemOf(error)}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}
