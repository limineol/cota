import { createContext, type ReactNode, use, useEffect, useState } from "react";

const Now = createContext<number>(0);

/** The time, in milliseconds since the epoch, for the countdowns below it; it ticks once a second. */
export function NowProvider({ children }: { readonly children: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <Now value={now}>{children}</Now>;
}

export const useNow = () => use(Now);
