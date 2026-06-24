# OpenTrackPlan UI

> **OpenTrackPlan** is an open-source system for managing analytics tracking plans.
> Define events in YAML → validate → generate typed SDKs → send to GA4, Snowplow, and more.
>
> [Spec](https://github.com/opentrackplan/opentp-spec) •
> [CLI](https://github.com/opentrackplan/opentp-cli) •
> [UI](https://github.com/opentrackplan/opentp-ui) •
> [SDK](https://github.com/opentrackplan/opentp-sdk)

Web UI for browsing and editing OpenTrackPlan tracking plans. Works as a standalone app, embeddable Web Component, or multi-app platform with role-based access control.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/opentrackplan/opentp-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/opentrackplan/opentp-ui/actions/workflows/ci.yml)

![OpenTrackPlan UI Screenshot](docs/screenshot.png)

## Features

- **Browse events** with hierarchical tree navigation (auto-detected or custom grouping)
- **Search** by event name, taxonomy, or field names
- **View payload schemas** with type badges, PII indicators, enum values, required/optional markers
- **Auto-generated SDK usage examples** for TypeScript, Swift, Kotlin
- **Editor mode**: create, edit, and delete events visually
- **Dictionary management**: create, edit, and delete reusable enum dictionaries
- **Form ↔ YAML preview** toggle for editors
- **Lifecycle support**: active, deprecated, and draft event statuses
- **Export panel**: download generated SDKs, bundle as ZIP
- **Live reload** via WebSocket when files change
- **Dark / Light theme** toggle
- **EN / RU localization** with auto-detection
- **Embeddable as Web Component** for documentation sites
- **Platform mode**: multi-app support with app switcher, branding, and user menu
- **Role-based access control**: viewer, editor, admin roles with customizable permissions

## Quick Start

### 1. Start the API server

```bash
cd opentp-cli
opentp serve --root ./my-tracking-plan --port 3000
```

### 2. Start the UI

```bash
cd opentp-ui
bun install
bun run dev
```

### 3. Open http://localhost:5173

The dev server proxies `/api` and `/ws` to `http://localhost:3000` automatically.

### Docker (easiest)

```bash
docker compose up   # builds all, serves on :3000, mounts example-plan/
```

## Usage Modes

The UI supports three usage modes:

| Mode | Component | Auth | Apps | Description |
|------|-----------|------|------|-------------|
| A | `<App>` / `<opentp-viewer>` | None | Single | Default — zero config, everyone can edit |
| B | `<OpenTPPlatform>` | Role prop | Single | Single app with role-based rendering + user display |
| C | `<OpenTPPlatform>` | Role prop | Multi | App switcher + roles + branding |

### Mode A — Simple viewer/editor (default)

```tsx
import { App } from "@opentp/ui";

<App source={{ type: "api", baseUrl: "/api" }} mode="editor" />
```

### Mode B — Single app with roles

```tsx
import { OpenTPPlatform } from "@opentp/ui";

<OpenTPPlatform
  source={{ type: "api", baseUrl: "/api" }}
  role={user.role}
  user={{ name: "Jane", avatar: "/jane.jpg" }}
  onLogout={() => auth.logout()}
/>
```

### Mode C — Multi-app platform

```tsx
import { OpenTPPlatform } from "@opentp/ui";

<OpenTPPlatform
  apps={[
    { id: "web", name: "Web App", source: { type: "api", baseUrl: "/api/web" } },
    { id: "mobile", name: "Mobile", source: { type: "api", baseUrl: "/api/mobile" } },
  ]}
  role={user.role}
  user={{ name: "Jane" }}
  onLogout={() => auth.logout()}
  branding={{ title: "Acme Analytics", logo: "/logo.svg", accentColor: "indigo" }}
  onAppChange={(appId) => router.push(`/apps/${appId}`)}
/>
```

## Embedding as Web Component

Embed the OpenTrackPlan UI in any webpage as a custom element.

### Load the library

```html
<!-- From CDN -->
<script type="module" src="https://unpkg.com/@opentp/ui/dist/lib/opentp-ui.es.js"></script>

<!-- Or self-hosted -->
<script type="module" src="/path/to/opentp-ui.es.js"></script>
```

### `<opentp-viewer>` — Simple viewer/editor

```html
<!-- Viewer mode (read-only) -->
<opentp-viewer
  api="http://localhost:3000"
  mode="viewer"
  style="height: 600px;"
></opentp-viewer>

<!-- Editor mode with custom tree grouping -->
<opentp-viewer
  api="http://localhost:3000"
  mode="editor"
  options='{"treeLevels":["area"]}'
  style="height: 100vh;"
></opentp-viewer>

<!-- Static JSON (no server) -->
<opentp-viewer
  src="/tracking-plan.json"
></opentp-viewer>
```

#### `<opentp-viewer>` Attributes

| Attribute | Description | Default |
|-----------|-------------|---------|
| `api` | URL of opentp serve API | (required if no `src`) |
| `src` | URL of static JSON file | (required if no `api`) |
| `mode` | `viewer` or `editor` | `viewer` |
| `options` | JSON string of UI options (e.g. `{"treeLevels":["area"]}`) | `{}` |

### `<opentp-platform>` — Platform with roles and multi-app

```html
<!-- Attributes only -->
<opentp-platform
  role="editor"
  source='{"type":"api","baseUrl":"/api"}'
  user='{"name":"Jane"}'
  branding='{"title":"Acme Analytics","accentColor":"indigo"}'
></opentp-platform>

<!-- Config URL (server returns role + apps based on session) -->
<opentp-platform config="/api/platform-config"></opentp-platform>

<!-- Multi-app -->
<opentp-platform
  role="admin"
  apps='[{"id":"web","name":"Web","source":{"type":"api","baseUrl":"/api/web"}}]'
></opentp-platform>
```

#### `<opentp-platform>` Attributes

| Attribute | Description | Default |
|-----------|-------------|---------|
| `config` | URL to fetch platform config JSON | — |
| `role` | `viewer`, `editor`, or `admin` | `editor` |
| `source` | JSON `DataSource` (single-app) | — |
| `apps` | JSON array of `AppDefinition[]` (multi-app) | — |
| `user` | JSON `{ name, avatar? }` | — |
| `branding` | JSON `{ title?, logo?, accentColor?, favicon? }` | — |
| `permissions` | JSON permission overrides | — |
| `default-mode` | `viewer` or `editor` | `viewer` |
| `options` | JSON string of UI options | `{}` |

When using `config`, attributes always override the fetched config values.

## Role-Based Access Control

Three roles with hierarchical permissions: **viewer** < **editor** < **admin**.

### Default permission matrix

| Action | Minimum role |
|--------|-------------|
| View events, search, export | `viewer` |
| Create/edit events, manage dictionaries, switch mode | `editor` |
| Delete events, delete dictionaries | `admin` |

### Customization

```tsx
// Override specific actions
<OpenTPPlatform permissions={{ deleteEvent: "editor" }} />

// Full control via callback (wins over permissions)
<OpenTPPlatform authorize={(role, action, context) => {
  if (context?.appId === "prod") return role === "admin";
  return role !== "viewer";
}} />
```

Auth is fully external — the UI never manages login or sessions. Pass `role` from your auth system.

## Static Mode (No Server)

Use the UI without running the API server by exporting your tracking plan as JSON.

### 1. Export your plan

```bash
cd opentp-cli
opentp generate json --root ./my-plan --output ./public/plan.json
```

### 2. Embed the viewer

```html
<opentp-viewer src="/plan.json"></opentp-viewer>
```

This is perfect for:
- Documentation sites (Docusaurus, VitePress, etc.)
- Internal wikis
- GitHub Pages
- Any static hosting

## Development

### Install dependencies

```bash
bun install
```

### Run development server

```bash
bun run dev
```

Starts Vite dev server at `http://localhost:5173` with proxy to CLI serve on `:3000`.

### Build SPA

```bash
bun run build
```

Builds the standalone single-page application to `dist/`.

### Build Web Component library

```bash
BUILD_LIB=1 bun run build:lib
```

Builds both `<opentp-viewer>` and `<opentp-platform>` Web Components to `dist/lib/` as ES modules.

### Run tests

```bash
bun run test          # single run
bun run test:watch    # watch mode
```

### Preview production build

```bash
bun run preview
```

## Project Structure

```
src/
├── core/platform/           # Platform infrastructure
│   ├── PlatformProvider.tsx  # 4 split contexts (Role, User, App, Branding)
│   ├── useRole.ts           # { role, can(action, context?) }
│   ├── useCurrentApp.ts     # { app, apps, switchApp }
│   ├── useBranding.ts       # { title, logo, accentColor }
│   ├── RoleGate.tsx         # Conditional rendering by permission
│   └── defaults.ts          # ROLE_HIERARCHY, DEFAULT_PERMISSIONS
├── components/
│   ├── layout/              # Layout, Sidebar, AppSwitcher, UserMenu
│   ├── events/              # EventList, EventDetail, EventForm, editors
│   ├── dictionaries/        # DictionaryList, DictionaryPanel, DictionaryEditor
│   ├── tree/                # TreeNav, TreeNode
│   ├── export/              # ExportPanel
│   └── common/              # Badges, toggles, dialogs, buttons
├── hooks/                   # React hooks (tracking plan, search, editor, theme, etc.)
├── i18n/                    # I18nProvider + EN/RU translations (~250 keys each)
├── api/                     # HTTP client + mutation helpers
├── lib/                     # Utilities (payload, config resolution)
├── types/
│   ├── index.ts             # Core types (events, fields, config, data sources)
│   └── platform.ts          # Platform types (roles, permissions, apps, branding)
├── utils/                   # Area colors, accent colors, tree building
├── App.tsx                  # Mode A entry point
├── Platform.tsx             # Mode B/C entry point (OpenTPPlatform)
├── main.tsx                 # SPA entry point
├── web-component.tsx        # <opentp-viewer> custom element
└── web-component-platform.tsx  # <opentp-platform> custom element
```

## Tech Stack

- **React 18** + **TypeScript**
- **Tailwind CSS v4** (JIT, inline config)
- **Vite** (dev server + SPA/library builds)
- **Vitest** + **Testing Library** (unit/integration tests, jsdom)
- **Zero runtime dependencies** beyond React/ReactDOM

## Configuration

The dev server automatically proxies API and WebSocket requests:

- `/api/*` → `http://localhost:3000/api/`
- `/ws` → `ws://localhost:3000/ws`

UI options (tree levels, etc.) are configured via the `options` prop/attribute rather than environment variables.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](../CONTRIBUTING.md) before submitting a PR.

## License

Apache-2.0