import { Api } from "@cota/hub/api";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@cota/ui/components/alert";
import { Button } from "@cota/ui/components/button";
import { Card } from "@cota/ui/components/card";
import { FieldNote } from "@cota/ui/components/field-note";
import { FieldRule } from "@cota/ui/components/field-rule";
import {
  Guide,
  GuideLead,
  GuideTitle,
  GuideWords,
} from "@cota/ui/components/guide";
import { Input } from "@cota/ui/components/input";
import { Label } from "@cota/ui/components/label";
import {
  LogLine,
  LogLineMark,
  LogLinePrefix,
} from "@cota/ui/components/log-line";
import { Note } from "@cota/ui/components/note";
import { Step, Steps } from "@cota/ui/components/steps";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { HttpApiClient } from "effect/http-api";
import { CircleAlert, Clock as ClockIcon, RotateCw } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { type Client, useApiMutation } from "#shared/api.ts";
import { longest, newPasswordOf } from "#shared/domain/new-password.ts";
import { span } from "#shared/domain/quantities.ts";
import { codeLength, setupCodeOf } from "#shared/domain/setup-code.ts";
import { passwordRule } from "#shared/password-rule.ts";
import { pausedUntil, untilText, useNowWhile } from "#shared/paused.ts";
import { askWaysInAgain, readMeAgain, useWaysIn } from "#shared/sign-in.ts";
import { counted } from "#shared/words.ts";

type Outcome =
  | { readonly _tag: "SetUp" }
  | { readonly _tag: "WrongSetupCode"; readonly code: string }
  | { readonly _tag: "Paused"; readonly until: number }
  | { readonly _tag: "AlreadySetUp" }
  | { readonly _tag: "Refused"; readonly title: string };

const decodeSetUp = HttpApiClient.decodeResponse(Api, {
  group: "sign-in",
  endpoint: "setUp",
});

const setUp =
  ({ code, password }: { readonly code: string; readonly password: string }) =>
  (client: Client): Effect.Effect<Outcome, unknown> =>
    Effect.gen(function* () {
      const response = yield* client["sign-in"].setUp({
        payload: { code, password },
        responseMode: "response-only",
      });
      return yield* decodeSetUp(response).pipe(
        Effect.as<Outcome>({ _tag: "SetUp" }),
        Effect.catchTag("WrongSetupCode", () =>
          Effect.succeed<Outcome>({ _tag: "WrongSetupCode", code }),
        ),
        Effect.catchTag("AlreadySetUp", () =>
          Effect.succeed<Outcome>({ _tag: "AlreadySetUp" }),
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

const whereTheLogIs =
  "The terminal that runs the hub shows its log, or its container's log does.";

function Words({
  code,
  password,
}: {
  readonly code: "done" | "current" | "refused";
  readonly password: "done" | "current" | "ahead";
}) {
  return (
    <GuideWords>
      <GuideTitle>Set up this hub</GuideTitle>
      <GuideLead>
        This hub has no owner yet. Prove it is yours with the setup code it
        printed, and choose the owner password.
      </GuideLead>
      <Steps>
        <Step
          number={1}
          state={code}
          title="Find the setup code in the hub's log"
        >
          <LogLine refused={code === "refused"} caption={whereTheLogIs}>
            <LogLinePrefix>[09:14:02.318] INFO (#1):</LogLinePrefix> this hub is
            not set up: open its dashboard, give it the setup code{" "}
            <LogLineMark>XXXX-XXXX-XXXX</LogLineMark> and choose the owner
            password
          </LogLine>
        </Step>
        <Step number={2} state={password} title="Choose the owner password">
          <Note>12 characters or more. It signs you in on any browser.</Note>
        </Step>
        <Step
          number={3}
          state="ahead"
          title="You are signed in on this browser for 30 days"
        />
      </Steps>
    </GuideWords>
  );
}

function Unanswered({
  retrying,
  onRetry,
}: {
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <Alert variant="danger">
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
          type="button"
          disabled={retrying}
          onClick={onRetry}
        >
          <RotateCw data-icon="inline-start" /> Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

function SetupForm() {
  const navigate = useNavigate();
  const codeField = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const code = setupCodeOf(typed);
  const chosen = newPasswordOf(password);
  const send = useApiMutation(setUp, async (outcome, queries) => {
    if (outcome._tag !== "SetUp") return;
    await readMeAgain(queries);
    await navigate({ to: "/" });
  });
  const queries = useQueryClient();
  const toSignIn = async () => {
    await askWaysInAgain(queries);
    await navigate({ to: "/sign-in", replace: true });
  };
  const outcome = send.data;
  const until = outcome?._tag === "Paused" ? outcome.until : undefined;
  const now = useNowWhile(until !== undefined);
  const paused = until !== undefined && until > now;
  const refusedCode =
    outcome?._tag === "WrongSetupCode" && outcome.code === code.code;
  const codeProblem = refusedCode
    ? "That is not this hub's setup code. It is in the hub's log, printed when it started; a restart makes a new one."
    : tried && !code.complete
      ? `A setup code has ${codeLength} characters; this one has ${counted(code.code.length)}, so it was not sent.`
      : null;

  useEffect(() => codeField.current?.focus(), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!code.complete || !chosen.fits || send.isPending || paused) return;
    send.mutate(
      { code: code.code, password },
      {
        onSettled: (settled) => {
          if (settled?._tag === "WrongSetupCode") {
            codeField.current?.focus();
            codeField.current?.select();
          }
        },
      },
    );
  };

  const problem = () => {
    if (send.isError) {
      return (
        <Alert variant="danger">
          <CircleAlert />
          <AlertTitle>The hub did not answer.</AlertTitle>
          <AlertDescription>
            Check that it is running and reachable from this browser, then set
            it up again.
          </AlertDescription>
        </Alert>
      );
    }
    switch (outcome?._tag) {
      case "Paused":
        return paused ? (
          <Alert>
            <ClockIcon />
            <AlertTitle>
              Setting up is paused until {untilText(until)}.
            </AlertTitle>
            <AlertDescription>
              Too many wrong setup codes were given in the last 10 minutes.
            </AlertDescription>
          </Alert>
        ) : null;
      case "AlreadySetUp":
        return (
          <Alert>
            <CircleAlert />
            <AlertTitle>This hub is set up already.</AlertTitle>
            <AlertDescription>
              Its owner password was chosen meanwhile, from another browser.
            </AlertDescription>
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={toSignIn}
              >
                Sign in
              </Button>
            </AlertAction>
          </Alert>
        );
      case "Refused":
        return (
          <Alert variant="danger">
            <CircleAlert />
            <AlertTitle>The hub could not be set up.</AlertTitle>
            <AlertDescription>
              {outcome.title} Set it up again; if it keeps failing, the hub's
              log says why.
            </AlertDescription>
          </Alert>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Words
        code={refusedCode ? "refused" : code.complete ? "done" : "current"}
        password={chosen.fits ? "done" : code.complete ? "current" : "ahead"}
      />
      <Card>
        <form
          className="flex flex-col gap-4"
          aria-label="Set up this hub"
          onSubmit={submit}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-code">Setup code</Label>
            <Input
              ref={codeField}
              id="setup-code"
              name="code"
              code
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              value={code.written}
              onChange={(event) => setTyped(event.target.value)}
              aria-invalid={codeProblem !== null}
              {...(codeProblem === null
                ? {}
                : { "aria-describedby": "setup-code-problem" })}
            />
            {codeProblem === null ? null : (
              <FieldNote id="setup-code-problem" tone="danger">
                {codeProblem}
              </FieldNote>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="owner-password">Owner password</Label>
            <Input
              id="owner-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={tried && !chosen.fits}
              aria-describedby="owner-password-rule"
            />
            <FieldRule
              id="owner-password-rule"
              met={chosen.fits}
              refused={tried || chosen.length > longest}
            >
              {passwordRule(chosen, tried)}
            </FieldRule>
          </div>
          {problem()}
          <Button type="submit" disabled={send.isPending || paused}>
            {send.isPending
              ? "Setting up…"
              : paused
                ? `Set up again in ${span(until - now)}`
                : "Set up the hub"}
          </Button>
        </form>
      </Card>
    </>
  );
}

/** The first screen of a hub that is not set up: the steps on the left, the setup code and the owner password on the right. */
export function Setup() {
  const ways = useWaysIn();
  if (ways.data === undefined) {
    if (!ways.isError) return null;
    return (
      <Guide>
        <Words code="current" password="ahead" />
        <Card>
          <Unanswered
            retrying={ways.isFetching}
            onRetry={() => ways.refetch()}
          />
        </Card>
      </Guide>
    );
  }
  if (ways.data.setUp) return <Navigate to="/sign-in" replace />;
  return (
    <Guide>
      <SetupForm />
    </Guide>
  );
}
