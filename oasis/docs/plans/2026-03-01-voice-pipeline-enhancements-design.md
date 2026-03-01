# Voice Pipeline & Knowledge Dashboard Enhancements — Design

**Date:** 2026-03-01
**Spec:** `prompts/oasis-voice-pipeline.md`
**Status:** Approved

## Overview

Four-phase enhancement to the OASIS Knowledge section: add a Google Drive watch folder as a second ingestion source, update the pipeline UI to reflect dual-input architecture, improve the Transcripts view for rapid speaker labeling and text correction, and overhaul the Speakers tab with upload-based profile creation, candidate audio previews, and candidate merging. Also fixes several existing frontend/backend field mismatches.

---

## Phase 1: Backend — Watch Folder Integration & State Management

### Architecture

New Python script `scripts/voice/watch-folder.py` running as a launchd service (`com.oasis.watch-folder`). Polls the Google Drive File Stream shortcut path on a 30-second interval.

### Watch Folder Source Path

```
/Users/oasis/Library/CloudStorage/GoogleDrive-aech.clawbot@gmail.com/.shortcut-targets-by-id/1XPKf8bAq0qbOL7AmAPspViT82YUf_h8V/The Oasis - Personal AI Agent Framework/00_The_Library/Audio Recordings
```

Currently contains 156 MP3 files. All files are MP3 — the watcher converts to WAV via ffmpeg before handing off to the existing Docker pipeline.

### Data Flow

```
Google Drive (CloudStorage shortcut path)
    |  watch-folder.py polls every 30s
    |  checks processed_audio_log.json ledger (SHA-256 dedup)
    |
    +- NEW file detected
    |  copy to ~/oasis-audio/temp/ (forces Google Drive download)
    |  wait for copy complete (file size stability check, 3 polls 2s apart)
    |  ffmpeg convert to WAV if not already WAV
    |  move WAV from temp/ to ~/oasis-audio/inbox/
    |  (existing Docker audio-listener pipeline picks it up)
    |  record in ledger after transcript appears in done/
    |
    +- KNOWN file (in ledger) -> skip
```

### Key Components

**Temp directory:** `~/oasis-audio/temp/` — intermediate staging area. Non-synced, ensures full file download before processing. Cleaned up after successful handoff to inbox.

**Tracking ledger:** `~/.openclaw/processed_audio_log.json`

```json
{
  "filename.mp3": {
    "hash": "sha256:...",
    "processed_at": "2026-03-01T12:00:00Z",
    "source_path": "/full/path/to/filename.mp3",
    "transcript_id": "recording_20260301_120000"
  }
}
```

**Pause/resume state:** `~/.openclaw/watch-folder-state.json`

```json
{ "active": true }
```

Toggled by dashboard API. When paused, the watcher finishes its current file but ignores new files until resumed.

**Supported formats:** `.wav`, `.mp3`, `.m4a`, `.ogg`, `.flac` — non-WAV formats converted via `ffmpeg -i input -ar 16000 -ac 1 output.wav`.

### Ingestion State API (dashboard server)

| Method | Path                                       | Description                                                                                  |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| GET    | `/api/voice/ingestion/status`              | Returns `{microphone: {active}, watchFolder: {active, path, filesDetected, filesProcessed}}` |
| POST   | `/api/voice/ingestion/microphone/toggle`   | Writes microphone state file                                                                 |
| POST   | `/api/voice/ingestion/watch-folder/toggle` | Writes `watch-folder-state.json`                                                             |

Microphone toggle: writes state file that `app.py` in the audio-listener container checks before recording new segments.

### Launchd Service

Plist: `~/Library/LaunchAgents/com.oasis.watch-folder.plist`

- RunAtLoad + KeepAlive
- Stdout: `~/.openclaw/logs/watch-folder.log`
- Stderr: `~/.openclaw/logs/watch-folder-error.log`

---

## Phase 2: UI — Pipeline Visualization Updates

### Pipeline Flow Graphic

Replace single-source linear flow with dual-input converging layout:

```
Microphone --------+
                   +----> Audio Listener -> AssemblyAI -> Speaker ID -> Curator Sync
Watch Folder ------+
```

Each starting node has its own status dot (green/amber/red) and an inline pause/resume toggle button.

### Microphone Card Updates

- Add pause/resume pill toggle (green = active, amber = paused)
- Calls `POST /api/voice/ingestion/microphone/toggle`
- When paused: status dot turns amber, card shows "Paused" badge

### New Watch Folder Status Card

Added below the existing stage detail grid:

| Field               | Source                                   |
| ------------------- | ---------------------------------------- |
| Folder path         | Truncated display, full path in tooltip  |
| Files detected      | Count of audio files in source directory |
| Files processed     | Ledger entry count                       |
| Current status      | idle / downloading / processing / paused |
| Current file        | Filename being downloaded, or null       |
| Last processed      | ISO timestamp from ledger                |
| Pause/resume toggle | Same style as microphone toggle          |
| Errors              | Count of failed copies/conversions       |

### Extended Pipeline API Response

Add `watchFolder` key to `GET /api/voice/pipeline`:

```js
watchFolder: {
  (status, // "active" | "paused" | "processing" | "error" | "offline"
    folderPath, // truncated display path
    filesDetected, // total audio files in source dir
    filesProcessed, // ledger count
    currentFile, // filename being processed, or null
    lastProcessed, // ISO timestamp
    errors); // failure count
}
```

Server reads ledger JSON and watch-folder state file to build this.

---

## Phase 3: UI — Transcripts View Improvements

### 3a. Inline Speaker Labeling

Each utterance's speaker tag in the transcript detail modal becomes an auto-saving dropdown.

**Current behavior:** Dropdown per utterance + separate "Save Labels" button. Frontend sends `{ labels: { speakerId: name } }` but server expects `{ speakerId, name }` — API mismatch (bug).

**New behavior:**

1. Dropdown change fires immediately: `POST /api/voice/transcripts/:id/label-speaker` with `{ speakerId, name }`
2. Optimistic UI update — re-renders with new speaker name/color instantly
3. Toast notification on success/failure
4. Remove the "Save Labels" button — each change is atomic
5. Fix the API payload to match server expectation

### 3b. Inline Text Editing

Each utterance's text becomes editable on click within the transcript detail modal.

**Interaction:**

- Hover: subtle pencil icon appears
- Click text: switches to auto-sized `<textarea>`
- Blur or Ctrl+Enter: saves
- Escape: cancels
- Visual: blue left border while editing

**New API endpoint:**
| Method | Path | Body |
|--------|------|------|
| PUT | `/api/voice/transcripts/:id/utterance` | `{ utteranceIndex, text }` |

Server writes to curator workspace transcript JSON only. Raw `~/oasis-audio/done/` files are untouched (ground truth preservation).

### 3c. Audio Playback Context Enhancements

The existing modal has synchronized playback with utterance highlighting. Enhancements:

- **Active utterance indicator:** Accent-colored left border bar (replaces subtle background change)
- **Speaker timeline progress:** Current playback position indicator overlaid on the speaker timeline bar at the top of the modal
- **Click-to-seek:** Already works — keep as-is

---

## Phase 4: UI — Speaker Profiles Improvements

### 4a. Bug Fixes (Existing Issues)

**Candidate card field mismatches:**

- `c.id` → `c.speaker_id`
- `c.sampleCount` → `c.num_samples`
- `c.audioUrl` (never set) → render `c.sample_audio[]` as actual audio players
- `c.utteranceCount` (never set) → remove or derive from `c.sample_transcripts.length`

**Profile card identifier bug:**

- `p.id` → `p.name` for rename/delete operations
- Fix rename race condition where `_renameTarget === undefined` matches all profiles

**Label-speaker API mismatch:**

- Frontend payload: `{ labels: { speakerId: name } }` → fix to `{ speakerId, name }`

### 4b. Create New Speaker via Upload

New "Create Speaker Profile" button at the top of the Speakers section.

**Modal flow:**

1. Text input: speaker name
2. File upload: drag-and-drop zone + browse button (`.wav`, `.mp3`, `.m4a`)
3. Submit: `POST /api/voice/profiles/create` (multipart form)
4. Server: saves audio to temp, proxies to `audio-listener:9001/enroll-speaker` for ECAPA-TDNN embedding extraction, writes profile JSON to `~/.openclaw/voice-profiles/`
5. Success: profile appears in list, toast notification

**New API:**
| Method | Path | Body |
|--------|------|------|
| POST | `/api/voice/profiles/create` | Multipart: `name` (string) + `audio` (file) |

Server proxies audio to audio-listener container for embedding extraction. If `enroll-speaker` endpoint doesn't exist yet on the audio-listener, add it — receives audio file, runs SpeechBrain ECAPA-TDNN, returns embedding + threshold.

### 4c. Candidate Audio Previews

Each candidate card renders inline audio players for its sample audio files.

- Up to 3 mini `<audio>` players per candidate (from `c.sample_audio[]`, served via `/api/voice/audio/:filename`)
- Sample transcript excerpts displayed below each player (from `c.sample_transcripts[]`)
- Play button styled as small icon button in the candidate card header

### 4d. Merge Candidates

**UI:** Checkbox on each candidate card + "Merge Selected" button in the section header (appears when 2+ selected).

**Modal (on merge click):**

- Option A: "Create new profile" — text input for name
- Option B: "Merge into existing profile" — dropdown of enrolled profiles
- Confirm button

**New API:**
| Method | Path | Body |
|--------|------|------|
| POST | `/api/voice/candidates/merge` | `{ candidateIds: string[], target: { type: "new", name } \| { type: "existing", profileName } }` |

Server: averages L2-normalized embeddings from selected candidates, creates or updates profile, marks candidates as merged, triggers re-identification of affected transcripts (removes `.synced` markers so `pipeline-orchestrator.py` re-processes).

---

## Files Modified/Created

### New Files

| File                                                  | Purpose                     |
| ----------------------------------------------------- | --------------------------- |
| `scripts/voice/watch-folder.py`                       | Watch folder polling daemon |
| `~/Library/LaunchAgents/com.oasis.watch-folder.plist` | Launchd service definition  |

### Modified Files

| File                                                                              | Changes                                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js` | All UI changes (Phases 2-4)                                                                  |
| `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js`                    | New API endpoints (ingestion status/toggle, utterance edit, profile create, candidate merge) |
| `~/.openclaw/workspace-oasis/dashboard/server.js`                                 | Mount new routes if needed                                                                   |

### New Data Files (runtime)

| File                                   | Purpose                         |
| -------------------------------------- | ------------------------------- |
| `~/.openclaw/processed_audio_log.json` | Watch folder tracking ledger    |
| `~/.openclaw/watch-folder-state.json`  | Watch folder pause/resume state |
| `~/oasis-audio/temp/`                  | Temporary staging directory     |
