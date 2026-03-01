/**
 * OASIS Dashboard v3 - WebSocket Server
 * Identical logic to v2 websocket-server.js; carried forward verbatim.
 */

import { WebSocketServer } from "ws";
import { timingSafeEqual, createHmac } from "crypto";

export class DashboardWebSocket {
  constructor(httpServer, { authUser, authPass } = {}) {
    this.authUser = authUser || "";
    this.authPass = authPass || "";
    this.wss = new WebSocketServer({
      server: httpServer,
      path: "/ws",
      clientTracking: true,
      verifyClient: (info, cb) => {
        if (!this.authUser || !this.authPass) {return cb(true);}
        const url = new URL(info.req.url, `http://${info.req.headers.host}`);
        const token = url.searchParams.get("token");
        const authHeader = info.req.headers.authorization || "";
        if (this.validateAuth(authHeader) || this.validateToken(token)) {
          return cb(true);
        }
        cb(false, 401, "Authentication required");
      },
    });
    this.clients = new Set();
    this._setupServer();
  }

  // Constant-time comparison using HMAC to avoid length leaks
  _safeCompare(a, b) {
    const hmacA = createHmac("sha256", "dashboard-auth").update(a).digest();
    const hmacB = createHmac("sha256", "dashboard-auth").update(b).digest();
    return timingSafeEqual(hmacA, hmacB);
  }

  _validateCredentials(user, pass) {
    return (
      this._safeCompare(user, this.authUser) &&
      this._safeCompare(pass, this.authPass)
    );
  }

  validateAuth(header) {
    if (!header || !header.startsWith("Basic ")) {return false;}
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString();
      const idx = decoded.indexOf(":");
      if (idx < 0) {return false;}
      return this._validateCredentials(decoded.slice(0, idx), decoded.slice(idx + 1));
    } catch {
      return false;
    }
  }

  validateToken(token) {
    if (!token) {return false;}
    try {
      const decoded = Buffer.from(token, "base64").toString();
      const idx = decoded.indexOf(":");
      if (idx < 0) {return false;}
      return this._validateCredentials(decoded.slice(0, idx), decoded.slice(idx + 1));
    } catch {
      return false;
    }
  }

  _setupServer() {
    this.wss.on("connection", (ws, req) => {
      const clientId = this._generateClientId();
      ws.clientId = clientId;
      this.clients.add(ws);

      console.log(`WebSocket client connected: ${clientId} (total: ${this.clients.size})`);

      ws.send(
        JSON.stringify({
          type: "connected",
          clientId,
          timestamp: Date.now(),
          message: "Connected to OASIS Dashboard WebSocket",
        })
      );

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this._handleClientMessage(ws, message);
        } catch (error) {
          console.error("Invalid WebSocket message:", error);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`WebSocket client disconnected: ${clientId} (total: ${this.clients.size})`);
      });

      ws.on("error", (error) => {
        console.error(`WebSocket client error (${clientId}):`, error);
        this.clients.delete(ws);
      });

      // Ping-pong heartbeat to detect dead connections
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
    });

    // 30-second heartbeat interval
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30_000);

    console.log("WebSocket server initialized on /ws");
  }

  _handleClientMessage(ws, message) {
    if (message.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
    } else if (message.type === "subscribe") {
      ws.subscriptions = message.channels || ["all"];
      ws.send(
        JSON.stringify({
          type: "subscribed",
          channels: ws.subscriptions,
          timestamp: Date.now(),
        })
      );
    }
  }

  _generateClientId() {
    return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Broadcast an event object to all connected clients.
   * Supports event types: activity, cron_update, treasury_update, todo_update,
   * agent_status, session_update, chat_message.
   */
  broadcast(event) {
    if (this.clients.size === 0) {return;}
    const payload = JSON.stringify({
      ...event,
      timestamp: event.timestamp || Date.now(),
    });

    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(payload);
        sent++;
      }
    }

    if (sent > 0) {
      console.log(`Broadcast ${event.type} to ${sent} client(s)`);
    }
  }

  /** Send an event to a specific client by ID. */
  sendToClient(clientId, event) {
    for (const client of this.clients) {
      if (client.clientId === clientId && client.readyState === 1) {
        client.send(JSON.stringify(event));
        return true;
      }
    }
    return false;
  }

  getClientCount() {
    return this.clients.size;
  }

  close() {
    clearInterval(this.heartbeatInterval);
    this.wss.close();
    console.log("WebSocket server closed");
  }
}
