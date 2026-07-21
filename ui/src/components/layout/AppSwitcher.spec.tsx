import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppSwitcher } from "./AppSwitcher";
import { PlatformProvider } from "../../core/platform/PlatformProvider";
import { I18nProvider } from "../../i18n";
import { ThemeProvider } from "../../hooks/useTheme";
import type { AppDefinition } from "../../types/platform";

// jsdom doesn't implement matchMedia — ThemeProvider needs it
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const app1: AppDefinition = {
  id: "web",
  name: "Web App",
  icon: "🌐",
  description: "Main web application",
  source: { type: "api", baseUrl: "/api/web" },
};

const app2: AppDefinition = {
  id: "mobile",
  name: "Mobile App",
  icon: "📱",
  description: "Mobile application",
  source: { type: "api", baseUrl: "/api/mobile" },
};

const app3: AppDefinition = {
  id: "backend",
  name: "Backend",
  source: { type: "api", baseUrl: "/api/backend" },
};

function makeWrapper(apps: AppDefinition[], onSwitchApp?: (id: string) => void) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PlatformProvider apps={apps} currentAppId={apps[0]?.id} onSwitchApp={onSwitchApp}>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </PlatformProvider>
    );
  };
}

describe("AppSwitcher", () => {
  it("renders nothing when no apps", () => {
    const Wrapper = makeWrapper([]);
    const { container } = render(<AppSwitcher />, { wrapper: Wrapper });
    expect(container.textContent).toBe("");
  });

  it("renders nothing when single app", () => {
    const Wrapper = makeWrapper([app1]);
    const { container } = render(<AppSwitcher />, { wrapper: Wrapper });
    expect(container.textContent).toBe("");
  });

  it("shows current app name", () => {
    const Wrapper = makeWrapper([app1, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });
    expect(screen.getByText("Web App")).toBeDefined();
  });

  it("shows all apps in dropdown on click", () => {
    const Wrapper = makeWrapper([app1, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    fireEvent.click(screen.getByLabelText("Switch app"));

    // "Web App" appears in both button and dropdown
    expect(screen.getAllByText("Web App").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Mobile App")).toBeDefined();
  });

  it("switching app calls switchApp", () => {
    const onSwitchApp = vi.fn();
    const Wrapper = makeWrapper([app1, app2], onSwitchApp);
    render(<AppSwitcher />, { wrapper: Wrapper });

    // Open dropdown
    fireEvent.click(screen.getByLabelText("Switch app"));

    // Click second app
    fireEvent.click(screen.getByText("Mobile App"));

    expect(onSwitchApp).toHaveBeenCalledWith("mobile");
  });

  it("highlights current app in dropdown", () => {
    const Wrapper = makeWrapper([app1, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    fireEvent.click(screen.getByLabelText("Switch app"));

    // Current app (app1) should have aria-selected=true
    const options = screen.getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
  });

  it("closes dropdown on click outside", () => {
    const Wrapper = makeWrapper([app1, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    // Open
    fireEvent.click(screen.getByLabelText("Switch app"));
    expect(screen.getByRole("listbox")).toBeDefined();

    // Click outside
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape key closes dropdown", () => {
    const Wrapper = makeWrapper([app1, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    const button = screen.getByLabelText("Switch app");
    fireEvent.click(button);
    expect(screen.getByRole("listbox")).toBeDefined();

    fireEvent.keyDown(button, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ArrowDown navigates options", () => {
    const Wrapper = makeWrapper([app1, app2, app3]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    const button = screen.getByLabelText("Switch app");
    fireEvent.click(button);

    // ArrowDown should highlight first option
    fireEvent.keyDown(button, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    // First option should have hover styling (activeIndex === 0)
    expect(options[0].className).toContain("bg-");
  });

  it("Enter selects focused option", () => {
    const onSwitchApp = vi.fn();
    const Wrapper = makeWrapper([app1, app2], onSwitchApp);
    render(<AppSwitcher />, { wrapper: Wrapper });

    const button = screen.getByLabelText("Switch app");
    fireEvent.click(button);

    // Navigate to second option
    fireEvent.keyDown(button, { key: "ArrowDown" });
    fireEvent.keyDown(button, { key: "ArrowDown" });

    // Select with Enter
    fireEvent.keyDown(button, { key: "Enter" });

    expect(onSwitchApp).toHaveBeenCalledWith("mobile");
  });

  it("shows app icon as emoji", () => {
    const Wrapper = makeWrapper([app1, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    // Button should show the current app's emoji icon
    expect(screen.getByText("🌐")).toBeDefined();
  });

  it("shows app description in dropdown", () => {
    const Wrapper = makeWrapper([app1, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    fireEvent.click(screen.getByLabelText("Switch app"));

    expect(screen.getByText("Main web application")).toBeDefined();
    expect(screen.getByText("Mobile application")).toBeDefined();
  });

  it("truncates long app names", () => {
    const longApp: AppDefinition = {
      id: "long",
      name: "A".repeat(80),
      source: { type: "api", baseUrl: "/api/long" },
    };
    const Wrapper = makeWrapper([longApp, app2]);
    render(<AppSwitcher />, { wrapper: Wrapper });

    const nameEl = screen.getByText("A".repeat(80));
    expect(nameEl.className).toContain("truncate");
  });

  it("renders without PlatformProvider (Mode A) — returns null", () => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    );
    const { container } = render(<AppSwitcher />, { wrapper: Wrapper });
    expect(container.textContent).toBe("");
  });
});
