# Voice Pipeline Cleanup & Refactoring — Design

**Date:** 2026-03-01
**Spec:** `prompts/oasis-voice-cleanup.md`
**Status:** Approved

## Overview

Replace `sync-transcripts.py` with a new Pipeline Orchestrator that owns the full transcript lifecycle from ingestion to curator handoff. Enforce an absolute Curator Rule (only fully-identified transcripts reach the Curator), add a dedicated playback directory for permanent audio storage, introduce a job queue manifest for pipeline observability, and clean up orphaned files.

---

## Architecture

### Pipeline Orchestrator (`scripts/voice/pipeline-orchestrator.py`)

New Python daemon that replaces `sync-transcripts.py`. Runs as launchd service `com.oasis.transcript-sync` (same plist, new script). Polls every 5 seconds.

**Owns:**

- Job queue manifest (`~/oasis-audio/jobs.json`)
- Curator gating (absolute — no grace period)
- WAV file lifecycle (inbox → playback or delete)
- Conversation stitching (subsumes `stitch_conversations.py` calls)
- Orphaned file cleanup
- Curator workspace sync

**Does NOT own:**

- Audio recording (Docker `app.py` — unchanged)
- AssemblyAI transcription (Docker `assemblyai_transcriber.py` — unchanged)
- Speaker identification (Docker `speaker_verify.py` — unchanged)
- Watch folder polling (`watch-folder.py` — unchanged, stays as its own daemon)
- Speaker enrollment/approval (dashboard API — unchanged)

### Interaction with Docker Audio-Listener

The Docker audio-listener container is treated as a black box:

- Reads WAVs from `~/oasis-audio/inbox/` (volume-mounted as `/audio/inbox`)
- Writes transcript JSONs to `~/oasis-audio/done/` (volume-mounted as `/audio/done`)
- The orchestrator watches both directories and manages everything else

---

## Job Queue Manifest (`~/oasis-audio/jobs.json`)

Single JSON file tracking every audio file's lifecycle.

### Structure

```json
{
  "recording_20260301_093109": {
    "source": "microphone",
    "audioFile": "recording_20260301_093109.wav",
    "createdAt": "2026-03-01T09:31:09Z",
    "status": "pending_curator",
    "stages": {
      "ingested": "2026-03-01T09:31:09Z",
      "transcribed": "2026-03-01T09:32:15Z",
      "speaker_id": "2026-03-01T09:32:45Z",
      "curator_synced": null
    },
    "pipelineStatus": "complete",
    "speakerIdentification": {
      "identified": { "SPEAKER_00": "fred" },
      "unidentified": ["SPEAKER_01"]
    },
    "playbackFile": "recording_20260301_093109.wav",
    "curatorPath": null,
    "error": null
  }
}
```

### Status Values

| Status               | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| `queued`             | WAV detected in inbox, not yet transcribed       |
| `processing`         | AssemblyAI transcription in progress             |
| `speaker_id_pending` | Transcribed, awaiting speaker identification     |
| `speaker_id_failed`  | Speaker ID failed, awaiting retry                |
| `complete`           | All speakers identified, ready for curator sync  |
| `pending_curator`    | Has unidentified speakers, held for human review |
| `curator_synced`     | Successfully pushed to curator workspace         |
| `skipped`            | Too short (<10s), no further processing          |
| `failed`             | AssemblyAI or pipeline error                     |

### Lifecycle Transitions

```
WAV in inbox → queued
transcript JSON appears → processing → speaker_id_pending
speaker ID completes:
  all identified → complete → curator_synced
  has unidentified → pending_curator (held indefinitely)
    user labels via dashboard → complete → curator_synced
speaker ID fails → speaker_id_failed (retry by Docker container)
audio <10s → skipped (WAV deleted, not moved to playback)
```

### Crash Recovery

On startup, the orchestrator rebuilds `jobs.json` from the ground truth:

- Scan inbox/ for WAVs → ensure each has a job entry
- Scan done/ for transcript JSONs → update job statuses
- Filesystem is authoritative; jobs.json is a cache

---

## The Curator Rule (Absolute Gating)

**Rule:** A transcript reaches the curator workspace ONLY when every speaker is identified and enrolled. No exceptions. No grace period.

### Gate Check

When a transcript reaches `complete` pipeline status, the orchestrator inspects `speaker_identification`:

- `unidentified` array is empty → **pass** → sync to curator
- `unidentified` array has entries → **hold** → status = `pending_curator`

### Dashboard Label Triggers Re-Check

When a user labels a speaker via `POST /api/voice/transcripts/:id/label-speaker`:

1. Dashboard API updates the transcript JSON
2. Dashboard API removes the `.synced` marker (if any)
3. Dashboard API updates `jobs.json` entry to re-trigger gate check
4. Orchestrator detects the change on next poll
5. If all speakers now identified → sync to curator automatically

### Backlog Migration (One-Time)

A migration script runs once to fix the 61 existing unidentified transcripts:

1. Scan curator workspace for transcripts with unidentified speakers
2. Move them to `~/.openclaw/workspace-curator/transcripts/voice/_pending/`
3. Remove their `.synced` markers from `~/oasis-audio/done/`
4. Create `jobs.json` entries with status `pending_curator`
5. Dashboard shows these in a "Pending Curator Review" section

### Re-Sync After Identification

When a pending transcript's speakers are all identified:

1. Orchestrator moves the transcript from `_pending/` back to `YYYY/MM/DD/`
2. Updates `jobs.json` status to `curator_synced`
3. Re-runs conversation stitching for that day

---

## Playback Directory & File Lifecycle

### New Directory

`~/oasis-audio/playback/` — permanent storage for audio files >10s, served to dashboard for playback.

### File Lifecycle

```
Source (mic or watch folder)
    ↓
~/oasis-audio/inbox/{id}.wav          (ephemeral — deleted after transcription)
    ↓
Docker audio-listener processes
    ↓
~/oasis-audio/done/{id}.json          (permanent — transcript JSON)
    ↓
Orchestrator detects transcript, checks duration:
  duration >= 10s → move WAV from inbox/ to playback/
  duration < 10s  → delete WAV from inbox/
    ↓
~/oasis-audio/playback/{id}.wav       (permanent — for dashboard audio player)
```

### Watch Folder Temp Lifecycle

```
Google Drive source file
    ↓
~/oasis-audio/temp/{original}.mp3     (watch-folder copies here)
    ↓ ffmpeg converts
~/oasis-audio/temp/{original}.wav
    ↓ move to inbox
~/oasis-audio/inbox/gdrive_{stem}.wav  (deleted after processing)
    ↓
temp/ file deleted after successful move to inbox
```

### Backfill (One-Time)

Move existing 172 inbox WAVs:

- If transcript exists and duration >= 10s → move to playback/
- If transcript exists and duration < 10s → delete
- If no transcript exists → leave in inbox (still being processed)

### Dashboard Audio URL

`GET /api/voice/audio/:filename` updated to:

1. Look in `playback/` first
2. Fall back to `inbox/` for in-progress files
3. Return 404 if not found in either

---

## Dashboard UI Changes

### Pipeline Tab

- Read job counts from `jobs.json` instead of scanning directories
- Show counts by status: queued, processing, pending_curator, synced, failed
- Show "Pending Curator Review" count prominently with accent color

### Transcripts Tab

- Add a visual badge on transcripts with status `pending_curator` — "Pending Curator"
- When user labels all speakers, show toast: "All speakers identified — syncing to Curator"
- Audio playback URL updated to check playback/ first

### Voice API Routes

| Change   | Route                                           | Description                                          |
| -------- | ----------------------------------------------- | ---------------------------------------------------- |
| Modified | `GET /api/voice/pipeline`                       | Read from `jobs.json` for pipeline stage counts      |
| Modified | `GET /api/voice/audio/:filename`                | Serve from playback/ with inbox/ fallback            |
| Modified | `POST /api/voice/transcripts/:id/label-speaker` | After label, update jobs.json and check curator gate |
| New      | `GET /api/voice/jobs`                           | Return jobs.json for dashboard consumption           |

### No Changes

- Speakers tab (profiles, candidates, merge — from Phase 4)
- Watch folder card (reads state files directly)
- Conversation stitching UI

---

## Error Handling & Cleanup

### Orphaned WAV Cleanup

The orchestrator checks inbox/ for WAVs older than 24 hours with no matching transcript in done/. These are logged and deleted.

### Failed AssemblyAI Jobs

If a transcript JSON has `assemblyai.status = "error"`:

- Job status set to `failed` with the error message
- WAV deleted from inbox/
- Failure logged for dashboard display
- No automatic retry (manual "Retry" button in dashboard)

### Watch Folder Errors

- ffmpeg conversion failure: logged, file skipped, NOT added to ledger (retried next poll)
- After 3 consecutive failures for the same file: marked "failed" in ledger

### Dashboard Error Display

- Pipeline tab shows failed job count with expandable error details
- Each failed job has a "Retry" button

---

## Files Modified/Created

### New Files

| File                                       | Purpose                                        |
| ------------------------------------------ | ---------------------------------------------- |
| `scripts/voice/pipeline-orchestrator.py`   | Pipeline orchestrator daemon                   |
| `scripts/voice/migrate-curator-backlog.py` | One-time migration of unidentified transcripts |
| `scripts/voice/backfill-playback.py`       | One-time move of inbox WAVs to playback/       |

### Modified Files

| File                                                                              | Changes                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js`                    | Updated pipeline route (jobs.json), audio route (playback/), label-speaker (curator gate check), new /jobs route |
| `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js` | Pending curator badge, updated audio URL, job status display                                                     |
| `~/Library/LaunchAgents/com.oasis.transcript-sync.plist`                          | Updated script path to pipeline-orchestrator.py                                                                  |

### Archived Files

| File                                | Reason                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `scripts/voice/sync-transcripts.py` | Replaced by pipeline-orchestrator.py (moved to scripts/voice/archived/) |

### New Runtime Files

| File                                                        | Purpose                                          |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `~/oasis-audio/jobs.json`                                   | Job queue manifest                               |
| `~/oasis-audio/playback/`                                   | Permanent audio storage for dashboard            |
| `~/.openclaw/workspace-curator/transcripts/voice/_pending/` | Held transcripts awaiting speaker identification |

---

## Migration Plan

### Order of Operations

1. **Create playback/ directory** and run backfill script (move existing inbox WAVs)
2. **Create jobs.json** by scanning inbox/ and done/ directories
3. **Run curator backlog migration** (move 61 unidentified transcripts to \_pending/)
4. **Deploy pipeline-orchestrator.py** (replace sync-transcripts.py in launchd)
5. **Update dashboard routes** (audio URL, pipeline status, label-speaker gate)
6. **Update dashboard UI** (pending curator badge, job status display)
7. **Archive sync-transcripts.py** to scripts/voice/archived/

### Rollback

If issues arise:

1. Stop orchestrator: `launchctl unload ~/Library/LaunchAgents/com.oasis.transcript-sync.plist`
2. Restore sync-transcripts.py in plist
3. Reload: `launchctl load ~/Library/LaunchAgents/com.oasis.transcript-sync.plist`
4. Dashboard routes have fallback logic (check playback/ then inbox/)
