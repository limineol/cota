import { Api } from "@cota/hub/api";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@cota/ui/components/alert";
import { Button } from "@cota/ui/components/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cota/ui/components/card";
import { Input } from "@cota/ui/components/input";
import { Label } from "@cota/ui/components/label";
import { Mark } from "@cota/ui/components/mark";
import { Note } from "@cota/ui/components/note";
import { OrRule } from "@cota/ui/components/or-rule";
import { Navigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { HttpApiClient } from "effect/http-api";
import {
  CircleAlert,
  Clock as ClockIcon,
  KeyRound,
  RotateCw,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Client, useApiMutation } from "#shared/api.ts";
import { span } from "#shared/domain/quantities.ts";
import { doorOf } from "#shared/domain/ways-in.ts";
import { type Passkeys, usePasskeys } from "#shared/passkeys.ts";
import { pausedUntil, untilText, useNowWhile } from "#shared/paused.ts";
import { askWaysInAgain, readMeAgain, useWaysIn } from "#shared/sign-in.ts";

type Outcome =
  | { readonly _tag: "SignedIn" }
  | { readonly _tag: "WrongPassword" }
  | { readonly _tag: "Paused"; readonly until: number }
  | { readonly _tag: "AskAgain" }
  | { readonly _tag: "Refused"; readonly title: string };

const decodeSignIn = HttpApiClient.decodeResponse(Api, {
  group: "sign-in",
  endpoint: "signIn",
});

const signIn =
  (password: string) =>
  (client: Client): Effect.Effect<Outcome, unknown> =>
    Effect.gen(function* () {
      const response = yield* client["sign-in"].signIn({
        payload: { password },
        responseMode: "response-only",
      });
      return yield* decodeSignIn(response).pipe(
        Effect.as<Outcome>({ _tag: "SignedIn" }),
        Effect.catchTag("WrongPassword", () =>
          Effect.succeed<Outcome>({ _tag: "WrongPassword" }),
        ),
        Effect.catchTag(["NotSetUp", "PasswordOff"], () =>
          Effect.succeed<Outcome>({ _tag: "AskAgain" }),
        ),
        Effect.catchTag("TooManyAttempts", () =>
          pausedUntil(response).pipe(
            Effect.map((until): Outcome => ({ _tag: "Paused", until })),
          ),
        ),
        Effect.catchTag(["CrossSite", "HubStoreProblem"], ({ title }) =>
          Effect.succeed<Outcome>({ _tag: "Refused", title }),
        ),
      );
    });

type PasskeyOutcome =
  | { readonly _tag: "SignedIn" }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "NotAccepted" }
  | { readonly _tag: "NotHere" }
  | { readonly _tag: "AskAgain" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Refused"; readonly title: string };

const signInWithPasskey =
  (browser: Passkeys) =>
  (client: Client): Effect.Effect<PasskeyOutcome, unknown> =>
    Effect.gen(function* () {
      const options = yield* client["sign-in"].preparePasskeySignIn();
      const signed = yield* Effect.promise(() => browser.signIn(options));
      switch (signed._tag) {
        case "Answered":
          yield* client["sign-in"].signInWithPasskey({
            payload: signed.answer,
          });
          return { _tag: "SignedIn" } as const;
        case "Exists":
          return {
            _tag: "Failed",
            message: "The browser answered as if a passkey were being made.",
          } as const;
        default:
          return signed;
      }
    }).pipe(
      Effect.catchTag("NoPasskeys", () =>
        Effect.succeed<PasskeyOutcome>({ _tag: "AskAgain" }),
      ),
      Effect.catchTag("NotAPasskeyOrigin", () =>
        Effect.succeed<PasskeyOutcome>({ _tag: "NotHere" }),
      ),
      Effect.catchTag("PasskeyRefused", () =>
        Effect.succeed<PasskeyOutcome>({ _tag: "NotAccepted" }),
      ),
      Effect.catchTag(["CrossSite", "HubStoreProblem"], ({ title }) =>
        Effect.succeed<PasskeyOutcome>({ _tag: "Refused", title }),
      ),
    );

const elsewhere =
  "a browser offers passkeys only over https at a host name, or on localhost";

function Unanswered({ action }: { readonly action: string }) {
  return (
    <>
      <AlertTitle>The hub did not answer.</AlertTitle>
      <AlertDescription>
        Check that it is running and reachable from this browser, then {action}.
      </AlertDescription>
    </>
  );
}

function Problem({
  outcome,
}: {
  readonly outcome:
    | Exclude<Outcome, { _tag: "SignedIn" | "AskAgain" }>
    | "unanswered";
}) {
  if (outcome === "unanswered") {
    return (
      <Alert id="sign-in-problem" variant="danger">
        <CircleAlert />
        <Unanswered action="sign in again" />
      </Alert>
    );
  }
  switch (outcome._tag) {
    case "WrongPassword":
      return (
        <Alert id="sign-in-problem" variant="danger">
          <CircleAlert />
          <AlertTitle>That is not the owner password.</AlertTitle>
          <AlertDescription>Check it and sign in again.</AlertDescription>
        </Alert>
      );
    case "Paused":
      return (
        <Alert id="sign-in-problem">
          <ClockIcon />
          <AlertTitle>
            Signing in is paused until {untilText(outcome.until)}.
          </AlertTitle>
          <AlertDescription>
            Too many wrong passwords were given in the last 10 minutes. Sign in
            with the owner password once the pause ends.
          </AlertDescription>
        </Alert>
      );
    case "Refused":
      return (
        <Alert id="sign-in-problem" variant="danger">
          <CircleAlert />
          <AlertTitle>The hub could not sign in the owner.</AlertTitle>
          <AlertDescription>
            {outcome.title} Sign in again; if it keeps failing, the hub's log
            says why.
          </AlertDescription>
        </Alert>
      );
  }
}

function PasswordForm() {
  const field = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const attempt = useApiMutation(signIn, async (outcome, queries) => {
    if (outcome._tag === "SignedIn") await readMeAgain(queries);
    if (outcome._tag === "AskAgain") await askWaysInAgain(queries);
  });
  const outcome = attempt.isError ? "unanswered" : attempt.data;
  const until =
    outcome !== undefined &&
    outcome !== "unanswered" &&
    outcome._tag === "Paused"
      ? outcome.until
      : undefined;
  const now = useNowWhile(until !== undefined);
  const paused = until !== undefined && until > now;
  const problem =
    outcome === undefined ||
    (until !== undefined && !paused) ||
    (outcome !== "unanswered" &&
      (outcome._tag === "SignedIn" || outcome._tag === "AskAgain"))
      ? undefined
      : outcome;

  useEffect(() => field.current?.focus(), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (attempt.isPending || paused) return;
    attempt.mutate(password, {
      onSettled: (settled) => {
        if (settled?._tag === "SignedIn") return;
        field.current?.focus();
        field.current?.select();
      },
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="owner-password">Owner password</Label>
        <Input
          ref={field}
          id="owner-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={
            problem !== undefined &&
            problem !== "unanswered" &&
            problem._tag === "WrongPassword"
          }
          {...(problem === undefined
            ? {}
            : { "aria-describedby": "sign-in-problem" })}
        />
      </div>
      {problem === undefined ? null : <Problem outcome={problem} />}
      <Button type="submit" disabled={attempt.isPending || paused}>
        {attempt.isPending
          ? "Signing in…"
          : paused
            ? `Sign in again in ${span(until - now)}`
            : "Sign in"}
      </Button>
    </form>
  );
}

function PasskeySignIn({
  primary,
  password,
}: {
  readonly primary: boolean;
  readonly password: boolean;
}) {
  const browser = usePasskeys();
  const attempt = useApiMutation(
    (_: undefined) => signInWithPasskey(browser),
    async (outcome, queries) => {
      if (outcome._tag === "SignedIn") await readMeAgain(queries);
      if (outcome._tag === "AskAgain") await askWaysInAgain(queries);
    },
  );
  const outcome = attempt.isError ? "unanswered" : attempt.data;
  const again = () => attempt.mutate(undefined);
  const tryAgain = (
    <AlertAction>
      <Button variant="outline" size="sm" type="button" onClick={again}>
        <RotateCw data-icon="inline-start" /> Try again
      </Button>
    </AlertAction>
  );

  if (outcome === "unanswered") {
    return (
      <Alert variant="danger">
        <CircleAlert />
        <Unanswered action="try again" />
        {tryAgain}
      </Alert>
    );
  }
  switch (outcome?._tag) {
    case "NotAccepted":
      return (
        <Alert variant="danger">
          <CircleAlert />
          <AlertTitle>The passkey was not accepted.</AlertTitle>
          <AlertDescription>
            {password
              ? "Try it again, or sign in with the owner password."
              : "Try it again with a passkey made for this hub at this address."}
          </AlertDescription>
          {tryAgain}
        </Alert>
      );
    case "Failed":
      return (
        <Alert variant="danger">
          <CircleAlert />
          <AlertTitle>The browser did not sign in with a passkey.</AlertTitle>
          <AlertDescription>{outcome.message}</AlertDescription>
          {tryAgain}
        </Alert>
      );
    case "Refused":
      return (
        <Alert variant="danger">
          <CircleAlert />
          <AlertTitle>The hub could not sign in the owner.</AlertTitle>
          <AlertDescription>
            {outcome.title} Try again; if it keeps failing, the hub's log says
            why.
          </AlertDescription>
          {tryAgain}
        </Alert>
      );
    case "NotHere":
      return (
        <Note>
          This address cannot have a passkey: {elsewhere}, and this page is at{" "}
          {browser.address}.
        </Note>
      );
    default:
      return (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant={primary ? "default" : "outline"}
            disabled={attempt.isPending || outcome?._tag === "SignedIn"}
            onClick={again}
          >
            <KeyRound data-icon="inline-start" />
            {attempt.isPending
              ? "Waiting for the browser…"
              : "Sign in with a passkey"}
          </Button>
          {outcome?._tag === "Cancelled" ? (
            <Note role="status">
              No passkey was given: the browser's prompt was closed.
            </Note>
          ) : null}
        </div>
      );
  }
}

function Door({ children }: { readonly children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <Mark size="lg" />
          <CardHeader>
            <CardTitle
              // biome-ignore lint/a11y/useHeadingContent: CardTitle gives the heading its children
              render={<h1 />}
            >
              Cota
            </CardTitle>
            <CardDescription>
              Sign in to read this hub's pools, quota windows and request log.
            </CardDescription>
          </CardHeader>
        </div>
        {children}
      </Card>
    </main>
  );
}

/**
 * The sign-in screen, shown in place of every screen while nobody is signed
 * in: it asks the hub how the owner signs in, and offers only the ways that
 * work in this browser at this address.
 */
export function SignIn() {
  const ways = useWaysIn();
  const browser = usePasskeys();
  if (ways.data === undefined) {
    if (!ways.isError) return null;
    return (
      <Door>
        <Alert variant="danger">
          <CircleAlert />
          <Unanswered action="try again" />
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              disabled={ways.isFetching}
              onClick={() => ways.refetch()}
            >
              <RotateCw data-icon="inline-start" /> Try again
            </Button>
          </AlertAction>
        </Alert>
      </Door>
    );
  }
  const door = doorOf(ways.data, browser.offered);
  if (door._tag === "SetUp") return <Navigate to="/setup" replace />;
  return (
    <Door>
      {door.password ? <PasswordForm /> : null}
      {door.password && door.passkey ? <OrRule /> : null}
      {door.passkey ? (
        <PasskeySignIn primary={!door.password} password={door.password} />
      ) : null}
      {door.passkeyElsewhere ? (
        <Alert>
          <KeyRound />
          <AlertTitle>This hub is signed in to with a passkey only.</AlertTitle>
          <AlertDescription>
            This browser cannot use one here: {elsewhere}, and this page is at{" "}
            {browser.address}. Open the dashboard at the address the passkey was
            made at.
          </AlertDescription>
        </Alert>
      ) : null}
    </Door>
  );
}
