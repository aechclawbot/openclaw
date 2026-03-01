# OASIS Dashboard API Endpoints

Complete catalog of all dashboard API routes. Auth: Basic Auth (`oasis`/`ReadyPlayer@1`).

## Health & System

- `GET /api/health` — Gateway health, uptime, versions
- `GET /api/system` — Node version, memory, uptime

## Agents

- `GET /api/agents` — List all agents
- `GET /api/agents/:id` — Single agent config
- `PUT /api/agents/:id/model` — Change agent model
- `POST /api/agents/:id/message` — Send message to agent
- `POST /api/agents/:id/clear-memory` — Clear agent memory
- `GET /api/agents/:id/workspace/files` — List workspace .md files
- `GET /api/agents/:id/workspace/files/:filename` — Read workspace file
- `PUT /api/agents/:id/workspace/files/:filename` — Update workspace file

## Chat

- `POST /api/chat/stream` — SSE streaming chat
- `GET /api/chat/sessions` — List chat sessions
- `GET /api/chat/sessions/:id` — Session history
- `POST /api/chat/sessions` — Create session

## Cron

- `GET /api/cron` — List cron jobs
- `GET /api/cron/:jobId/details` — Job details
- `POST /api/cron` — Create job
- `PUT /api/cron/:jobId` — Update job
- `DELETE /api/cron/:jobId` — Delete job
- `POST /api/cron/:jobId/toggle` — Enable/disable
- `POST /api/cron/:jobId/run` — Trigger immediately
- `GET /api/cron/:jobId/runs` — Run history

## Docker

- `GET /api/docker/containers` — List containers with stats
- `POST /api/docker/containers/:name/stop` — Stop container
- `POST /api/docker/containers/:name/start` — Start container
- `POST /api/docker/containers/:name/restart` — Restart container
- `POST /api/docker/restart-all` — Restart non-infra containers
- `POST /api/docker/rebuild` — Trigger rebuild
- `GET /api/docker/logs/:containerName` — Container logs

## Todos

- `GET /api/todos` — List todos
- `GET /api/todos/:id/details` — Extended details
- `POST /api/todos` — Create todo
- `PATCH /api/todos/:id` — Update todo
- `POST /api/todos/:id/run` — Queue for execution
- `DELETE /api/todos/:id` — Delete todo

## Voice

- `GET /api/voice/transcripts` — Paginated transcripts
- `GET /api/voice/transcripts/:id` — Full transcript
- `DELETE /api/voice/transcripts/:id` — Delete transcript
- `POST /api/voice/transcripts/:id/label-speaker` — Label speaker
- `POST /api/voice/transcripts/:id/retry` — Re-queue transcription
- `GET /api/voice/candidates` — Speaker candidates
- `POST /api/voice/candidates/:speakerId/approve` — Approve candidate
- `POST /api/voice/candidates/:speakerId/reject` — Reject candidate
- `DELETE /api/voice/candidates/:speakerId` — Delete candidate
- `GET /api/voice/profiles` — Enrolled profiles
- `DELETE /api/voice/profiles/:name` — Delete profile
- `PATCH /api/voice/profiles/:name` — Rename profile
- `GET /api/voice/audio/:filename` — Serve audio file
- `GET /api/voice/stats` — Voice statistics
- `GET /api/voice/pipeline/status` — Pipeline status
- `GET /api/voice/pipeline` — Full pipeline status

## Treasury

- `GET /api/treasury/summary` — Portfolio summary
- `GET /api/treasury` — Legacy treasury
- `GET /api/treasury/v2` — Multi-chain portfolio
- `GET /api/treasury/wallet/:name` — Single wallet
- `GET /api/treasury/transactions/:wallet/:chain` — Transaction history
- `GET /api/treasury/:address/transactions` — Legacy tx history
- `POST /api/treasury/cache/clear` — Clear cache

## Curator

- `GET /api/curator/stats` — Library statistics
- `GET /api/curator/search?q=` — Search knowledge base
- `GET /api/curator/file?path=` — Read document
- `PUT /api/curator/file` — Write document
- `GET /api/curator/tree` — File tree
- `POST /api/curator/chat` — AI chat (SSE)

## Recipes

- `GET /api/recipes` — Recipe index
- `GET /api/recipes/current` — Current week
- `GET /api/recipes/weeks` — Available weeks
- `GET /api/recipes/feedback` — Feedback history
- `GET /api/recipes/:week` — Days list
- `GET /api/recipes/:week/shopping-list` — Shopping list
- `POST /api/recipes/:week/shopping-list` — Filtered list
- `POST /api/recipes/:week/:day/feedback` — Submit feedback
- `POST /api/recipes/:week/:day/refresh` — Request replacement
- `GET /api/recipes/:week/:day` — Day recipe

## Settings & Config

- `GET /api/settings` — Full config
- `POST /api/settings` — Update settings
- `GET /api/models` — Available models
- `GET /api/bindings` — Routing bindings
- `PUT /api/bindings` — Update bindings
- `GET /api/channels` — List channels
- `GET /api/channels/:channelId` — Channel details
- `PATCH /api/channels/:channelId` — Toggle channel
- `GET /api/usage` — AI usage data
- `GET /api/sessions` — Gateway sessions
- `GET /api/sessions/:key/transcript` — Session transcript
- `POST /api/sessions/:key/reset` — Reset session
- `DELETE /api/sessions/:key` — Delete session

## Preferences

- `GET /api/preferences` — List categories
- `GET /api/preferences/:category` — Read preference
- `PUT /api/preferences/:category` — Write preference

## Features

- `POST /api/features` — Create feature request
- `GET /api/features` — List features
- `GET /api/features/:id` — Single feature
- `PUT /api/features/:id` — Update feature
- `POST /api/features/:id/plan` — Trigger planning
- `PUT /api/features/:id/approve` — Approve plan
- `POST /api/features/:id/execute` — Execute plan
- `GET /api/features/:id/progress` — Progress stream (SSE)
- `PUT /api/features/:id/reject` — Reject plan
- `PUT /api/features/:id/complete` — Mark complete
- `PUT /api/features/:id/issues` — Report issues

## Audit

- `POST /api/audit/qa/trigger` — Start QA audit
- `GET /api/audit/qa/status` — QA status
- `GET /api/audit/qa/reports` — QA reports
- `GET /api/audit/qa/reports/:id` — Single QA report
- `PUT /api/audit/qa/reports/:id/approve` — Approve QA
- `POST /api/audit/qa/fix` — Fix QA issues
- `POST /api/audit/security/trigger` — Start security audit
- `GET /api/audit/security/status` — Security status
- `GET /api/audit/security/reports` — Security reports
- `GET /api/audit/security/reports/:id` — Single security report
- `PUT /api/audit/security/reports/:id/approve` — Approve security
- `POST /api/audit/security/fix` — Fix security issues

## Activity & Metrics

- `GET /api/activity` — Activity log
- `GET /api/metrics` — Metrics index
- `GET /api/metrics/summary` — Combined metrics
- `GET /api/metrics/agents` — Agent metrics
- `GET /api/metrics/cron` — Cron metrics
- `GET /api/metrics/system` — System metrics

## Spawn

- `GET /api/spawn/validate/:id` — Check ID uniqueness
- `GET /api/spawn/templates` — Agent templates
- `POST /api/spawn` — Create agent

## Business Agents

- `GET /api/dito/pipeline` — Sales pipeline
- `GET /api/dito/leads` — List leads
- `POST /api/dito/leads` — Add lead
- `PATCH /api/dito/leads/:index` — Update lead
- `DELETE /api/dito/leads/:index` — Delete lead
- `GET /api/dito/demos` — Demo sites
- `GET /api/nolan/projects` — Projects
- `POST /api/nolan/projects` — Add project
- `PATCH /api/nolan/projects/:id` — Update project
- `DELETE /api/nolan/projects/:id` — Delete project
- `GET /api/aech/deals` — Deals
- `POST /api/aech/deals` — Add deal
- `PATCH /api/aech/deals/:id` — Update deal
- `DELETE /api/aech/deals/:id` — Delete deal

## Legacy Logs

- `GET /api/logs/gateway` — Gateway container logs
- `GET /api/logs/audio-listener` — Audio listener logs
