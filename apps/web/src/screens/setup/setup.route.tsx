import { createFileRoute } from "@tanstack/react-router";
import { Setup } from "./setup.tsx";

export const Route = createFileRoute("/setup")({ component: Setup });
