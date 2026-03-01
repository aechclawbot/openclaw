/**
 * OASIS Dashboard v3 - Activity Routes
 * GET /activity — return the in-memory activity log
 *
 * The activityLog itself lives in server.js (global singleton).
 * This module exposes it via a getter function set at startup.
 */

import { Router } from "express";

const router = Router();

// getLog is set by server.js via setActivityLogGetter()
let _getLog = () => [];
export function setActivityLogGetter(fn) {
  _getLog = fn;
}

const MAX_ACTIVITY = 500;

router.get("/", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_ACTIVITY);
  res.json({ activity: _getLog().slice(0, limit) });
});

export default router;
