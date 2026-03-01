#!/usr/bin/env python3
"""Pipeline Orchestrator — owns the transcript lifecycle from ingestion to curator.

Replaces sync-transcripts.py. Manages:
- Job queue manifest (~/oasis-audio/jobs.json)
- Curator gating (only fully-identified transcripts reach curator)
- WAV file lifecycle (inbox → playback or delete)
- Conversation stitching
- Orphan cleanup

Runs as launchd service: com.oasis.transcript-sync (polls every 5s)
Logs: ~/.openclaw/logs/transcript-sync.log

Usage:
    python3 pipeline-orchestrator.py              # Continuous daemon
    python3 pipeline-orchestrator.py --once       # One-shot scan, then exit
"""
from __future__ import annotations

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

def convert_to_curator_format(data: dict) -> tuple[dict, datetime]:
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
