import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WebSocketClient {
  send(data: string): void;
  close(): void;
}

export class WebSocketServer {
  private clients = new Set<WebSocketClient>();

  /** Attach to an existing HTTP server to handle upgrade requests */
  attach(server: Server): void {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex) => {
      // Only handle /ws path
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const key = req.headers["sec-websocket-key"];
      if (!key) {
        socket.destroy();
        return;
      }

      // Perform WebSocket handshake
      const acceptKey = createHash("sha1")
        .update(key + WS_MAGIC)
        .digest("base64");

      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
          "\r\n",
      );

      const client: WebSocketClient = {
        send: (data: string) => {
          const payload = Buffer.from(data);
          const frame = encodeFrame(payload);
          socket.write(frame);
        },
        close: () => {
          socket.end();
          this.clients.delete(client);
        },
      };

      this.clients.add(client);

      socket.on("close", () => {
        this.clients.delete(client);
      });

      socket.on("error", () => {
        this.clients.delete(client);
      });
    });
  }

  /** Broadcast a message to all connected clients */
  broadcast(data: string): void {
    for (const client of this.clients) {
      try {
        client.send(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

/** Encode a text frame per WebSocket protocol (RFC 6455) */
function encodeFrame(payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}
