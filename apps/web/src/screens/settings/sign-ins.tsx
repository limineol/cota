import { Badge } from "@cota/ui/components/badge";
import { Button } from "@cota/ui/components/button";
import { Confirm } from "@cota/ui/components/confirm";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { FieldNote } from "@cota/ui/components/field-note";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFoot,
  ListPanelHead,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { Subheading } from "@cota/ui/components/page";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
  TableSecondary,
} from "@cota/ui/components/table";
import { useId, useState } from "react";
import { useApiMutation } from "#shared/api.ts";
import { ago, span } from "#shared/domain/quantities.ts";
import { userAgentInWords } from "#shared/domain/user-agent.ts";
import { NowProvider, useNow } from "#shared/now.tsx";
import { Problem, problemOf } from "#shared/problem.tsx";
import { counted, millis, plural, when } from "#shared/words.ts";
import { readSignInsAgain, type SignIn, useSignIns } from "./queries.ts";

const skeletonRows = 3;

/** The owner's sign-ins: this browser's first, then the others newest first, each ended in place. */
export function SignIns({ owner }: { readonly owner: boolean }) {
  return (
    <NowProvider>
      <SignInsList owner={owner} />
    </NowProvider>
  );
}

function SignInsList({ owner }: { readonly owner: boolean }) {
  const title = useId();
  const now = useNow();
  const list = useSignIns(owner);
  const [asking, setAsking] = useState(false);
  const [ended, setEnded] = useState<number | null>(null);
  const endOthers = useApiMutation(
    (_: undefined) => (client) => client["sign-in"].revokeOtherSignIns(),
    async (_, queries) => readSignInsAgain(queries),
  );

  if (!owner) {
    return (
      <ListPanel aria-labelledby={title}>
        <ListPanelHead>
          <Subheading level={2} id={title}>
            Sign-ins
          </Subheading>
        </ListPanelHead>
        <ListPanelBody>
          <Empty>
            <EmptyTitle>
              A reader key cannot see the owner's sign-ins.
            </EmptyTitle>
            <EmptyDescription>
              Sign-ins are the owner's alone: sign in with the owner password to
              list the browsers signed in and end them.
            </EmptyDescription>
          </Empty>
        </ListPanelBody>
      </ListPanel>
    );
  }

  const signIns = list.data?.signIns;
  const ordered =
    signIns === undefined
      ? undefined
      : [
          ...signIns.filter((signIn) => signIn.current),
          ...signIns.filter((signIn) => !signIn.current),
        ];
  const others = ordered?.filter((signIn) => !signIn.current).length ?? 0;

  const summary = () => {
    if (ordered === undefined) return null;
    if (others === 0) return "Only this browser is signed in.";
    return `This browser and ${plural(others, "other")}, newest first.`;
  };

  const heading = (
    <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
      <Subheading level={2} id={title}>
        Sign-ins
      </Subheading>
      <Note>
        {ended === null
          ? summary()
          : `${plural(ended, "sign-in")} ended. ${summary() ?? ""}`}
      </Note>
    </div>
  );

  const head = () => {
    if (asking) {
      return (
        <>
          {heading}
          <Confirm
            className="basis-full"
            question={`End the ${plural(others, "other sign-in")}? ${others === 1 ? "That browser signs" : "Those browsers sign"} in again with the owner password to read the hub.`}
            confirm={others === 1 ? "End it" : "End them"}
            cancel={others === 1 ? "Keep it" : "Keep them"}
            pending={endOthers.isPending}
            onCancel={() => setAsking(false)}
            onConfirm={() =>
              endOthers.mutate(undefined, {
                onSuccess: (answer) => {
                  setAsking(false);
                  setEnded(answer.revoked);
                },
                onError: () => setAsking(false),
              })
            }
          />
        </>
      );
    }
    return (
      <>
        {heading}
        {others > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              endOthers.reset();
              setAsking(true);
            }}
          >
            End all others ({counted(others)})
          </Button>
        ) : null}
        {endOthers.isError ? (
          <FieldNote tone="danger" className="basis-full">
            The other sign-ins were not ended: {problemOf(endOthers.error)}
          </FieldNote>
        ) : null}
      </>
    );
  };

  const body = () => {
    if (list.isError) {
      return (
        <Problem
          inside
          title="The hub could not list the sign-ins."
          error={list.error}
          onRetry={() => list.refetch()}
        />
      );
    }
    if (ordered === undefined) {
      return (
        <Table aria-label="Sign-ins loading">
          <SignInsHead />
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
              <SignInSkeleton key={index} />
            ))}
          </TableBody>
        </Table>
      );
    }
    return (
      <Table aria-label="Sign-ins">
        <SignInsHead />
        <TableBody>
          {ordered.map((signIn) => (
            <SignInItem key={signIn.id} signIn={signIn} now={now} />
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <ListPanel aria-labelledby={title}>
      <ListPanelHead className="min-h-13 items-center">
        {list.isError ? heading : head()}
      </ListPanelHead>
      <ListPanelBody>{body()}</ListPanelBody>
      <ListPanelFoot>
        <span>
          {ordered === undefined ? null : plural(ordered.length, "sign-in")}
        </span>
        <Note>A sign-in lasts 30 days from when it was made.</Note>
      </ListPanelFoot>
    </ListPanel>
  );
}

function SignInsHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">Browser</TableHead>
        <TableHead scope="col" numeric from="md">
          Signed in
        </TableHead>
        <TableHead scope="col" numeric from="md">
          Last used
        </TableHead>
        <TableHead scope="col" numeric from="lg">
          Expires
        </TableHead>
        <TableHead scope="col">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function SignInItem({
  signIn,
  now,
}: {
  readonly signIn: SignIn;
  readonly now: number;
}) {
  const end = useApiMutation(
    (_: undefined) => (client) =>
      client["sign-in"].revokeSignIn({ params: { id: signIn.id } }),
    async (_, queries) => readSignInsAgain(queries),
  );
  const words = userAgentInWords(signIn.userAgent) ?? "An unknown browser";
  const created = millis(signIn.createdAt);
  const used = millis(signIn.lastUsedAt);
  const expires = millis(signIn.expiresAt);
  return (
    <TableRow>
      <TableCell className="w-full max-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <TableLabel title={signIn.userAgent}>{words}</TableLabel>
          {signIn.current ? <Badge>This browser</Badge> : null}
        </span>
        <TableSecondary
          title={signIn.userAgent}
          className="hidden @2xl/panel:block"
        >
          {signIn.userAgent === ""
            ? "No user agent was sent"
            : signIn.userAgent}
        </TableSecondary>
        <TableSecondary className="@2xl/panel:hidden">
          Signed in {when(created, now)} · used {ago(now - used)}
        </TableSecondary>
        {end.isError ? (
          <FieldNote tone="danger">Not ended: {problemOf(end.error)}</FieldNote>
        ) : null}
      </TableCell>
      <TableCell numeric from="md">
        {when(created, now)}
      </TableCell>
      <TableCell numeric from="md">
        <span title={when(used, now)}>{ago(now - used)}</span>
      </TableCell>
      <TableCell numeric from="lg">
        <span title={when(expires, now)}>in {span(expires - now)}</span>
      </TableCell>
      <TableCell numeric className="w-28 min-w-32">
        {signIn.current ? (
          <Note>Sign out ends it</Note>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={end.isPending}
            aria-label={`End the sign-in of ${words}, last used ${ago(now - used)}`}
            onClick={() => end.mutate(undefined)}
          >
            {end.isPending ? "Ending…" : "End"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function SignInSkeleton() {
  return (
    <TableRow aria-hidden="true">
      <TableCell className="w-full max-w-0">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="mt-2 w-3/5" />
      </TableCell>
      <TableCell numeric from="md">
        <Skeleton className="ml-auto w-20" />
      </TableCell>
      <TableCell numeric from="md">
        <Skeleton className="ml-auto w-14" />
      </TableCell>
      <TableCell numeric from="lg">
        <Skeleton className="ml-auto w-14" />
      </TableCell>
      <TableCell numeric className="w-28" />
    </TableRow>
  );
}
