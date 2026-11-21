import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useMe } from "#shared/sign-in.ts";
import { Names } from "./names.tsx";
import { validateSearch } from "./search.ts";

function NamesPart() {
  const search = useSearch({ from: "/settings/names" });
  const navigate = useNavigate({ from: "/settings/names" });
  const me = useMe();
  return (
    <Names
      owner={me.data?.caller === "owner"}
      kind={search.kind ?? "pool"}
      filter={search.filter ?? ""}
      onKindChange={(kind) =>
        navigate({
          search: kind === "pool" ? {} : { kind },
          replace: true,
          resetScroll: false,
        })
      }
      onFilterChange={(filter) =>
        navigate({
          search: ({ filter: _filter, ...rest }) =>
            filter === "" ? rest : { ...rest, filter },
          replace: true,
          resetScroll: false,
        })
      }
    />
  );
}

export const Route = createFileRoute("/settings/names")({
  validateSearch,
  component: NamesPart,
});
