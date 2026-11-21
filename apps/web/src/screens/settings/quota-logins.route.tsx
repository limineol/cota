import { createFileRoute } from "@tanstack/react-router";
import { useMe } from "#shared/sign-in.ts";
import { QuotaLogins } from "./quota-logins.tsx";

function QuotaLoginsPart() {
  const me = useMe();
  return <QuotaLogins owner={me.data?.caller === "owner"} />;
}

export const Route = createFileRoute("/settings/quota-logins")({
  component: QuotaLoginsPart,
});
