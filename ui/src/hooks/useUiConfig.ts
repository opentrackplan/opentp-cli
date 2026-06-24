import { useState, useEffect } from "react";
import { useTheme } from "./useTheme";
import { Modes } from "../types";
import type { UIMode } from "../types";

export interface UiConfig {
  theme: "dark" | "light" | "auto";
  mode: UIMode;
  title: string;
}

const DEFAULT_CONFIG: UiConfig = {
  theme: "auto",
  mode: Modes.VIEWER,
  title: "",
};

export function useUiConfig(baseUrl: string): UiConfig {
  const [config, setConfig] = useState<UiConfig>(DEFAULT_CONFIG);
  const { setTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;

    async function fetchConfig() {
      try {
        const res = await fetch(`${baseUrl}/api/config`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const ui = data.spec?.ui;
        const infoTitle = data.info?.title ?? "";

        const resolved: UiConfig = {
          theme: ui?.theme ?? "auto",
          mode: ui?.mode ?? Modes.VIEWER,
          title: ui?.title ?? infoTitle,
        };

        setConfig(resolved);

        // Apply theme
        if (resolved.theme === "auto") {
          // Let the existing theme detection handle it (localStorage or system pref)
        } else {
          setTheme(resolved.theme);
        }
      } catch {
        // Silently ignore — defaults apply
      }
    }

    fetchConfig();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, setTheme]);

  return config;
}
