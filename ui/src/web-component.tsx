import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { Modes } from "./types";
import type { DataSource, UIMode, OpenTPUIOptions } from "./types";
import { ThemeProvider } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";

// Import Tailwind styles as a string for Shadow DOM injection
import styles from "./styles/index.css?inline";

class OpenTPViewer extends HTMLElement {
  private _root: Root | null = null;
  private _mountPoint: HTMLDivElement | null = null;

  static get observedAttributes() {
    return ["src", "api", "mode", "options"];
  }

  connectedCallback() {
    const shadow = this.attachShadow({ mode: "open" });

    // Inject Tailwind styles into shadow root
    const styleEl = document.createElement("style");
    styleEl.textContent = styles;
    shadow.appendChild(styleEl);

    // Create mount point
    this._mountPoint = document.createElement("div");
    this._mountPoint.style.height = "100%";
    shadow.appendChild(this._mountPoint);

    this._root = createRoot(this._mountPoint);
    this._render();
  }

  disconnectedCallback() {
    this._root?.unmount();
  }

  attributeChangedCallback() {
    this._render();
  }

  private _render() {
    if (!this._root) return;

    const source = this._getDataSource();
    const mode =
      (this.getAttribute("mode") as UIMode) || Modes.VIEWER;

    const optionsAttr = this.getAttribute("options");
    let options: OpenTPUIOptions | undefined;
    if (optionsAttr) {
      try {
        options = JSON.parse(optionsAttr);
      } catch {
        console.warn("[opentp-ui] Invalid options JSON:", optionsAttr);
      }
    }

    this._root.render(
      <ThemeProvider>
        <I18nProvider>
          <App source={source} mode={mode} options={options} />
        </I18nProvider>
      </ThemeProvider>
    );
  }

  private _getDataSource(): DataSource {
    const api = this.getAttribute("api");
    if (api) return { type: "api", baseUrl: api };

    const src = this.getAttribute("src");
    if (src) return { type: "json-url", url: src };

    // Default: try same-origin API
    return { type: "api", baseUrl: "" };
  }
}

if (!customElements.get("opentp-viewer")) {
  customElements.define("opentp-viewer", OpenTPViewer);
}
