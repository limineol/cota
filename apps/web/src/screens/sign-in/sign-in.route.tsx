import { createFileRoute, Navigate } from "@tanstack/react-router";

function SignedIn() {
  return <Navigate to="/" replace />;
}

export const Route = createFileRoute("/sign-in")({ component: SignedIn });
