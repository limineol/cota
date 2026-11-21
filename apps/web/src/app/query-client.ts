import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isSignInRequired } from "#shared/api.ts";
import { signedOut } from "#shared/sign-in.ts";

/**
 * The app's cache of answers. Any call that answers 401 marks nobody signed
 * in, which returns the owner to the sign-in screen from wherever it was made.
 */
export const makeQueryClient = ({ retry }: { readonly retry: boolean }) => {
  const endedSignIn = (error: unknown) => {
    if (isSignInRequired(error)) signedOut(queries);
  };
  const queries: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: endedSignIn }),
    mutationCache: new MutationCache({ onError: endedSignIn }),
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          retry && failures < 2 && !isSignInRequired(error),
      },
    },
  });
  return queries;
};
