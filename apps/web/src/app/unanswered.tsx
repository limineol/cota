import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@cota/ui/components/alert";
import { Button } from "@cota/ui/components/button";
import { CircleAlert, RotateCw } from "lucide-react";

/** What shows when the hub did not answer who is signed in. */
export function Unanswered({
  retrying,
  onRetry,
}: {
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Alert variant="danger" className="max-w-md">
        <CircleAlert />
        <AlertTitle>The hub did not answer.</AlertTitle>
        <AlertDescription>
          Check that it is running and reachable from this browser, then try
          again.
        </AlertDescription>
        <AlertAction>
          <Button
            variant="outline"
            size="sm"
            disabled={retrying}
            onClick={onRetry}
          >
            <RotateCw data-icon="inline-start" /> Try again
          </Button>
        </AlertAction>
      </Alert>
    </main>
  );
}
