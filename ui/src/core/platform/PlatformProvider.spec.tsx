import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { PlatformProvider } from "./PlatformProvider";
import { useRole } from "./useRole";
import { useBranding } from "./useBranding";
import { Roles } from "../../types/platform";
import type { AppDefinition, UserRole } from "../../types/platform";

const app1: AppDefinition = {
  id: "app1",
  name: "Web",
  source: { type: "api", baseUrl: "/api/web" },
};

const app2: AppDefinition = {
  id: "app2",
  name: "Mobile",
  source: { type: "api", baseUrl: "/api/mobile" },
};

describe("PlatformProvider — context splitting", () => {
  it("changing currentAppId does NOT re-render useRole consumers", () => {
    let roleRenderCount = 0;

    function RoleConsumer() {
      roleRenderCount++;
      const { role } = useRole();
      return <span data-testid="role">{role}</span>;
    }

    function TestHarness() {
      const [appId, setAppId] = useState("app1");
      return (
        <PlatformProvider role={Roles.EDITOR} apps={[app1, app2]} currentAppId={appId}>
          <RoleConsumer />
          <button onClick={() => setAppId("app2")}>Switch App</button>
        </PlatformProvider>
      );
    }

    render(<TestHarness />);
    expect(screen.getByTestId("role").textContent).toBe(Roles.EDITOR);
    const initialCount = roleRenderCount;

    // Switch app
    screen.getByText("Switch App").click();

    // Role consumer should NOT have re-rendered
    expect(roleRenderCount).toBe(initialCount);
    expect(screen.getByTestId("role").textContent).toBe(Roles.EDITOR);
  });

  it("changing role does NOT re-render useBranding consumers", () => {
    let brandingRenderCount = 0;

    function BrandingConsumer() {
      brandingRenderCount++;
      const { title } = useBranding();
      return <span data-testid="title">{title}</span>;
    }

    function TestHarness() {
      const [role, setRole] = useState<UserRole>(Roles.EDITOR);
      return (
        <PlatformProvider role={role} branding={{ title: "Acme" }}>
          <BrandingConsumer />
          <button onClick={() => setRole(Roles.ADMIN)}>Change Role</button>
        </PlatformProvider>
      );
    }

    render(<TestHarness />);
    expect(screen.getByTestId("title").textContent).toBe("Acme");
    const initialCount = brandingRenderCount;

    // Change role
    screen.getByText("Change Role").click();

    // Branding consumer should NOT have re-rendered
    expect(brandingRenderCount).toBe(initialCount);
    expect(screen.getByTestId("title").textContent).toBe("Acme");
  });

  it("useMemo prevents re-renders when props haven't changed", () => {
    let roleRenderCount = 0;
    let brandingRenderCount = 0;

    function RoleConsumer() {
      roleRenderCount++;
      const { role } = useRole();
      return <span>{role}</span>;
    }

    function BrandingConsumer() {
      brandingRenderCount++;
      const { title } = useBranding();
      return <span>{title}</span>;
    }

    function TestHarness() {
      const [, setCounter] = useState(0);
      return (
        <PlatformProvider role={Roles.EDITOR} branding={{ title: "Acme" }}>
          <RoleConsumer />
          <BrandingConsumer />
          <button onClick={() => setCounter((c) => c + 1)}>Force Re-render</button>
        </PlatformProvider>
      );
    }

    render(<TestHarness />);
    const roleCount = roleRenderCount;
    const brandingCount = brandingRenderCount;

    // Force parent re-render with same props
    screen.getByText("Force Re-render").click();

    // Neither consumer should re-render since useMemo values are stable
    expect(roleRenderCount).toBe(roleCount);
    expect(brandingRenderCount).toBe(brandingCount);
  });
});
