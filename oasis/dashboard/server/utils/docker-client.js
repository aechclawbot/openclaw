/**
 * OASIS Dashboard v3 - Docker API Client
 * Supports Unix socket or TCP proxy (DOCKER_HOST env var).
 */

import http from "http";
import { existsSync } from "fs";

const DOCKER_SOCK = process.env.DOCKER_SOCK || "/var/run/docker.sock";
const DOCKER_HOST = process.env.DOCKER_HOST || "";

function buildOptions(path, method = "GET") {
  if (DOCKER_HOST) {
    const url = new URL(DOCKER_HOST);
    return {
      hostname: url.hostname,
      port: parseInt(url.port, 10) || 2375,
      path,
      method,
      headers: { Host: "localhost", "Content-Type": "application/json" },
    };
  }

  if (existsSync(DOCKER_SOCK)) {
    return {
      socketPath: DOCKER_SOCK,
      path,
      method,
      headers: { Host: "localhost", "Content-Type": "application/json" },
    };
  }

  return null;
}

function doRequest(options, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (!options) {
      reject(new Error("No Docker connection available (set DOCKER_HOST or mount docker.sock)"));
      return;
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) });
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Docker API timeout"));
    });
    req.end();
  });
}

/** Perform a GET request against the Docker API. */
export function dockerRequest(path) {
  return doRequest(buildOptions(path, "GET"), 10_000);
}

/** Perform a GET request for container stats (longer timeout — stats?stream=false is slow). */
export function dockerStatsRequest(path) {
  return doRequest(buildOptions(path, "GET"), 15_000);
}

/** Perform a POST request against the Docker API (for start/stop/restart). */
export function dockerPost(path) {
  return doRequest(buildOptions(path, "POST"), 30_000);
}

/**
 * Parse Docker multiplexed log format (8-byte header per frame).
 * byte 0 = stream type (1=stdout, 2=stderr), bytes 4-7 = payload size (big-endian).
 */
export function parseDockerLogs(buf) {
  const lines = [];
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const streamType = buf[offset];
    const size =
      (buf[offset + 4] << 24) |
      (buf[offset + 5] << 16) |
      (buf[offset + 6] << 8) |
      buf[offset + 7];
    offset += 8;
    if (offset + size > buf.length) {break;}

    const payload = buf.subarray(offset, offset + size).toString("utf-8");
    offset += size;

    for (const line of payload.split("\n")) {
      if (line.length > 0) {
        lines.push({ stream: streamType === 2 ? "stderr" : "stdout", text: line });
      }
    }
  }

  return lines;
}
