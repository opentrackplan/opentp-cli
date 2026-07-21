import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { checkApiHealth } from "./api/client";
import { Modes } from "./types";
import type { DataSource } from "./types";
import { ThemeProvider } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";
import { useUiConfig } from "./hooks/useUiConfig";
import "./styles/index.css";

function Root({ source }: { source: DataSource }) {
  const baseUrl = source.type === "api" ? source.baseUrl : null;
  const uiConfig = useUiConfig(baseUrl !== null ? baseUrl : "");
  const defaultMode =
    baseUrl !== null && uiConfig.mode ? uiConfig.mode : (source.type === "api" ? Modes.EDITOR : Modes.VIEWER);

  return <App source={source} mode={defaultMode} />;
}

async function init() {
  // Try to connect to local opentp serve API (proxied by Vite in dev)
  const apiAvailable = await checkApiHealth("");

  const source: DataSource = apiAvailable
    ? { type: "api", baseUrl: "" }
    : { type: "json-url", url: "/sample-data.json" };

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <Root source={source} />
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

init();
