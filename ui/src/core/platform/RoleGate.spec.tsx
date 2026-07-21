import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestWrapper, createBareWrapper } from "../../test-utils";
import { RoleGate } from "./RoleGate";
import { Roles, Permissions } from "../../types/platform";

describe("RoleGate", () => {
  it("renders children when action is allowed", () => {
    const Wrapper = createTestWrapper({ role: Roles.EDITOR });
    render(
      <Wrapper>
        <RoleGate action={Permissions.EDIT_EVENT}>
          <span>Edit Button</span>
        </RoleGate>
      </Wrapper>,
    );
    expect(screen.getByText("Edit Button")).toBeDefined();
  });

  it("renders nothing when action denied", () => {
    const Wrapper = createTestWrapper({ role: Roles.VIEWER });
    render(
      <Wrapper>
        <RoleGate action={Permissions.EDIT_EVENT}>
          <span>Edit Button</span>
        </RoleGate>
      </Wrapper>,
    );
    expect(screen.queryByText("Edit Button")).toBeNull();
  });

  it("renders fallback when action denied and fallback provided", () => {
    const Wrapper = createTestWrapper({ role: Roles.VIEWER });
    render(
      <Wrapper>
        <RoleGate action={Permissions.EDIT_EVENT} fallback={<span>No access</span>}>
          <span>Edit Button</span>
        </RoleGate>
      </Wrapper>,
    );
    expect(screen.queryByText("Edit Button")).toBeNull();
    expect(screen.getByText("No access")).toBeDefined();
  });

  it("works without PlatformProvider (Mode A)", () => {
    const Wrapper = createBareWrapper();
    render(
      <Wrapper>
        <RoleGate action={Permissions.DELETE_EVENT}>
          <span>Delete Button</span>
        </RoleGate>
      </Wrapper>,
    );
    // Mode A: no provider → all actions allowed → children rendered
    expect(screen.getByText("Delete Button")).toBeDefined();
  });
});
