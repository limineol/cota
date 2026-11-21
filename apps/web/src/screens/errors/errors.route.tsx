import { createFileRoute } from "@tanstack/react-router";
import { Errors } from "./errors.tsx";
import { validateSearch } from "./search.ts";

export const Route = createFileRoute("/errors")({
  validateSearch,
  component: Errors,
});
