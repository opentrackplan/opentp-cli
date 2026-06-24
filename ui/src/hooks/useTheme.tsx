import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function detectTheme(): Theme {
  const saved = localStorage.getItem("opentp-theme") as Theme | null;
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/** Apply data-theme to document root and, if inside Shadow DOM, to the shadow mount point. */
function applyThemeToDOM(theme: Theme, probeEl: HTMLElement | null) {
  // Standalone mode: set on <html>
  document.documentElement.setAttribute("data-theme", theme);

  // Shadow DOM: set on the mount point div so [data-theme] selectors match inside the shadow tree
  if (probeEl) {
    const root = probeEl.getRootNode();
    if (root instanceof ShadowRoot) {
      for (const child of Array.from(root.children)) {
        if (child instanceof HTMLElement && child.tagName !== "STYLE") {
          child.setAttribute("data-theme", theme);
        }
      }
    }
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(detectTheme);
  const probeRef = useRef<HTMLDivElement>(null);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("opentp-theme", t);
    applyThemeToDOM(t, probeRef.current);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Set initial theme on mount and whenever theme changes
  useEffect(() => {
    applyThemeToDOM(theme, probeRef.current);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      <div ref={probeRef} style={{ display: "contents" }} data-theme={theme}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
