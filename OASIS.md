# OpenClaw "Oasis" Project

This file describes the local deployment of OpenClaw on the Oasis Mac Mini (2018), themed around _Ready Player One_.

## Architecture

- **Host**: Mac Mini 2018 (16GB RAM) running Docker
- **Deployment**: Docker Compose from this repo root (`/Users/oasis/openclaw/`)
- **Main bot**: "Oasis" — container name `oasis`
- **Agents**: Themed with personalities from _Ready Player One_
- **Agent configs**: `/Users/oasis/.openclaw/agents/` (mounted into container at `/home/node/.openclaw/agents/`)
- **Image**: Custom `Dockerfile.oasis` extending `openclaw:local` (adds ffmpeg, Python, whisper, clawhub)
- **Config dir**: Mounted from `${OPENCLAW_CONFIG_DIR}` → `/home/node/.openclaw` inside the container
- **Workspace dir**: Mounted from `${OPENCLAW_WORKSPACE_DIR}` → `/home/node/.openclaw/workspace`
- **Network**: Isolated `openclaw` bridge network
- **Resource limits**: 8GB RAM, 2 CPUs

### Agents

| Agent     | Role                                          | Emoji |
| --------- | --------------------------------------------- | ----- |
| `oasis`   | Main orchestrator — delegates to other agents | `🌐`  |
| `aech`    | Fast technical agent / digital mechanic       | `⚡`  |
| `curator` | Universal archivist / record keeper           | `📚`  |
| `art3mis` | Security firewall / vetting agent             | `🛡️`  |
| `ogden`   | Risk and ethical advisor                      | `🧙`  |
| `ir0k`    | Intelligence broker / deep researcher         | `🕵️`  |
| `main`    | Default agent                                 | —     |

Agent data lives in `/Users/oasis/.openclaw/agents/<name>/` with subdirectories for `agent/` (config) and `sessions/` (conversation history).

All agents default to **Haiku 4.5** with **Gemini 2.5 Flash** fallback.

### Services

| Service            | Container   | Purpose                                              |
| ------------------ | ----------- | ---------------------------------------------------- |
| `openclaw-gateway` | `oasis`     | Gateway server (ports 18789, 18790), always running  |
| `openclaw-cli`     | `oasis-cli` | Interactive CLI (on-demand via `docker compose run`) |

### Secrets Management

All secrets live in `.env` (git-ignored) and are referenced in `openclaw.json` via `${VAR_NAME}` substitution. **Never hardcode secrets in openclaw.json.**

`.env` variables:

| Variable                 | Purpose                                  |
| ------------------------ | ---------------------------------------- |
| `OPENCLAW_IMAGE`         | Docker image (default: `openclaw:oasis`) |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway auth token                       |
| `OPENCLAW_CONFIG_DIR`    | Host path to config directory            |
| `OPENCLAW_WORKSPACE_DIR` | Host path to workspace                   |
| `OPENCLAW_GATEWAY_PORT`  | Gateway port (default: 18789)            |
| `OPENCLAW_GATEWAY_BIND`  | Bind mode (default: `lan`)               |
| `ANTHROPIC_API_KEY`      | Anthropic API key                        |
| `GEMINI_API_KEY`         | Google Gemini API key                    |
| `OPENAI_API_KEY`         | OpenAI API key (image gen, whisper)      |
| `BRAVE_SEARCH_API_KEY`   | Brave web search API key                 |
| `TELEGRAM_BOT_TOKEN`     | Telegram bot token                       |
| `CLAUDE_AI_SESSION_KEY`  | Claude web auth (optional)               |
| `CLAUDE_WEB_SESSION_KEY` | Claude web auth (optional)               |
| `CLAUDE_WEB_COOKIE`      | Claude web auth (optional)               |

### Production Hardening

- **Health check**: Gateway probed every 30s at `/health` (3 retries, 15s start period)
- **Resource limits**: 8GB RAM, 2 CPUs
- **Log rotation**: json-file driver, 10MB max, 3 files retained
- **Network isolation**: Dedicated `openclaw` bridge network
- **Non-root**: Container runs as `node` user
- **Auto-restart**: `unless-stopped` restart policy on gateway

## Conventions

- Always use `docker compose` (not the legacy `docker-compose`)
- Use descriptive agent names with kebab-case (e.g., `art3mis-assistant`, `parzival-coder`)
- Test changes locally before applying
- Back up configs before modifying: `./backup-openclaw.sh`
- Never hardcode secrets in `openclaw.json` — use `${VAR_NAME}` references

## Common Tasks

### Start / Stop

```sh
docker compose up -d              # Start gateway
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
# Build base, then oasis layer
docker build -t openclaw:local .
docker build -f Dockerfile.oasis -t openclaw:oasis .

# Pin to a version
docker build -t openclaw:2026.2.13 .
docker build -f Dockerfile.oasis --build-arg BASE_IMAGE=openclaw:2026.2.13 -t openclaw:oasis .
```

### Backups

```sh
./backup-openclaw.sh              # Manual backup to ~/openclaw-backups/
```

Keeps 7 most recent backups, prunes older ones. Set up a daily cron:

```sh
# crontab -e
0 3 * * * /Users/oasis/openclaw/backup-openclaw.sh
```

### Agent Configs

Agent data lives on the host at `/Users/oasis/.openclaw/agents/`:

```
~/.openclaw/agents/
├── oasis/          # Main orchestrator
├── aech/           # Technical agent
├── curator/        # Archivist agent
├── main/           # Default agent
```

Agent identities and model config are in `~/.openclaw/openclaw.json` under `agents.list`.
