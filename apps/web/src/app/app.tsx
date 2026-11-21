import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "#shared/theme.tsx";
import { makeQueryClient } from "./query-client.ts";
import { makeRouter } from "./router.tsx";

const queryClient = makeQueryClient({ retry: true });
const router = makeRouter();

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
