// Import the web components from opentp-ui lib build
import "../../../ui/dist/lib/opentp-ui.js";
import "../../../ui/dist/lib/opentp-platform.js";

// ── DOM refs ──────────────────────────────────────────
const mount = document.getElementById("mount")!;
const modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
const roleSelect = document.getElementById("role-select") as HTMLSelectElement;
const accentSelect = document.getElementById("accent-select") as HTMLSelectElement;
const defaultModeSelect = document.getElementById("defaultmode-select") as HTMLSelectElement;
const btnApply = document.getElementById("btn-apply")!;
const infoBox = document.getElementById("info-box")!;

// ── Info descriptions ─────────────────────────────────
const INFO: Record<string, string> = {
  a: `<strong>Mode A</strong> — Plain &lt;opentp-viewer&gt; with API source (Web App on :3001). Full editing works. No platform provider, no roles, no user menu.`,
  b: `<strong>Mode B</strong> — Single app &lt;opentp-platform&gt; with API source. Full editing, role-based access, user info, branding. Switch roles to see buttons appear/disappear.`,
  c: `<strong>Mode C</strong> — Multi-app platform with two API sources (Web :3001, Mobile :3002). App switcher, role-based UI, user menu, branding. Both apps are fully editable.`,
};

// ── Render functions ──────────────────────────────────

function renderModeA() {
  mount.innerHTML = "";
  const el = document.createElement("opentp-viewer");
  // API source — proxied by Vite to CLI serve on :3001
  el.setAttribute("api", "/web");
  el.setAttribute("mode", defaultModeSelect.value);
  mount.appendChild(el);
}

function renderModeB() {
  mount.innerHTML = "";
  const role = roleSelect.value;
  const accent = accentSelect.value;
  const defaultMode = defaultModeSelect.value;

  const el = document.createElement("opentp-platform");
  el.setAttribute("source", JSON.stringify({ type: "api", baseUrl: "/web" }));
  el.setAttribute("role", role);
  el.setAttribute("default-mode", defaultMode);
  el.setAttribute("user", JSON.stringify({ name: "Jane Doe" }));
  el.setAttribute("branding", JSON.stringify({
    title: "Acme Analytics",
    accentColor: accent,
  }));
  mount.appendChild(el);
}

function renderModeC() {
  mount.innerHTML = "";
  const role = roleSelect.value;
  const accent = accentSelect.value;
  const defaultMode = defaultModeSelect.value;

  const el = document.createElement("opentp-platform");
  el.setAttribute("apps", JSON.stringify([
    {
      id: "web",
      name: "Web App",
      description: "Browser tracking plan (4 events)",
      icon: "\uD83C\uDF10",
      source: { type: "api", baseUrl: "/web" },
    },
    {
      id: "mobile",
      name: "Mobile App",
      description: "iOS & Android tracking plan (4 events)",
      icon: "\uD83D\uDCF1",
      source: { type: "api", baseUrl: "/mobile" },
    },
  ]));
  el.setAttribute("role", role);
  el.setAttribute("default-mode", defaultMode);
  el.setAttribute("user", JSON.stringify({ name: "Alex Admin" }));
  el.setAttribute("branding", JSON.stringify({
    title: "Platform Playground",
    accentColor: accent,
  }));
  mount.appendChild(el);
}

// ── Wiring ────────────────────────────────────────────

const renderers: Record<string, () => void> = {
  a: renderModeA,
  b: renderModeB,
  c: renderModeC,
};

function render() {
  const mode = modeSelect.value;
  infoBox.innerHTML = INFO[mode] ?? "";
  renderers[mode]();
}

btnApply.addEventListener("click", render);
modeSelect.addEventListener("change", render);

// Initial render
render();
