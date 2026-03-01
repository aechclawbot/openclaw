# Voice Pipeline Cleanup & Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `sync-transcripts.py` with a Pipeline Orchestrator that enforces absolute curator gating, manages a job queue manifest, and implements a proper audio file lifecycle with dedicated playback directory.

**Architecture:** New `pipeline-orchestrator.py` daemon replaces `sync-transcripts.py` as the sole owner of transcript lifecycle. It watches `~/oasis-audio/done/` for transcripts, manages `~/oasis-audio/jobs.json` for pipeline state, enforces the Curator Rule (only fully-identified transcripts reach curator), and moves WAVs from inbox/ to playback/ after transcription. Dashboard voice.js routes are updated to read from jobs.json and serve audio from playback/.

**Tech Stack:** Python 3 (orchestrator), Node.js/Express (dashboard routes), Lit Web Components (dashboard UI), launchd (macOS service management)

**Design doc:** `docs/plans/2026-03-01-voice-pipeline-cleanup-design.md`

---

### Task 1: Create playback directory and backfill script

Move existing WAVs from inbox/ to a new playback/ directory based on transcript state. This must run before any other changes to avoid breaking dashboard audio playback.

**Files:**

- Create: `scripts/voice/backfill-playback.py`

**Step 1: Write the backfill script**

```python
#!/usr/bin/env python3
"""One-time backfill: move processed WAVs from inbox/ to playback/.

For each WAV in inbox/:
- If a transcript exists in done/ with duration >= 10s → move to playback/
- If a transcript exists in done/ with duration < 10s → delete WAV
- If no transcript exists → leave in inbox (still being processed)

Usage:
    python3 backfill-playback.py              # Execute moves
    python3 backfill-playback.py --dry-run    # Preview without changes
"""
import argparse
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

INBOX_DIR = Path.home() / "oasis-audio" / "inbox"
DONE_DIR = Path.home() / "oasis-audio" / "done"
PLAYBACK_DIR = Path.home() / "oasis-audio" / "playback"


def log(msg: str):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [backfill] {msg}", flush=True)


def get_transcript_duration(transcript_path: Path) -> float | None:
    """Read duration from a transcript JSON. Returns None if not found."""
    try:
        data = json.loads(transcript_path.read_text(encoding="utf-8"))
        # Prefer assemblyai.audio_duration (most accurate)
        aai = data.get("assemblyai", {})
        if aai.get("audio_duration"):
            return float(aai["audio_duration"])
        # Fallback: max segment end time
        segments = data.get("segments", [])
        if segments:
            return max(seg.get("end", 0) for seg in segments)
        return 0
    except (json.JSONDecodeError, OSError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser(description="Backfill: move processed WAVs to playback/")
    parser.add_argument("--dry-run", action="store_true", help="Preview without changes")
    parser.add_argument("--min-duration", type=float, default=10.0,
                        help="Minimum duration in seconds to keep (default: 10)")
    args = parser.parse_args()

    PLAYBACK_DIR.mkdir(parents=True, exist_ok=True)

    if not INBOX_DIR.exists():
        log(f"Inbox directory not found: {INBOX_DIR}")
        return

    wavs = sorted(INBOX_DIR.glob("*.wav"))
    log(f"Found {len(wavs)} WAV files in inbox/")

    moved = 0
    deleted = 0
    skipped = 0

    for wav in wavs:
        stem = wav.stem
        transcript = DONE_DIR / f"{stem}.json"

        if not transcript.exists():
            log(f"  SKIP (no transcript): {wav.name}")
            skipped += 1
            continue

        duration = get_transcript_duration(transcript)
        if duration is None:
            log(f"  SKIP (unreadable transcript): {wav.name}")
            skipped += 1
            continue

        if duration >= args.min_duration:
            dest = PLAYBACK_DIR / wav.name
            if args.dry_run:
                log(f"  MOVE: {wav.name} ({duration:.0f}s) → playback/")
            else:
                shutil.move(str(wav), str(dest))
                log(f"  MOVED: {wav.name} ({duration:.0f}s) → playback/")
            moved += 1
        else:
            if args.dry_run:
                log(f"  DELETE: {wav.name} ({duration:.0f}s, below {args.min_duration}s)")
            else:
                wav.unlink()
                log(f"  DELETED: {wav.name} ({duration:.0f}s, below {args.min_duration}s)")
            deleted += 1

    log(f"Done: {moved} moved, {deleted} deleted, {skipped} skipped")


if __name__ == "__main__":
    main()
```

**Step 2: Dry-run the backfill to verify behavior**

Run: `python3 scripts/voice/backfill-playback.py --dry-run`
Expected: Output showing which files would be moved/deleted/skipped. Verify the numbers make sense (most should be moved, some short ones deleted, in-progress ones skipped).

**Step 3: Execute the backfill**

Run: `python3 scripts/voice/backfill-playback.py`
Expected: Files physically moved from `~/oasis-audio/inbox/` to `~/oasis-audio/playback/`. Verify with `ls ~/oasis-audio/playback/ | wc -l` (should match moved count) and `ls ~/oasis-audio/inbox/ | wc -l` (should be much smaller — only unprocessed files).

**Step 4: Commit**

```bash
git add scripts/voice/backfill-playback.py
git commit -m "feat(voice): add backfill script to move WAVs from inbox to playback"
```

---

### Task 2: Create curator backlog migration script

Move unidentified transcripts from curator workspace to a `_pending/` directory. This enforces the Curator Rule retroactively.

**Files:**

- Create: `scripts/voice/migrate-curator-backlog.py`

**Step 1: Write the migration script**

```python
#!/usr/bin/env python3
"""One-time migration: move unidentified transcripts to _pending/.

Scans curator workspace for transcripts where speaker_identification.unidentified
is non-empty. Moves them to _pending/ subdirectory and removes their .synced
markers so the orchestrator can re-gate them.

Usage:
    python3 migrate-curator-backlog.py              # Execute migration
    python3 migrate-curator-backlog.py --dry-run    # Preview without changes
"""
import argparse
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

CURATOR_VOICE_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"
PENDING_DIR = CURATOR_VOICE_DIR / "_pending"
DONE_DIR = Path.home() / "oasis-audio" / "done"


def log(msg: str):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [migrate] {msg}", flush=True)


def has_unidentified_speakers(data: dict) -> bool:
    """Check if a transcript has any unidentified speakers."""
    si = data.get("speaker_identification", {})
    unidentified = si.get("unidentified", [])
    return len(unidentified) > 0


def find_synced_marker(audio_path: str) -> Path | None:
    """Find the .synced marker for a transcript's source file."""
    if not audio_path:
        return None
    stem = audio_path.replace(".wav", "")
    marker = DONE_DIR / f"{stem}.json.synced"
    if marker.exists():
        return marker
    return None


def main():
    parser = argparse.ArgumentParser(description="Migrate unidentified transcripts to _pending/")
    parser.add_argument("--dry-run", action="store_true", help="Preview without changes")
    args = parser.parse_args()

    if not CURATOR_VOICE_DIR.exists():
        log(f"Curator voice dir not found: {CURATOR_VOICE_DIR}")
        return

    PENDING_DIR.mkdir(parents=True, exist_ok=True)

    # Find all transcript JSONs (excluding conversations.json and _pending/)
    all_transcripts = []
    for root, dirs, files in os.walk(CURATOR_VOICE_DIR):
        root_path = Path(root)
        # Skip _pending directory
        if "_pending" in root_path.parts:
            continue
        for f in files:
            if f.endswith(".json") and f != "conversations.json":
                all_transcripts.append(root_path / f)

    log(f"Found {len(all_transcripts)} curator transcripts")

    moved = 0
    markers_removed = 0
    already_ok = 0

    for transcript_path in sorted(all_transcripts):
        try:
            data = json.loads(transcript_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            log(f"  ERROR reading {transcript_path.name}: {e}")
            continue

        if not has_unidentified_speakers(data):
            already_ok += 1
            continue

        # Compute relative path from CURATOR_VOICE_DIR for preserving structure
        rel_path = transcript_path.relative_to(CURATOR_VOICE_DIR)
        dest = PENDING_DIR / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)

        audio_path = data.get("audioPath", "")
        marker = find_synced_marker(audio_path)

        if args.dry_run:
            si = data.get("speaker_identification", {})
            unid = si.get("unidentified", [])
            log(f"  MOVE: {rel_path} ({len(unid)} unidentified speakers)")
            if marker:
                log(f"    REMOVE MARKER: {marker.name}")
        else:
            shutil.move(str(transcript_path), str(dest))
            log(f"  MOVED: {rel_path}")
            moved += 1

            if marker:
                marker.unlink()
                log(f"    Removed .synced marker: {marker.name}")
                markers_removed += 1

    log(f"Done: {moved} moved to _pending/, {markers_removed} markers removed, {already_ok} already fully identified")


if __name__ == "__main__":
    main()
```

**Step 2: Dry-run the migration**

Run: `python3 scripts/voice/migrate-curator-backlog.py --dry-run`
Expected: Should show ~61 transcripts being moved with their unidentified speaker counts. Fully identified transcripts (should be ~11) are left in place.

**Step 3: Execute the migration**

Run: `python3 scripts/voice/migrate-curator-backlog.py`
Expected: Files moved from `YYYY/MM/DD/` to `_pending/YYYY/MM/DD/`. Verify with:

- `find ~/.openclaw/workspace-curator/transcripts/voice/_pending -name "*.json" | wc -l` (should be ~61)
- `find ~/.openclaw/workspace-curator/transcripts/voice -name "*.json" -not -path "*_pending*" -not -name "conversations.json" | wc -l` (should be ~11)

**Step 4: Commit**

```bash
git add scripts/voice/migrate-curator-backlog.py
git commit -m "feat(voice): add migration script to move unidentified transcripts to _pending"
```

---

### Task 3: Build the Pipeline Orchestrator — core job tracking

Create `pipeline-orchestrator.py` with the job queue manifest management. This task focuses on the core data structure: scanning directories, building/updating `jobs.json`, and the main poll loop.

**Files:**

- Create: `scripts/voice/pipeline-orchestrator.py`

**Step 1: Write the orchestrator core**

```python
#!/usr/bin/env python3
"""Pipeline Orchestrator — owns the transcript lifecycle from ingestion to curator.

Replaces sync-transcripts.py. Manages:
- Job queue manifest (~/oasis-audio/jobs.json)
- Curator gating (only fully-identified transcripts reach curator)
- WAV file lifecycle (inbox → playback or delete)
- Conversation stitching
- Orphan cleanup

Usage:
    python3 pipeline-orchestrator.py              # Continuous daemon
    python3 pipeline-orchestrator.py --once       # One-shot scan, then exit
"""
import argparse
import json
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

INBOX_DIR = Path.home() / "oasis-audio" / "inbox"
DONE_DIR = Path.home() / "oasis-audio" / "done"
PLAYBACK_DIR = Path.home() / "oasis-audio" / "playback"
JOBS_FILE = Path.home() / "oasis-audio" / "jobs.json"
CURATOR_VOICE_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"
PENDING_DIR = CURATOR_VOICE_DIR / "_pending"

POLL_INTERVAL = int(os.getenv("ORCHESTRATOR_POLL_INTERVAL", "5"))
MIN_PLAYBACK_DURATION = float(os.getenv("MIN_PLAYBACK_DURATION", "10"))
ORPHAN_AGE_HOURS = int(os.getenv("ORPHAN_AGE_HOURS", "24"))
MARKER_SUFFIX = ".synced"


def log(msg: str):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [orchestrator] {msg}", flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_jobs() -> dict:
    """Load jobs.json. Returns empty dict if missing or corrupt."""
    try:
        return json.loads(JOBS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_jobs(jobs: dict):
    """Atomically write jobs.json."""
    tmp = JOBS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(jobs, indent=2), encoding="utf-8")
    tmp.rename(JOBS_FILE)


def get_transcript_data(stem: str) -> dict | None:
    """Load transcript JSON from done/ directory."""
    path = DONE_DIR / f"{stem}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def get_duration(data: dict) -> float:
    """Extract audio duration from transcript data."""
    aai = data.get("assemblyai", {})
    if aai.get("audio_duration"):
        return float(aai["audio_duration"])
    segments = data.get("segments", [])
    if segments:
        return max(seg.get("end", 0) for seg in segments)
    return 0


def get_source(stem: str) -> str:
    """Determine audio source from filename convention."""
    if stem.startswith("gdrive_"):
        return "watch_folder"
    return "microphone"


def determine_status(data: dict) -> str:
    """Determine job status from transcript data.

    Returns one of: processing, speaker_id_pending, speaker_id_failed,
    complete, pending_curator, skipped, failed
    """
    pipeline_status = data.get("pipeline_status", "")

    if pipeline_status == "skipped_too_short":
        return "skipped"

    if pipeline_status == "transcribed":
        return "speaker_id_pending"

    if pipeline_status == "speaker_id_failed":
        return "speaker_id_failed"

    aai = data.get("assemblyai", {})
    if aai.get("status") == "error":
        return "failed"

    if pipeline_status in ("complete", "complete_no_speaker_id"):
        si = data.get("speaker_identification", {})
        unidentified = si.get("unidentified", [])
        if unidentified:
            return "pending_curator"
        return "complete"

    # Legacy transcript or unknown status
    if not pipeline_status:
        segments = data.get("segments", [])
        if segments:
            return "complete"

    return "processing"


def build_job_entry(stem: str, data: dict, existing: dict | None = None) -> dict:
    """Build or update a job entry from transcript data."""
    status = determine_status(data)
    si = data.get("speaker_identification", {})

    entry = existing or {
        "source": get_source(stem),
        "audioFile": f"{stem}.wav",
        "createdAt": data.get("timestamp") or now_iso(),
        "stages": {
            "ingested": None,
            "transcribed": None,
            "speaker_id": None,
            "curator_synced": None,
        },
    }

    # Update fields that can change
    entry["status"] = status
    entry["pipelineStatus"] = data.get("pipeline_status", "")
    entry["speakerIdentification"] = {
        "identified": si.get("identified", {}),
        "unidentified": si.get("unidentified", []),
    }
    entry["error"] = data.get("speaker_id_error")

    # Update stage timestamps
    stages = entry.get("stages", {})
    if not stages.get("ingested"):
        stages["ingested"] = data.get("timestamp") or now_iso()
    if data.get("assemblyai", {}).get("status") == "completed" and not stages.get("transcribed"):
        stages["transcribed"] = now_iso()
    pipeline_status = data.get("pipeline_status", "")
    if pipeline_status in ("complete", "complete_no_speaker_id", "speaker_id_failed") and not stages.get("speaker_id"):
        stages["speaker_id"] = now_iso()
    entry["stages"] = stages

    # Playback file tracking
    playback_path = PLAYBACK_DIR / f"{stem}.wav"
    entry["playbackFile"] = f"{stem}.wav" if playback_path.exists() else None

    return entry


# --- Curator sync logic (ported from sync-transcripts.py) ---

def convert_to_curator_format(data: dict) -> dict:
    """Convert a done/ transcript JSON to curator workspace format."""
    segments = data.get("segments", [])
    full_text = " ".join(seg.get("text", "").strip() for seg in segments).strip()
    duration = max((seg.get("end", 0) for seg in segments), default=0)
    has_diarization = data.get("diarization", False)

    speakers_map: dict = {}
    utterances = []

    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue
        sid = seg.get("speaker", "unknown")
        sname = seg.get("speaker_name")
        if sid not in speakers_map:
            speakers_map[sid] = {"id": sid, "name": sname, "utterances": []}
        elif sname and not speakers_map[sid]["name"]:
            speakers_map[sid]["name"] = sname
        speakers_map[sid]["utterances"].append(
            {"text": text, "start": seg.get("start", 0), "end": seg.get("end", 0)}
        )
        utterances.append({
            "speaker": sname or sid,
            "text": text,
            "start": seg.get("start", 0),
            "end": seg.get("end", 0),
        })

    # Parse timestamp
    ts_str = data.get("timestamp", "")
    ts = None
    if ts_str:
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except ValueError:
            pass
    if ts is None:
        ts = datetime.now(timezone.utc)

    result = {
        "timestamp": ts.isoformat() + "Z" if not ts.isoformat().endswith("Z") else ts.isoformat(),
        "duration": round(duration),
        "transcript": full_text,
        "audioPath": data.get("file", ""),
        "speakers": list(speakers_map.values()),
        "numSpeakers": len(speakers_map),
        "utterances": utterances,
        "source": "voice-passive",
        "model": data.get("model", "unknown"),
        "diarization": has_diarization,
        "pipeline_status": data.get("pipeline_status", "legacy"),
        "confidence": data.get("assemblyai", {}).get("confidence"),
        "speaker_id_error": data.get("speaker_id_error"),
        "speaker_id_retry_count": data.get("speaker_id_retry_count", 0),
    }

    if "assemblyai" in data:
        result["assemblyai"] = data["assemblyai"]
    if "speaker_identification" in data:
        result["speaker_identification"] = data["speaker_identification"]

    return result, ts


def sync_to_curator(stem: str, data: dict) -> str | None:
    """Sync a transcript to curator workspace. Returns the output path or None."""
    result, ts = convert_to_curator_format(data)
    if not result["transcript"]:
        return None

    date_dir = CURATOR_VOICE_DIR / ts.strftime("%Y/%m/%d")
    date_dir.mkdir(parents=True, exist_ok=True)

    has_diarization = data.get("diarization", False)
    time_prefix = ts.strftime("%H-%M-%S")
    suffix = "-diarized" if has_diarization else ""

    # Find existing file for same audio (re-sync case)
    audio_file = data.get("file", "")
    out_file = date_dir / f"{time_prefix}{suffix}.json"
    found_existing = False

    for existing in date_dir.glob(f"{time_prefix}*.json"):
        if existing.name == "conversations.json":
            continue
        try:
            existing_data = json.loads(existing.read_text(encoding="utf-8"))
            if existing_data.get("audioPath") == audio_file:
                out_file = existing
                found_existing = True
                break
        except (json.JSONDecodeError, OSError):
            continue

    # Also check _pending/ for re-sync after identification
    if not found_existing:
        pending_date_dir = PENDING_DIR / ts.strftime("%Y/%m/%d")
        if pending_date_dir.exists():
            for existing in pending_date_dir.glob(f"{time_prefix}*.json"):
                try:
                    existing_data = json.loads(existing.read_text(encoding="utf-8"))
                    if existing_data.get("audioPath") == audio_file:
                        # Move from pending back to active
                        out_file = date_dir / existing.name
                        existing.unlink()
                        found_existing = True
                        log(f"Re-syncing from _pending/: {existing.name}")
                        break
                except (json.JSONDecodeError, OSError):
                    continue

    if not found_existing and out_file.exists():
        counter = 1
        while out_file.exists():
            out_file = date_dir / f"{time_prefix}{suffix}-{counter}.json"
            counter += 1

    out_file.write_text(json.dumps(result, indent=2), encoding="utf-8")

    # Create .synced marker
    marker = DONE_DIR / f"{stem}.json{MARKER_SUFFIX}"
    marker.touch()

    return str(out_file.relative_to(CURATOR_VOICE_DIR))


# --- Main orchestration loop ---

def scan_once(jobs: dict) -> dict:
    """Run one orchestration cycle. Returns updated jobs dict."""
    changed = False

    # 1. Discover new WAVs in inbox/ → create "queued" entries
    if INBOX_DIR.exists():
        for wav in INBOX_DIR.glob("*.wav"):
            stem = wav.stem
            if stem not in jobs:
                jobs[stem] = {
                    "source": get_source(stem),
                    "audioFile": wav.name,
                    "createdAt": now_iso(),
                    "status": "queued",
                    "stages": {"ingested": now_iso(), "transcribed": None, "speaker_id": None, "curator_synced": None},
                    "pipelineStatus": "",
                    "speakerIdentification": {"identified": {}, "unidentified": []},
                    "playbackFile": None,
                    "curatorPath": None,
                    "error": None,
                }
                changed = True

    # 2. Process transcript JSONs in done/ → update job statuses
    if DONE_DIR.exists():
        for transcript_file in DONE_DIR.glob("*.json"):
            if transcript_file.name.startswith(".") or ".error." in transcript_file.name:
                continue

            stem = transcript_file.stem
            data = get_transcript_data(stem)
            if data is None:
                continue

            existing = jobs.get(stem)
            new_entry = build_job_entry(stem, data, existing)
            old_status = existing.get("status") if existing else None

            # Skip if nothing changed
            if existing and existing.get("status") == new_entry["status"]:
                # Still check if marker was removed (re-gate trigger)
                marker = DONE_DIR / f"{stem}.json{MARKER_SUFFIX}"
                if old_status == "curator_synced" and not marker.exists():
                    # Marker removed — re-evaluate for curator gate
                    new_entry = build_job_entry(stem, data, None)
                    log(f"Re-evaluating (marker removed): {stem}")
                else:
                    jobs[stem] = new_entry
                    continue

            jobs[stem] = new_entry
            changed = True

            # --- Act on status transitions ---

            # Move WAV to playback/ if transcription is done
            if new_entry["status"] not in ("queued", "processing") and old_status in ("queued", "processing", None):
                wav_inbox = INBOX_DIR / f"{stem}.wav"
                if wav_inbox.exists():
                    duration = get_duration(data)
                    if duration >= MIN_PLAYBACK_DURATION:
                        dest = PLAYBACK_DIR / wav_inbox.name
                        PLAYBACK_DIR.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(wav_inbox), str(dest))
                        new_entry["playbackFile"] = wav_inbox.name
                        log(f"Moved to playback: {wav_inbox.name} ({duration:.0f}s)")
                    else:
                        wav_inbox.unlink()
                        log(f"Deleted short audio: {wav_inbox.name} ({duration:.0f}s)")

            # Curator sync: only if all speakers identified
            if new_entry["status"] == "complete":
                marker = DONE_DIR / f"{stem}.json{MARKER_SUFFIX}"
                if not marker.exists():
                    curator_path = sync_to_curator(stem, data)
                    if curator_path:
                        new_entry["status"] = "curator_synced"
                        new_entry["curatorPath"] = curator_path
                        new_entry["stages"]["curator_synced"] = now_iso()
                        log(f"Synced to curator: {stem} → {curator_path}")
                else:
                    new_entry["status"] = "curator_synced"

            # Log status changes
            if old_status and old_status != new_entry["status"]:
                log(f"Status change: {stem} {old_status} → {new_entry['status']}")

            jobs[stem] = new_entry

    # 3. Orphan cleanup: WAVs in inbox/ with no transcript after ORPHAN_AGE_HOURS
    if INBOX_DIR.exists():
        cutoff = time.time() - (ORPHAN_AGE_HOURS * 3600)
        for wav in INBOX_DIR.glob("*.wav"):
            stem = wav.stem
            transcript = DONE_DIR / f"{stem}.json"
            if not transcript.exists():
                try:
                    if wav.stat().st_mtime < cutoff:
                        wav.unlink()
                        if stem in jobs:
                            jobs[stem]["status"] = "failed"
                            jobs[stem]["error"] = f"Orphaned: no transcript after {ORPHAN_AGE_HOURS}h"
                        log(f"Deleted orphan: {wav.name}")
                        changed = True
                except OSError:
                    pass

    # 4. Conversation stitching (run after any curator syncs)
    if changed:
        try:
            import sys
            script_dir = Path(__file__).parent
            if str(script_dir) not in sys.path:
                sys.path.insert(0, str(script_dir))
            from stitch_conversations import stitch_all_days
            stitched = stitch_all_days(incremental=True)
            if stitched:
                log(f"Stitched conversations for {stitched} day(s)")
        except Exception as e:
            log(f"Conversation stitching error: {e}")

    if changed:
        save_jobs(jobs)

    return jobs


def rebuild_jobs() -> dict:
    """Rebuild jobs.json from filesystem state (crash recovery)."""
    log("Rebuilding jobs.json from filesystem...")
    jobs = load_jobs()
    initial_count = len(jobs)

    # Scan done/ for all transcripts
    if DONE_DIR.exists():
        for transcript_file in sorted(DONE_DIR.glob("*.json")):
            if transcript_file.name.startswith(".") or ".error." in transcript_file.name:
                continue
            stem = transcript_file.stem
            data = get_transcript_data(stem)
            if data is None:
                continue
            existing = jobs.get(stem)
            jobs[stem] = build_job_entry(stem, data, existing)

    # Scan inbox/ for WAVs without job entries
    if INBOX_DIR.exists():
        for wav in INBOX_DIR.glob("*.wav"):
            stem = wav.stem
            if stem not in jobs:
                jobs[stem] = {
                    "source": get_source(stem),
                    "audioFile": wav.name,
                    "createdAt": now_iso(),
                    "status": "queued",
                    "stages": {"ingested": now_iso(), "transcribed": None, "speaker_id": None, "curator_synced": None},
                    "pipelineStatus": "",
                    "speakerIdentification": {"identified": {}, "unidentified": []},
                    "playbackFile": None,
                    "curatorPath": None,
                    "error": None,
                }

    # Update playback file references
    if PLAYBACK_DIR.exists():
        for wav in PLAYBACK_DIR.glob("*.wav"):
            stem = wav.stem
            if stem in jobs:
                jobs[stem]["playbackFile"] = wav.name

    # Mark synced entries
    if DONE_DIR.exists():
        for marker in DONE_DIR.glob(f"*{MARKER_SUFFIX}"):
            stem = marker.name.replace(f".json{MARKER_SUFFIX}", "")
            if stem in jobs and jobs[stem]["status"] == "complete":
                jobs[stem]["status"] = "curator_synced"

    save_jobs(jobs)
    log(f"Rebuilt jobs.json: {initial_count} existing + {len(jobs) - initial_count} new = {len(jobs)} total")
    return jobs


def main():
    parser = argparse.ArgumentParser(description="Pipeline Orchestrator — transcript lifecycle manager")
    parser.add_argument("--once", action="store_true", help="Run once then exit")
    args = parser.parse_args()

    # Ensure directories exist
    PLAYBACK_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)

    log("Pipeline Orchestrator starting")
    log(f"  Inbox:    {INBOX_DIR}")
    log(f"  Done:     {DONE_DIR}")
    log(f"  Playback: {PLAYBACK_DIR}")
    log(f"  Jobs:     {JOBS_FILE}")
    log(f"  Curator:  {CURATOR_VOICE_DIR}")
    log(f"  Pending:  {PENDING_DIR}")

    # Rebuild on startup (crash recovery)
    jobs = rebuild_jobs()

    # Initial scan
    jobs = scan_once(jobs)
    log(f"Initial scan complete: {len(jobs)} jobs tracked")

    if args.once:
        return

    # Continuous watch
    log(f"Watching for changes (poll interval: {POLL_INTERVAL}s)")
    while True:
        time.sleep(POLL_INTERVAL)
        try:
            jobs = scan_once(jobs)
        except Exception as e:
            log(f"Scan error: {e}")


if __name__ == "__main__":
    main()
```

**Step 2: Test the orchestrator in one-shot mode**

Run: `python3 scripts/voice/pipeline-orchestrator.py --once`
Expected: Builds `~/oasis-audio/jobs.json` from existing done/ and inbox/ files. Should log the rebuild count and any status changes. Verify `~/oasis-audio/jobs.json` exists and contains entries.

**Step 3: Verify jobs.json contents**

Run: `python3 -c "import json; d=json.load(open('$HOME/oasis-audio/jobs.json')); statuses={}; [statuses.__setitem__(v['status'], statuses.get(v['status'],0)+1) for v in d.values()]; print(f'Total: {len(d)}'); [print(f'  {k}: {v}') for k,v in sorted(statuses.items())]"`
Expected: Shows status distribution. Most should be `curator_synced` (the 11 fully identified) or `pending_curator` (the ones with unidentified speakers). Some `skipped`. WAVs without transcripts should be `queued`.

**Step 4: Commit**

```bash
git add scripts/voice/pipeline-orchestrator.py
git commit -m "feat(voice): add pipeline orchestrator with job queue and curator gating"
```

---

### Task 4: Update launchd plist to use orchestrator

Switch the `com.oasis.transcript-sync` service from `sync-transcripts.py` to `pipeline-orchestrator.py`. Archive the old script.

**Files:**

- Modify: `~/Library/LaunchAgents/com.oasis.transcript-sync.plist`
- Move: `scripts/voice/sync-transcripts.py` → `scripts/voice/archived/sync-transcripts.py`

**Step 1: Stop the current sync service**

Run: `launchctl unload ~/Library/LaunchAgents/com.oasis.transcript-sync.plist`
Expected: Service stops. Verify with `launchctl list | grep transcript-sync` (should return nothing).

**Step 2: Archive sync-transcripts.py**

Run: `mkdir -p scripts/voice/archived && mv scripts/voice/sync-transcripts.py scripts/voice/archived/sync-transcripts.py`
Expected: File moved. Verify with `ls scripts/voice/archived/sync-transcripts.py`.

**Step 3: Update the plist**

Write the updated plist to `~/Library/LaunchAgents/com.oasis.transcript-sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.oasis.transcript-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/oasis/openclaw/scripts/voice/pipeline-orchestrator.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/oasis/.openclaw/logs/transcript-sync.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/oasis/.openclaw/logs/transcript-sync.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>ORCHESTRATOR_POLL_INTERVAL</key>
        <string>5</string>
    </dict>
</dict>
</plist>
```

**Step 4: Load the new service**

Run: `launchctl load ~/Library/LaunchAgents/com.oasis.transcript-sync.plist`
Expected: Service starts. Verify with:

- `launchctl list | grep transcript-sync` (should show PID)
- `tail -20 ~/.openclaw/logs/transcript-sync.log` (should show orchestrator startup log)

**Step 5: Commit**

```bash
git add scripts/voice/archived/sync-transcripts.py
git commit -m "feat(voice): switch launchd service to pipeline orchestrator, archive sync-transcripts.py"
```

---

### Task 5: Update dashboard audio route for playback/ directory

Update `GET /api/voice/audio/:filename` to check `playback/` first, then fall back to `inbox/`.

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js:586-611`

**Step 1: Update the audio route**

Find the audio route at line 586 and replace it. The current code checks `AUDIO_DIR` (inbox) then `AUDIO_DONE_DIR` (done). Replace with: check `PLAYBACK_DIR` first, then `AUDIO_DIR` (inbox), then `AUDIO_DONE_DIR` (done).

Add the `AUDIO_PLAYBACK_DIR` constant near line 24 (after `AUDIO_DONE_DIR`):

```javascript
const AUDIO_PLAYBACK_DIR =
  process.env.AUDIO_PLAYBACK_DIR || join(process.env.HOME || "/root", "oasis-audio", "playback");
```

Replace the audio route (lines 586-611) with:

```javascript
// GET /audio/:filename — serve audio file (playback/ → inbox/ → done/ fallback)
router.get("/audio/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename format" });
    }

    // Check playback/ first (permanent storage for processed audio)
    const playbackPath = resolve(AUDIO_PLAYBACK_DIR, filename);
    if (playbackPath.startsWith(resolve(AUDIO_PLAYBACK_DIR) + "/") && existsSync(playbackPath)) {
      return res.sendFile(playbackPath);
    }

    // Fallback to inbox/ (in-progress files)
    const inboxPath = resolve(AUDIO_DIR, filename);
    if (inboxPath.startsWith(resolve(AUDIO_DIR) + "/") && existsSync(inboxPath)) {
      return res.sendFile(inboxPath);
    }

    // Fallback to done/ (legacy)
    const donePath = resolve(AUDIO_DONE_DIR, filename);
    if (donePath.startsWith(resolve(AUDIO_DONE_DIR) + "/") && existsSync(donePath)) {
      return res.sendFile(donePath);
    }

    return res.status(404).json({ error: "Audio file not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Add the playback volume mount to docker-compose.yml**

The dashboard container needs read access to the playback directory. Add this volume mount to the `oasis-dashboard` service in `docker-compose.yml`:

```yaml
- ~/oasis-audio/playback:/audio/playback:ro
```

And update `AUDIO_PLAYBACK_DIR` in the environment or make the default path work inside Docker. Since inside Docker the home is `/root`, add an environment variable to the dashboard service:

Actually, the `AUDIO_DIR` already resolves based on `process.env.HOME`. Inside Docker, playback would be at `/root/oasis-audio/playback` which doesn't exist — the volume mount maps to `/audio/playback`. So either:

1. Mount at the correct path, or
2. Set `AUDIO_PLAYBACK_DIR=/audio/playback` as an env var

The simplest approach: add the volume mount and use the env var.

In `docker-compose.yml`, under the `oasis-dashboard` service volumes, add:

```yaml
- ~/oasis-audio/playback:/audio/playback:ro
```

And update the `AUDIO_PLAYBACK_DIR` default in voice.js to also check `/audio/playback`:

```javascript
const AUDIO_PLAYBACK_DIR = process.env.AUDIO_PLAYBACK_DIR || "/audio/playback";
```

**Step 3: Test audio serving**

Run: `curl -s -o /dev/null -w "%{http_code}" http://192.168.4.186:3000/api/voice/audio/recording_20260226_172536.wav`
Expected: 200 (file should now be in playback/ after the backfill). If 404, check that the Docker container was restarted with the new volume mount.

**Step 4: Commit**

The voice.js file is outside the git repo (at `~/.openclaw/workspace-oasis/dashboard/`), so there's no git commit for this change. The docker-compose.yml change is in the repo:

```bash
git add docker-compose.yml
git commit -m "feat(voice): add playback volume mount for dashboard audio serving"
```

---

### Task 6: Add jobs API endpoint to dashboard

Add `GET /api/voice/jobs` endpoint that returns the job queue manifest for dashboard consumption.

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js`

**Step 1: Add the JOBS_FILE constant**

Near the other constants (around line 25), add:

```javascript
const JOBS_FILE =
  process.env.JOBS_FILE || join(process.env.HOME || "/root", "oasis-audio", "jobs.json");
```

Inside Docker, jobs.json is at `~/oasis-audio/jobs.json`. The `oasis-audio` parent is already volume-mounted via `~/oasis-audio/done:/audio/done`. We need to add a mount for the jobs file. Add to the dashboard service in `docker-compose.yml`:

```yaml
- ~/oasis-audio/jobs.json:/audio/jobs.json:ro
```

And update the constant:

```javascript
const JOBS_FILE = process.env.JOBS_FILE || "/audio/jobs.json";
```

**Step 2: Add the jobs route**

Add this route after the existing pipeline routes (after line 858):

```javascript
// GET /jobs — return job queue manifest for pipeline observability
router.get("/jobs", async (req, res) => {
  try {
    if (!existsSync(JOBS_FILE)) {
      return res.json({ jobs: {}, counts: {} });
    }
    const jobs = JSON.parse(await readFile(JOBS_FILE, "utf-8"));

    // Compute status counts
    const counts = {};
    for (const job of Object.values(jobs)) {
      counts[job.status] = (counts[job.status] || 0) + 1;
    }

    res.json({ jobs, counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 3: Update the pipeline route to include job counts**

In the existing `GET /pipeline` route (line 685), add job manifest data. After computing `queue` (around line 800), add:

```javascript
      // Job manifest counts
      jobCounts: await (async () => {
        try {
          if (!existsSync(JOBS_FILE)) return {};
          const jobs = JSON.parse(await readFile(JOBS_FILE, "utf-8"));
          const counts = {};
          for (const job of Object.values(jobs)) {
            counts[job.status] = (counts[job.status] || 0) + 1;
          }
          return counts;
        } catch { return {}; }
      })(),
```

**Step 4: Test the endpoint**

Run: `curl -s http://oasis:ReadyPlayer%401@192.168.4.186:3000/api/voice/jobs | python3 -m json.tool | head -20`
Expected: JSON response with `jobs` object and `counts` summary.

**Step 5: Commit docker-compose changes**

```bash
git add docker-compose.yml
git commit -m "feat(voice): add jobs.json volume mount and jobs API endpoint"
```

---

### Task 7: Update label-speaker route for curator gate integration

When a speaker is labeled, update `jobs.json` and remove the `.synced` marker so the orchestrator re-evaluates the transcript for curator sync.

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js:168-231`

**Step 1: Add jobs.json update to label-speaker handler**

After the successful label response (after line 219, before `res.json`), add code to update `jobs.json` and remove the synced marker. Replace the success block (lines 219-227) with:

```javascript
// Update jobs.json to trigger orchestrator re-evaluation
try {
  const jobsPath = JOBS_FILE;
  if (existsSync(jobsPath)) {
    const allJobs = JSON.parse(await readFile(jobsPath, "utf-8"));
    // Find the job for this transcript's audio file
    const audioBaseName = audioPath.replace(/\.wav$/, "");
    if (allJobs[audioBaseName]) {
      const job = allJobs[audioBaseName];
      // Remove .synced marker to trigger re-gate
      const marker = resolve(AUDIO_DONE_DIR, `${audioBaseName}.json.synced`);
      if (existsSync(marker)) {
        await unlink(marker);
      }
      // Update speaker identification from fresh transcript data
      const freshData = JSON.parse(
        await readFile(resolve(AUDIO_DONE_DIR, `${audioBaseName}.json`), "utf-8"),
      );
      const si = freshData.speaker_identification || {};
      job.speakerIdentification = {
        identified: si.identified || {},
        unidentified: si.unidentified || [],
      };
      // Check if all speakers are now identified
      if (!si.unidentified || si.unidentified.length === 0) {
        job.status = "complete";
      } else {
        job.status = "pending_curator";
      }
      await writeFile(jobsPath, JSON.stringify(allJobs, null, 2));
    }
  }
} catch (jobErr) {
  // Non-fatal: orchestrator will catch up on next poll
  console.error("Failed to update jobs.json:", jobErr.message);
}

logActivity("voice", null, `Labeled ${speakerId} as '${sanitizedName}' in transcript ${id}`);
res.json({
  ok: true,
  name: sanitizedName,
  speakerId,
  profileUpdated: result.data.profile_updated || false,
  embeddingsAdded: result.data.embeddings_added || 0,
  message: result.data.message || `Speaker '${sanitizedName}' labeled.`,
  curatorStatus: "re-evaluating",
});
```

**Step 2: Verify the update works**

After labeling a speaker in the dashboard, check:

- `cat ~/oasis-audio/jobs.json | python3 -c "import json,sys; d=json.load(sys.stdin); [print(k,v['status']) for k,v in d.items() if v['status']=='complete']"` — should show the re-evaluated transcript
- The orchestrator log should show "Re-evaluating" and "Synced to curator" within 5 seconds

**Step 3: No git commit needed** (voice.js is outside repo)

---

### Task 8: Update dashboard UI — pending curator badge

Add a visual badge on transcript cards that have unidentified speakers, showing "Pending Curator" status.

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Add CSS for the pending badge**

In the `styles()` getter, add:

```css
.pending-curator-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 152, 0, 0.15);
  color: #ff9800;
  border: 1px solid rgba(255, 152, 0, 0.3);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.pending-curator-badge::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff9800;
  animation: pulse 2s ease-in-out infinite;
}
```

**Step 2: Add the badge to transcript cards**

In the `_renderTranscriptCard` method (or wherever transcript list items are rendered), add the badge when the transcript has unidentified speakers. Look for where the transcript card renders speaker info, and add after the speaker count:

```javascript
${(() => {
  const si = t.speaker_identification || {};
  const unid = si.unidentified || [];
  return unid.length > 0
    ? html`<span class="pending-curator-badge">Pending Curator</span>`
    : '';
})()}
```

**Step 3: Add toast when all speakers identified**

In the `_onUtteranceSpeakerChange` method (or the label-speaker success handler), add a check: if the response indicates all speakers are now identified, show a success toast:

```javascript
if (resp.curatorStatus === "re-evaluating") {
  this._showToast("All speakers identified — syncing to Curator", "success");
}
```

**Step 4: Verify in browser**

Navigate to `http://192.168.4.186:3000/#/knowledge`, click "Transcripts" tab.
Expected: Transcripts with unidentified speakers show an orange "Pending Curator" badge. Transcripts where all speakers are identified do not show the badge.

**Step 5: No git commit needed** (page-knowledge.js is outside repo)

---

### Task 9: Update pipeline tab to show job queue counts

Update the pipeline visualization to display job manifest status counts from `jobs.json`.

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Add CSS for job status summary**

In the `styles()` getter, add:

```css
.job-status-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}
.job-status-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}
.job-status-item .count {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
}
.job-status-item .label {
  font-size: 0.7rem;
  color: var(--text-secondary, #999);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
}
.job-status-item.pending-curator .count {
  color: #ff9800;
}
.job-status-item.failed .count {
  color: #f44336;
}
.job-status-item.complete .count {
  color: #4caf50;
}
.job-status-item.processing .count {
  color: #2196f3;
}
```

**Step 2: Add job counts to the pipeline render**

In the pipeline section render method, after the existing pipeline stage cards, add a job status summary section:

```javascript
${this._voicePipeline?.jobCounts ? html`
  <div class="section-header" style="margin-top: 16px;">
    <h3>Job Queue</h3>
  </div>
  <div class="job-status-summary">
    ${Object.entries(this._voicePipeline.jobCounts).map(([status, count]) => html`
      <div class="job-status-item ${status}">
        <span class="count">${count}</span>
        <span class="label">${status.replace(/_/g, ' ')}</span>
      </div>
    `)}
  </div>
` : ''}
```

**Step 3: Verify in browser**

Navigate to pipeline tab. Expected: Job queue summary grid showing counts for each status (queued, processing, pending_curator, curator_synced, skipped, failed, etc.).

**Step 4: No git commit needed** (page-knowledge.js is outside repo)

---

### Task 10: Rebuild and restart dashboard container

Apply all dashboard changes by rebuilding the Docker container.

**Files:**

- Modify: `docker-compose.yml` (volume mounts already added in Tasks 5-6)

**Step 1: Verify docker-compose.yml has all volume mounts**

Check that the `oasis-dashboard` service has these volume mounts:

```yaml
- ~/oasis-audio/playback:/audio/playback:ro
- ~/oasis-audio/jobs.json:/audio/jobs.json:ro
```

**Step 2: Rebuild and restart the dashboard**

Run: `docker compose build oasis-dashboard && docker compose up -d oasis-dashboard`
Expected: Container rebuilds with new multer dependency and restarts. Verify with `docker ps --filter name=oasis-dashboard` (should show healthy status).

**Step 3: Verify all endpoints work**

Run these checks:

```bash
# Audio playback from new directory
curl -s -o /dev/null -w "%{http_code}" http://oasis:ReadyPlayer%401@192.168.4.186:3000/api/voice/audio/recording_20260226_172536.wav

# Jobs endpoint
curl -s http://oasis:ReadyPlayer%401@192.168.4.186:3000/api/voice/jobs | python3 -c "import json,sys; d=json.load(sys.stdin); print('Counts:', d.get('counts', {}))"

# Pipeline endpoint includes jobCounts
curl -s http://oasis:ReadyPlayer%401@192.168.4.186:3000/api/voice/pipeline | python3 -c "import json,sys; d=json.load(sys.stdin); print('Job counts:', d.get('jobCounts', {}))"
```

Expected: All return 200 with valid data.

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(voice): rebuild dashboard with playback and jobs volume mounts"
```

---

### Task 11: End-to-end verification

Verify the complete pipeline works: orchestrator running, curator gating enforced, dashboard showing correct data.

**Step 1: Verify orchestrator is running**

Run: `launchctl list | grep transcript-sync`
Expected: Shows PID and exit status 0.

Run: `tail -30 ~/.openclaw/logs/transcript-sync.log`
Expected: Shows orchestrator startup, rebuild, and polling messages.

**Step 2: Verify curator gating**

Run: `python3 -c "
import json
from pathlib import Path

# Check no unidentified transcripts in curator (only \_pending/)

curator = Path.home() / '.openclaw/workspace-curator/transcripts/voice'
pending = curator / '\_pending'

active = 0
unid_active = 0
pending_count = 0

import os
for root, dirs, files in os.walk(curator):
if '\_pending' in root:
pending_count += len([f for f in files if f.endswith('.json') and f != 'conversations.json'])
continue
for f in files:
if f.endswith('.json') and f != 'conversations.json':
try:
data = json.loads((Path(root) / f).read_text())
si = data.get('speaker_identification', {})
if si.get('unidentified'):
unid_active += 1
active += 1
except: pass

print(f'Active curator transcripts: {active}')
print(f' With unidentified speakers (BUG if > 0): {unid_active}')
print(f'Pending review: {pending_count}')
"`Expected:`unid_active`should be 0 (no unidentified transcripts in active curator).`pending_count` should be ~61.

**Step 3: Verify jobs.json accuracy**

Run: `python3 -c "
import json
d = json.load(open('$HOME/oasis-audio/jobs.json'))
statuses = {}
for v in d.values():
    s = v['status']
    statuses[s] = statuses.get(s, 0) + 1
print(f'Total jobs: {len(d)}')
for k, v in sorted(statuses.items()):
    print(f'  {k}: {v}')
"`
Expected: Shows distribution with `pending_curator` (unidentified, held), `curator_synced` (identified, pushed), `skipped` (too short), etc.

**Step 4: Verify audio playback from playback/ directory**

Run: `ls ~/oasis-audio/playback/ | wc -l`
Expected: Should match the number of WAVs moved during backfill.

Run: `ls ~/oasis-audio/inbox/ | wc -l`
Expected: Should be much smaller than before (only in-progress or very recent files).

**Step 5: Verify dashboard UI**

Navigate to `http://192.168.4.186:3000/#/knowledge`:

1. **Pipeline tab:** Should show job queue counts
2. **Transcripts tab:** Transcripts with unidentified speakers should show "Pending Curator" badge
3. **Audio playback:** Click a transcript and play audio — should work (served from playback/)

---

## Summary of All Files

### New Files (in git repo)

| File                                         | Purpose                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `scripts/voice/pipeline-orchestrator.py`     | Pipeline orchestrator daemon (replaces sync-transcripts.py) |
| `scripts/voice/backfill-playback.py`         | One-time WAV migration from inbox/ to playback/             |
| `scripts/voice/migrate-curator-backlog.py`   | One-time curator backlog migration to \_pending/            |
| `scripts/voice/archived/sync-transcripts.py` | Archived original sync script                               |

### Modified Files (in git repo)

| File                 | Changes                                                   |
| -------------------- | --------------------------------------------------------- |
| `docker-compose.yml` | Added playback/ and jobs.json volume mounts for dashboard |

### Modified Files (outside git repo — dashboard)

| File                                                                              | Changes                                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js`                    | Updated audio route (playback/), added jobs endpoint, label-speaker curator gate integration |
| `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js` | Pending curator badge, job queue counts in pipeline tab                                      |

### Modified Files (outside git repo — system)

| File                                                     | Changes                                         |
| -------------------------------------------------------- | ----------------------------------------------- |
| `~/Library/LaunchAgents/com.oasis.transcript-sync.plist` | Script path updated to pipeline-orchestrator.py |

### New Runtime Files

| File                                                        | Purpose                                  |
| ----------------------------------------------------------- | ---------------------------------------- |
| `~/oasis-audio/jobs.json`                                   | Job queue manifest                       |
| `~/oasis-audio/playback/`                                   | Permanent audio storage for dashboard    |
| `~/.openclaw/workspace-curator/transcripts/voice/_pending/` | Held transcripts awaiting identification |
