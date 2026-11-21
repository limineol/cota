import { createFileRoute } from "@tanstack/react-router";
import { validateSearch } from "./search.ts";
import { Session } from "./session.tsx";

export const Route = createFileRoute("/sessions/$session")({
  validateSearch,
  component: Session,
});
