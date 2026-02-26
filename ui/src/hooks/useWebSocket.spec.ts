import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "./useWebSocket";

// ── Mock WebSocket ──────────────────────────────────────
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("useWebSocket", () => {
  let originalWS: typeof globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    originalWS = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWS;
  });

  it("does not show 'connecting' status on initial load", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost/ws" }),
    );

    // Before WS connects, status should be disconnected (not "connecting")
    expect(result.current.status).toBe("disconnected");
  });

  it("shows 'connected' after WebSocket opens", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost/ws" }),
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.status).toBe("connected");
  });

  it("shows 'connecting' only on reconnection, not initial connection", () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost/ws" }),
    );

    // Initial — should NOT be "connecting"
    expect(result.current.status).toBe("disconnected");

    // Open first connection
    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });
    expect(result.current.status).toBe("connected");

    // Simulate disconnect
    act(() => {
      MockWebSocket.instances[0].close();
    });

    // Advance timer to trigger reconnect
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Now should show "connecting" (reconnection attempt)
    expect(result.current.status).toBe("connecting");
  });

  it("calls onMessage when a WebSocket message is received", () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useWebSocket({ url: "ws://localhost/ws", onMessage }),
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      MockWebSocket.instances[0].simulateMessage({ type: "file-change" });
    });

    expect(onMessage).toHaveBeenCalledWith({ type: "file-change" });
  });

  it("does not connect when url is null", () => {
    renderHook(() => useWebSocket({ url: null }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
