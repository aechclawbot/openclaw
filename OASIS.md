# OpenClaw "Oasis" Project

This file describes the local deployment of OpenClaw on the Oasis Mac Mini (2018), themed around *Ready Player One*.

## Architecture

- **Host**: Mac Mini 2018 running Docker
- **Deployment**: Docker Compose from this repo root (`/Users/oasis/openclaw/`)
- **Main bot**: "Oasis" — container name `oasis`
- **Agents**: Themed with personalities from *Ready Player One*
- **Agent configs**: `/Users/oasis/.openclaw/agents/` (mounted into container at `/home/node/.openclaw/agents/`)
- **Image**: Custom `Dockerfile.oasis` extending `openclaw:local` (adds ffmpeg, Python, whisper, clawhub)
- **Config dir**: Mounted from `${OPENCLAW_CONFIG_DIR}` → `/home/node/.openclaw` inside the container
- **Workspace dir**: Mounted from `${OPENCLAW_WORKSPACE_DIR}` → `/home/node/.openclaw/workspace`

### Agents

| Agent | Description |
|-------|-------------|
| `oasis` | Main bot |
| `aech` | Ready Player One character agent |
| `curator` | Curator agent |
| `main` | Default/main agent |

Agent data lives in `/Users/oasis/.openclaw/agents/<name>/` with subdirectories for `agent/` (config) and `sessions/` (conversation history).

### Services

| Service | Container | Purpose |
|---------|-----------|---------|
| `openclaw-gateway` | `oasis` | Gateway server (ports 18789, 18790) |
| `openclaw-cli` | `oasis-cli` | Interactive CLI (attach with `docker compose run`) |

### Environment

All secrets and config live in `.env` (git-ignored). Required variables:

- `OPENCLAW_IMAGE` — Docker image to use (default: `openclaw:local`)
- `OPENCLAW_GATEWAY_TOKEN` — Gateway auth token
- `OPENCLAW_CONFIG_DIR` — Host path to OpenClaw config directory
- `OPENCLAW_WORKSPACE_DIR` — Host path to workspace directory
- `OPENCLAW_GATEWAY_PORT` — Gateway port (default: 18789)
- `OPENCLAW_GATEWAY_BIND` — Bind mode (default: `lan`)
- `CLAUDE_AI_SESSION_KEY` / `CLAUDE_WEB_SESSION_KEY` / `CLAUDE_WEB_COOKIE` — Claude auth credentials

## Conventions

- Always use `docker compose` (not the legacy `docker-compose`)
- Use descriptive agent names with kebab-case (e.g., `art3mis-assistant`, `parzival-coder`)
- Test changes locally before applying
- Back up configs before modifying them

## Common Tasks

### Start / Stop

```sh
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose restart             # Restart after config changes
```

### Logs

```sh
docker compose logs -f             # Follow all logs
docker compose logs -f oasis       # Follow gateway logs only
```

### CLI Access

```sh
docker compose run --rm openclaw-cli <command>
```

### Rebuild Custom Image

```sh
docker build -f Dockerfile.oasis -t openclaw:oasis .
```

### Agent Configs

Agent data lives on the host at `/Users/oasis/.openclaw/agents/`. Each agent has its own directory:

```
~/.openclaw/agents/
├── oasis/          # Main bot
├── aech/           # RPO character
├── curator/        # Curator agent
└── main/           # Default agent
```
