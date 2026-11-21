import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { SignIn } from "#screens/sign-in/sign-in.tsx";
import { useMe } from "#shared/sign-in.ts";
import { Shell } from "./shell.tsx";
import { Unanswered } from "./unanswered.tsx";

function Root() {
  const me = useMe();
  const path = useRouterState({ select: (state) => state.location.pathname });
  if (path === "/setup") return <Outlet />;
  if (me.data === undefined) {
    if (me.isError) {
      return (
        <Unanswered retrying={me.isFetching} onRetry={() => me.refetch()} />
      );
    }
    return null;
  }
  if (me.data === null || me.data.caller !== "owner") return <SignIn />;
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

export const Route = createRootRoute({ component: Root });
