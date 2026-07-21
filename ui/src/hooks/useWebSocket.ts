import { useEffect, useRef, useState } from "react";

export type WsStatus = "connecting" | "connected" | "disconnected";

interface UseWebSocketOptions {
  url: string | null;
  onMessage?: (data: unknown) => void;
}

export interface UseWebSocketResult {
  status: WsStatus;
}

/** Build a WebSocket URL from the current page location. */
export function buildWsUrl(path = "/ws"): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function useWebSocket({
  url,
  onMessage,
}: UseWebSocketOptions): UseWebSocketResult {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const hasConnected = useRef(false);

  useEffect(() => {
    if (!url) return;

    function connect() {
      const ws = new WebSocket(url!);
      wsRef.current = ws;
      // Only show "connecting" during reconnection, not on initial load
      if (hasConnected.current) {
        setStatus("connecting");
      }

      ws.onopen = () => {
        hasConnected.current = true;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        setStatus(hasConnected.current ? "disconnected" : "disconnected");
        reconnectTimer.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      hasConnected.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url]);

  return { status };
}
