import { createFileRoute } from "@tanstack/react-router";
import { validateSearch } from "#shared/sessions-search.ts";
import { Sessions } from "./sessions.tsx";

export const Route = createFileRoute("/sessions")({
  validateSearch,
  component: Sessions,
});
