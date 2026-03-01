/**
 * OASIS Dashboard v3 - Gateway WebSocket Client
 * Singleton service that maintains a persistent connection to the OpenClaw gateway
 * and exposes rpcCall / getGatewayStatus / onGatewayEvent.
 *
 * Each rpcCall opens a fresh WS connection (same pattern as v2) to avoid
 * state management complexity; the persistent connection is used only for
 * event subscriptions.
 */

import { WebSocket } from "ws";
import { randomUUID } from "crypto";

const GATEWAY_WS = process.env.GATEWAY_URL || "ws://oasis:18789";
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";

let _gatewayStatus = "disconnected";
const _eventListeners = [];

/**
 * Execute a single JSON-RPC call over a transient WebSocket connection.
 * Opens, authenticates, sends the method, reads the response, then closes.
 */
export function rpcCall(method, params = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const origin = GATEWAY_WS.replace("ws://", "http://").replace("wss://", "https://");
    const ws = new WebSocket(GATEWAY_WS, { headers: { origin } });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`RPC timeout: ${method}`));
    }, timeoutMs);

    let authenticated = false;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Step 1: gateway sends challenge → we respond with connect
        if (msg.type === "event" && msg.event === "connect.challenge") {
          ws.send(
            JSON.stringify({
              type: "req",
              id: randomUUID(),
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: "openclaw-control-ui",
                  version: "3.0.0",
                  platform: "node",
                  mode: "backend",
                },
                role: "operator",
                scopes: ["operator.admin"],
                auth: { token: TOKEN },
              },
            })
          );
          return;
        }

        // Step 2: auth response → now send the actual RPC
        if (msg.type === "res" && !authenticated) {
          if (msg.error) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(msg.error.message || "Auth failed"));
            return;
          }
          authenticated = true;
          _gatewayStatus = "connected";
          ws.send(JSON.stringify({ type: "req", id: randomUUID(), method, params }));
          return;
        }

        // Step 3: RPC response
        if (msg.type === "res" && authenticated) {
          clearTimeout(timeout);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result ?? msg.payload ?? null);
          }
          ws.close();
          return;
        }
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
        ws.close();
      }
    });

    ws.on("error", (err) => {
      _gatewayStatus = "error";
      clearTimeout(timeout);
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Returns the last known gateway connection status.
 */
export function getGatewayStatus() {
  return _gatewayStatus;
}

/**
 * Register a listener for gateway events (best-effort; fired when
 * the persistent monitoring connection receives broadcast events).
 */
export function onGatewayEvent(listener) {
  _eventListeners.push(listener);
}

function _fireEvent(event) {
  for (const fn of _eventListeners) {
    try { fn(event); } catch {}
  }
}

// ========== Persistent monitoring connection with auto-reconnect ==========

let _monitorWs = null;
let _monitorReconnectDelay = 1000;
const MONITOR_MAX_DELAY = 30_000;
let _monitorStopped = false;

function _connectMonitor() {
  if (_monitorStopped) {return;}
  try {
    const origin = GATEWAY_WS.replace("ws://", "http://").replace("wss://", "https://");
    _monitorWs = new WebSocket(GATEWAY_WS, { headers: { origin } });

    _monitorWs.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle connect challenge
        if (msg.type === "event" && msg.event === "connect.challenge") {
          _monitorWs.send(
            JSON.stringify({
              type: "req",
              id: randomUUID(),
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: "openclaw-control-ui",
                  version: "3.0.0",
                  platform: "node",
                  mode: "backend",
                  instanceId: "dashboard-monitor",
                },
                role: "operator",
                scopes: ["operator.admin"],
                auth: { token: TOKEN },
              },
            })
          );
          return;
        }

        // Auth response
        if (msg.type === "res") {
          if (msg.error) {
            console.error("Monitor auth failed:", msg.error.message || JSON.stringify(msg.error));
            _gatewayStatus = "error";
            try { _monitorWs.close(); } catch {}
            return;
          }
          _gatewayStatus = "connected";
          _monitorReconnectDelay = 1000; // reset backoff on successful connect
          console.log("Gateway monitor connected successfully");
          return;
        }

        // Broadcast events from gateway
        if (msg.type === "event") {
          _fireEvent(msg);
        }
      } catch {}
    });

    _monitorWs.on("close", () => {
      _gatewayStatus = "disconnected";
      _monitorWs = null;
      _scheduleMonitorReconnect();
    });

    _monitorWs.on("error", () => {
      _gatewayStatus = "error";
      if (_monitorWs) {
        try { _monitorWs.close(); } catch {}
      }
    });
  } catch {
    _scheduleMonitorReconnect();
  }
}

function _scheduleMonitorReconnect() {
  if (_monitorStopped) {return;}
  setTimeout(() => {
    _connectMonitor();
  }, _monitorReconnectDelay);
  _monitorReconnectDelay = Math.min(_monitorReconnectDelay * 1.5, MONITOR_MAX_DELAY);
}

/**
 * Start the persistent monitoring connection.
 * Called once from server.js after startup.
 */
export function startMonitorConnection() {
  _monitorStopped = false;
  _connectMonitor();
}

/**
 * Stop the monitoring connection (for graceful shutdown).
 */
export function stopMonitorConnection() {
  _monitorStopped = true;
  if (_monitorWs) {
    try { _monitorWs.close(); } catch {}
  }
}
