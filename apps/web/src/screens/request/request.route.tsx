import { createFileRoute } from "@tanstack/react-router";
import { Request } from "./request.tsx";
import { validateSearch } from "./search.ts";

export const Route = createFileRoute("/requests/$id")({
  validateSearch,
  component: Request,
});
