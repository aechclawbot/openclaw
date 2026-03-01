---
name: oasis-dashboard-test
description: Comprehensive functional testing of the OASIS Dashboard web UI at http://192.168.4.186:3000. Tests all pages (Home, Agents, Chat, Analytics, Operations, Knowledge, Household, Business, Tools, Settings, Spawn), all API endpoints, WebSocket connections, Docker management UI, todo CRUD, voice transcript viewer, and auth flow. Uses browser automation for visual verification. Use when asked to test the dashboard, verify dashboard UI, check dashboard pages, or do UI testing.
metadata: { "openclaw": { "emoji": "🖥️" } }
---

# OASIS Dashboard Functional Testing

Test the OASIS Dashboard at `http://192.168.4.186:3000` (or `http://localhost:3000`).

## Authentication

- Username: `oasis`
- Password: `ReadyPlayer@1`
- Method: HTTP Basic Auth

## Browser-Based Page Testing

Use the Claude in Chrome MCP tools. For each page:

1. Navigate to the URL
2. Wait for page load
3. Read the page to verify content rendered
4. Check console for JavaScript errors (`read_console_messages`)
5. Take a screenshot for visual record

### Page Test Matrix

| Page         | URL                          | Key Elements to Verify                         |
| ------------ | ---------------------------- | ---------------------------------------------- |
| Home         | `http://192.168.4.186:3000/` | System status cards, activity feed, agent grid |
| Agents       | `/#agents`                   | Agent list with status, session counts         |
| Agent Detail | `/#agent/oasis`              | Agent config, model info, workspace files      |
| Chat         | `/#chat`                     | Chat input, model selector, session list       |
| Analytics    | `/#analytics`                | Cost charts, usage metrics, model breakdown    |
| Operations   | `/#operations`               | Cron table, Docker containers, activity, logs  |
| Knowledge    | `/#knowledge`                | Curator search, document viewer                |
| Household    | `/#household`                | Recipes, todo list, voice transcripts          |
| Business     | `/#business`                 | Dito pipeline, Nolan projects, Aech deals      |
| Tools        | `/#tools`                    | Feature requests, preferences, dev tools       |
| Settings     | `/#settings`                 | Config, channels, models, bindings             |
| Spawn        | `/#spawn`                    | Agent creation form, templates                 |

### Functional Tests

**Auth Flow:**

1. Navigate to dashboard without auth — verify auth prompt appears
2. Authenticate with credentials — verify dashboard loads

**Docker Management (Operations page):**

1. Navigate to Operations > Docker tab
2. Verify all 4 containers listed with status
3. Verify CPU/memory stats displayed

**Todo Management (Household page):**

1. Verify todos load from API
2. Test create new todo (if safe to do so)
3. Verify status badges and priority indicators

**Voice Transcripts (Household page):**

1. Navigate to voice tab
2. Verify transcripts load (grouped by date)
3. Verify speaker labels appear
4. Test search functionality

**Cron Jobs (Operations page):**

1. Verify cron job list loads
2. Check job status indicators
3. Verify run history available

## API Endpoint Testing

See `references/api-endpoints.md` for the complete catalog.

Test each endpoint with curl:

```bash
AUTH="oasis:ReadyPlayer@1"
BASE="http://localhost:3000"
curl -sf -u "$AUTH" -o /dev/null -w "%{http_code} %{time_total}s" "$BASE/api/{endpoint}"
```

Key endpoints to verify (minimum set):

- `GET /api/health` — 200
- `GET /api/system` — 200
- `GET /api/agents` — 200, array
- `GET /api/cron` — 200, array
- `GET /api/docker/containers` — 200, array of 4
- `GET /api/todos` — 200, array
- `GET /api/voice/transcripts` — 200
- `GET /api/voice/pipeline` — 200
- `GET /api/curator/stats` — 200
- `GET /api/treasury/summary` — 200
- `GET /api/recipes` — 200
- `GET /api/settings` — 200
- `GET /api/activity` — 200
- `GET /api/metrics/summary` — 200
- `GET /api/features` — 200
- `GET /api/sessions` — 200
- `GET /api/spawn/templates` — 200

## Report Format

```
## Dashboard Test Report — [date]

### Page Load Results
| Page | Status | Console Errors | Notes |
|------|--------|----------------|-------|

### API Endpoint Results
| Endpoint | HTTP Status | Response Time | Notes |
|----------|-------------|---------------|-------|

### Functional Tests
| Test | Status | Notes |
|------|--------|-------|

### Screenshots
[list of screenshot references]

### Issues Found
[list of problems with severity]
```
