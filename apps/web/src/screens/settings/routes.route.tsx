import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useMe } from "#shared/sign-in.ts";
import { Routes } from "./routes.tsx";
import { validateRoutesSearch } from "./search.ts";

function RoutesPart() {
  const search = useSearch({ from: "/settings/routes" });
  const navigate = useNavigate({ from: "/settings/routes" });
  const me = useMe();
  return (
    <Routes
      owner={me.data?.caller === "owner"}
      client={search.client ?? "claude-code"}
      project={search.project ?? ""}
      onClientChange={(client) =>
        navigate({
          search: ({ client: _client, ...rest }) =>
            client === "claude-code" ? rest : { ...rest, client },
          replace: true,
          resetScroll: false,
        })
      }
      onAsk={(project) =>
        navigate({
          search: ({ project: _project, ...rest }) =>
            project === "" ? rest : { ...rest, project },
          resetScroll: false,
        })
      }
    />
  );
}

export const Route = createFileRoute("/settings/routes")({
  validateSearch: validateRoutesSearch,
  component: RoutesPart,
});
