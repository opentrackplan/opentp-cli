import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { UserMenu } from "./UserMenu";
import { PlatformProvider } from "../../core/platform/PlatformProvider";
import { I18nProvider } from "../../i18n";
import { ThemeProvider } from "../../hooks/useTheme";
import { Roles } from "../../types/platform";
import type { PlatformUser, UserRole } from "../../types/platform";

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

function Wrapper({
  role = Roles.EDITOR as UserRole,
  user,
  onLogout,
  children,
}: {
  role?: UserRole;
  user?: PlatformUser;
  onLogout?: () => void;
  children: ReactNode;
}) {
  return (
    <PlatformProvider role={role} user={user} onLogout={onLogout}>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </PlatformProvider>
  );
}

describe("UserMenu", () => {
  it("renders nothing when no user", () => {
    const { container } = render(
      <Wrapper>
        <UserMenu />
      </Wrapper>,
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing without PlatformProvider (Mode A)", () => {
    const { container } = render(
      <ThemeProvider>
        <I18nProvider>
          <UserMenu />
        </I18nProvider>
      </ThemeProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("shows user name and role badge", () => {
    render(
      <Wrapper role={Roles.EDITOR} user={{ name: "Jane" }}>
        <UserMenu />
      </Wrapper>,
    );

    expect(screen.getByText("Jane")).toBeDefined();
    expect(screen.getByText("Editor")).toBeDefined();
  });

  it("shows initials when no avatar", () => {
    render(
      <Wrapper user={{ name: "Jane" }}>
        <UserMenu />
      </Wrapper>,
    );

    expect(screen.getByText("J")).toBeDefined();
  });

  it("shows avatar image when avatar URL provided", () => {
    render(
      <Wrapper user={{ name: "Jane", avatar: "/jane.jpg" }}>
        <UserMenu />
      </Wrapper>,
    );

    const img = screen.getByAltText("Jane") as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.src).toContain("/jane.jpg");
  });

  it("logout button visible when onLogout provided", () => {
    const onLogout = vi.fn();
    render(
      <Wrapper user={{ name: "Jane" }} onLogout={onLogout}>
        <UserMenu />
      </Wrapper>,
    );

    // Open the dropdown
    fireEvent.click(screen.getByRole("button", { name: /Jane/i }));

    expect(screen.getByText("Log out")).toBeDefined();
  });

  it("logout button hidden when no onLogout", () => {
    render(
      <Wrapper user={{ name: "Jane" }}>
        <UserMenu />
      </Wrapper>,
    );

    // Open the dropdown — but no logout should appear
    fireEvent.click(screen.getByRole("button", { name: /Jane/i }));

    expect(screen.queryByText("Log out")).toBeNull();
  });

  it("clicking logout calls onLogout", () => {
    const onLogout = vi.fn();
    render(
      <Wrapper user={{ name: "Jane" }} onLogout={onLogout}>
        <UserMenu />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Jane/i }));
    fireEvent.click(screen.getByText("Log out"));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("clicking outside closes dropdown", () => {
    const onLogout = vi.fn();
    render(
      <Wrapper user={{ name: "Jane" }} onLogout={onLogout}>
        <UserMenu />
      </Wrapper>,
    );

    // Open
    fireEvent.click(screen.getByRole("button", { name: /Jane/i }));
    expect(screen.getByText("Log out")).toBeDefined();

    // Click outside
    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Log out")).toBeNull();
  });

  it("Escape key closes dropdown", () => {
    const onLogout = vi.fn();
    render(
      <Wrapper user={{ name: "Jane" }} onLogout={onLogout}>
        <UserMenu />
      </Wrapper>,
    );

    const button = screen.getByRole("button", { name: /Jane/i });
    fireEvent.click(button);
    expect(screen.getByText("Log out")).toBeDefined();

    fireEvent.keyDown(button, { key: "Escape" });

    expect(screen.queryByText("Log out")).toBeNull();
  });

  it("truncates long user name", () => {
    render(
      <Wrapper user={{ name: "A".repeat(50) }}>
        <UserMenu />
      </Wrapper>,
    );

    const nameEl = screen.getByText("A".repeat(50));
    expect(nameEl.className).toContain("truncate");
    expect(nameEl.className).toContain("overflow-hidden");
  });

  it("shows correct role badge colors", () => {
    const { rerender } = render(
      <Wrapper role={Roles.VIEWER} user={{ name: "Jane" }}>
        <UserMenu />
      </Wrapper>,
    );
    expect(screen.getByText("Viewer").className).toContain("bg-gray-600");

    rerender(
      <Wrapper role={Roles.ADMIN} user={{ name: "Jane" }}>
        <UserMenu />
      </Wrapper>,
    );
    expect(screen.getByText("Admin").className).toContain("bg-amber-600");
  });
});
