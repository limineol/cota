import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "./settings.tsx";

export const Route = createFileRoute("/settings")({
  component: Settings,
});
