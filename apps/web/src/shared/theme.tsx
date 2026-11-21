import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

export type Theme = "system" | "light" | "dark";

/* public/theme.js reads the same key before the first paint, so a reload
   never flashes the other theme. */
const key = "cota-theme";
const darkScheme = "(prefers-color-scheme: dark)";

const isTheme = (value: string | null): value is Theme =>
  value === "system" || value === "light" || value === "dark";

const storedTheme = (): Theme => {
  try {
    const value = localStorage.getItem(key);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
};

export const keepTheme = (theme: Theme) => {
  try {
    localStorage.setItem(key, theme);
  } catch {
    // A browser that refuses storage keeps the choice for this page only.
  }
};

const followSystem = (onChange: () => void) => {
  const query = matchMedia(darkScheme);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const systemIsDark = () => matchMedia(darkScheme).matches;

const ThemeContext = createContext<{
  readonly theme: Theme;
  readonly choose: (theme: Theme) => void;
}>({ theme: "system", choose: () => {} });

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState(storedTheme);
  const dark = useSyncExternalStore(followSystem, systemIsDark);
  const isDark = theme === "dark" || (theme === "system" && dark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const choose = (next: Theme) => {
    keepTheme(next);
    setTheme(next);
  };

  return <ThemeContext value={{ theme, choose }}>{children}</ThemeContext>;
}

export const useTheme = () => use(ThemeContext);
