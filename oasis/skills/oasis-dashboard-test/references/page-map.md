# OASIS Dashboard Page Map

Dashboard URL: `http://192.168.4.186:3000` (LAN) or `http://localhost:3000` (local)

## Pages

### Home (`/`)

- System status overview cards (gateway, containers, agents)
- Real-time activity feed (WebSocket-driven)
- Agent status grid with emoji indicators
- Quick links to common actions

### Agents (`/#agents`)

- Agent list with id, name, emoji, status
- Session counts per agent
- Model assignment
- Click to navigate to agent detail

### Agent Detail (`/#agent/{agentId}`)

- Agent config (model, tools, theme)
- Recent sessions list
- Workspace file editor (IDENTITY.md, SOUL.md, etc.)
- Message send form
- Memory clear action

### Chat (`/#chat`)

- Chat input with markdown support
- Model selector dropdown
- Session list sidebar
- Message history with tool calls
- SSE streaming responses

### Analytics (`/#analytics`)

- Cost tracking charts (by model, by agent, by day)
- Token usage breakdown
- API call counts
- Trend analysis

### Operations (`/#operations`)

- **Cron tab**: Job list, status, schedules, run history, manual trigger
- **Docker tab**: Container status grid, CPU/memory, restart/stop actions
- **Activity tab**: Live activity stream
- **Logs tab**: Gateway and audio-listener log viewer
- **Audit tab**: QA and security audit reports

### Knowledge (`/#knowledge`)

- Curator search bar
- Document viewer/editor
- File tree browser
- AI chat (Gemini-powered curator assistant)
- Voice transcript section

### Household (`/#household`)

- **Recipes tab**: Weekly meal plan, shopping list, feedback
- **Todos tab**: Task list with status workflow
- **Voice tab**: Transcript viewer, speaker profiles, candidates

### Business (`/#business`)

- **Dito tab**: Sales pipeline (leads by status), demo sites
- **Nolan tab**: Marketplace projects
- **Aech tab**: Arbitrage deals

### Tools (`/#tools`)

- Feature request list and planning workflow
- User preferences editor
- Developer tools and debugging

### Settings (`/#settings`)

- System config (default agent, model, fallbacks)
- Channel management (Telegram, Discord, etc.)
- Model configuration
- Routing bindings
- Usage statistics

### Spawn (`/#spawn`)

- New agent creation form
- Agent ID validation
- Template selection
- Tool assignment
- Model selection
