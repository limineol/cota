import { createFileRoute } from "@tanstack/react-router";
import { useMe } from "#shared/sign-in.ts";
import { OwnerPassword } from "./owner-password.tsx";
import { Passkeys } from "./passkeys.tsx";
import { SignIns } from "./sign-ins.tsx";

function SignInsPart() {
  const me = useMe();
  const owner = me.data?.caller === "owner";
  return (
    <div className="flex flex-col gap-5">
      <OwnerPassword owner={owner} />
      <Passkeys owner={owner} />
      <SignIns owner={owner} />
    </div>
  );
}

export const Route = createFileRoute("/settings/sign-ins")({
  component: SignInsPart,
});
