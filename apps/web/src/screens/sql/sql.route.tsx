import { createFileRoute } from "@tanstack/react-router";
import { validateSearch } from "./search.ts";
import { Sql } from "./sql.tsx";

export const Route = createFileRoute("/sql")({
  validateSearch,
  component: Sql,
});
