#!/usr/bin/env python3
"""Sync transcripts from Docker audio pipeline to curator/dashboard.

Watches ~/oasis-audio/done/ for transcript JSONs (from AssemblyAI pipeline),
converts them into the dashboard-expected format, and saves to the curator workspace.

Can run as a one-shot backfill or as a continuous daemon.

Usage:
    python3 sync-transcripts.py              # Continuous daemon
    python3 sync-transcripts.py --once       # One-shot backfill, then exit
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

SOURCE_DIR = Path.home() / "oasis-audio" / "done"
CURATOR_VOICE_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"
MARKER_SUFFIX = ".synced"
POLL_INTERVAL = int(os.getenv("SYNC_POLL_INTERVAL", "5"))


def log(msg: str):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [sync] {msg}", flush=True)


def convert_and_save(src: Path) -> bool:
    """Convert a transcript JSON to dashboard format and save to curator dir.
    Returns True if a file was saved, False otherwise.
    """
    name = src.name

    # Skip non-transcript files (error files, cost tracking, etc.)
    if ".error." in name or name.startswith("."):
        return False

    # Check if already synced; re-sync if source was modified after sync marker
    marker = src.with_name(name + MARKER_SUFFIX)
    if marker.exists():
        src_mtime = src.stat().st_mtime
        marker_mtime = marker.stat().st_mtime
        if src_mtime > marker_mtime:
            log(f"Re-sync: source modified after sync for {name}")
            marker.unlink()
        else:
            return False

    try:
        with open(src) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log(f"ERROR reading {name}: {e}")
        marker.touch()
        return False

    segments = data.get("segments", [])
    if not segments:
        marker.touch()
        return False

    # Readiness gate: don't sync until pipeline has finished processing.
    # pipeline_status is set by assemblyai_transcriber after each stage.
    # Transcripts must be fully diarized AND speaker-identified before syncing.
    pipeline_status = data.get("pipeline_status", "")
    if pipeline_status == "skipped_too_short":
        # Audio was too short for transcription — mark synced and skip
        marker.touch()
        return False
    if pipeline_status == "transcribed":
        # Still in pipeline (speaker ID hasn't run yet), skip
        return False
    elif pipeline_status == "speaker_id_failed":
        # Speaker ID failed — block sync. The auto-retry thread in
        # audio-listener will re-process once the encoder recovers.
        # Safety valve: sync after SPEAKER_ID_MAX_WAIT_HOURS to prevent
        # infinite accumulation if encoder never recovers.
        file_age_hours = (time.time() - src.stat().st_mtime) / 3600
        max_wait = int(os.getenv("SPEAKER_ID_MAX_WAIT_HOURS", "168"))  # 7 days
        if file_age_hours < max_wait:
            # Log periodically (roughly every hour) so operators know
            if int(file_age_hours) > 0 and int(file_age_hours * 60) % 60 < 1:
                log(f"BLOCKED: {name} awaiting speaker ID retry ({file_age_hours:.0f}h / {max_wait}h max)")
            return False
        log(f"WARNING: {name} exceeded {max_wait}h wait for speaker ID — syncing without names")
    elif pipeline_status == "complete":
        # Check if ALL speakers are unidentified — if so, hold briefly
        # to give time for profile enrollment + re-identification
        si = data.get("speaker_identification", {})
        identified = si.get("identified", {})
        unidentified = si.get("unidentified", [])
        if unidentified and not identified:
            # All speakers unknown — hold for a grace period to allow
            # profile enrollment + reidentify to fill in names.
            # Use the transcript's internal timestamp (recording time),
            # not file mtime which resets on every re-identification run.
            grace_hours = int(os.getenv("UNIDENTIFIED_GRACE_HOURS", "2"))
            if grace_hours > 0:
                ts_str = data.get("timestamp", "")
                try:
                    rec_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    age_hours = (datetime.now(rec_time.tzinfo) - rec_time).total_seconds() / 3600
                except (ValueError, TypeError):
                    age_hours = float("inf")  # Can't parse — don't block
                if age_hours < grace_hours:
                    return False  # Still within grace period
                # Grace expired — sync with generic speaker labels
    elif pipeline_status == "complete_no_speaker_id":
        pass  # Identification disabled, proceed
    elif not pipeline_status:
        pass  # Legacy transcript (no pipeline_status), backward-compatible sync

    # Parse timestamp
    ts_str = data.get("timestamp", "")
    ts = None
    if ts_str:
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except ValueError:
            pass

    if ts is None:
        stem = src.stem
        try:
            parts = stem.split("_")
            ts = datetime.strptime(f"{parts[1]}_{parts[2]}", "%Y%m%d_%H%M%S")
        except (IndexError, ValueError):
            ts = datetime.utcnow()

    # Build transcript text
    full_text = " ".join(seg.get("text", "").strip() for seg in segments).strip()
    if not full_text:
        marker.touch()
        return False

    # Duration
    duration = max((seg.get("end", 0) for seg in segments), default=0)

    # Speakers
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
        utterances.append(
            {
                "speaker": sname or sid,
                "text": text,
                "start": seg.get("start", 0),
                "end": seg.get("end", 0),
            }
        )

    result = {
        "timestamp": ts.isoformat() + "Z",
        "duration": round(duration),
        "transcript": full_text,
        "audioPath": data.get("file", ""),
        "speakers": list(speakers_map.values()),
        "numSpeakers": len(speakers_map),
        "utterances": utterances,
        "source": "voice-passive",
        "model": data.get("model", "unknown"),
        "diarization": has_diarization,
        "pipeline_status": pipeline_status or "legacy",
        "confidence": data.get("assemblyai", {}).get("confidence"),
        "speaker_id_error": data.get("speaker_id_error"),
        "speaker_id_retry_count": data.get("speaker_id_retry_count", 0),
    }

    # Include AssemblyAI metadata if present
    if "assemblyai" in data:
        result["assemblyai"] = data["assemblyai"]

    # Include speaker identification results if present
    if "speaker_identification" in data:
        result["speaker_identification"] = data["speaker_identification"]

    # Save: YYYY/MM/DD/HH-MM-SS[-diarized].json
    date_dir = CURATOR_VOICE_DIR / ts.strftime("%Y/%m/%d")
    date_dir.mkdir(parents=True, exist_ok=True)

    time_prefix = ts.strftime('%H-%M-%S')
    suffix = "-diarized" if has_diarization else ""

    # On re-sync (manual labels, etc.), find and overwrite
    # any existing curator file for the same audio recording
    audio_file = data.get("file", "")
    found_existing = False
    out_file = date_dir / f"{time_prefix}{suffix}.json"
    for existing in date_dir.glob(f"{time_prefix}*.json"):
        try:
            existing_data = json.loads(existing.read_text(encoding="utf-8"))
            if existing_data.get("audioPath") == audio_file:
                out_file = existing
                found_existing = True
                log(f"Re-sync: overwriting {existing.name}")
                break
        except (json.JSONDecodeError, OSError):
            continue

    # Avoid collisions for genuinely new files only
    if not found_existing and out_file.exists():
        counter = 1
        while out_file.exists():
            out_file = date_dir / f"{time_prefix}{suffix}-{counter}.json"
            counter += 1

    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)

    marker.touch()
    log(f"Synced: {name} -> {out_file.relative_to(CURATOR_VOICE_DIR)}")
    return True


def scan_once() -> int:
    """Scan source directory once. Returns number of files synced."""
    if not SOURCE_DIR.exists():
        return 0

    count = 0
    for f in sorted(SOURCE_DIR.glob("*.json")):
        try:
            if convert_and_save(f):
                count += 1
        except Exception as e:
            log(f"ERROR processing {f.name}: {e}")

    # Run conversation stitching after syncing new transcripts
    if count > 0:
        try:
            from stitch_conversations import stitch_all_days
            stitched = stitch_all_days(incremental=True)
            if stitched:
                log(f"Stitched conversations for {stitched} day(s)")
        except Exception as e:
            log(f"Conversation stitching error: {e}")

    return count


def main():
    parser = argparse.ArgumentParser(description="Sync transcripts to curator/dashboard")
    parser.add_argument("--once", action="store_true", help="Run once (backfill) then exit")
    args = parser.parse_args()

    CURATOR_VOICE_DIR.mkdir(parents=True, exist_ok=True)

    log(f"Source: {SOURCE_DIR}")
    log(f"Dest:   {CURATOR_VOICE_DIR}")

    # Initial backfill
    count = scan_once()
    log(f"Backfill complete: {count} transcripts synced")

    if args.once:
        return

    # Continuous watch
    log(f"Watching for new transcripts (poll interval: {POLL_INTERVAL}s)")
    while True:
        time.sleep(POLL_INTERVAL)
        try:
            scan_once()
        except Exception as e:
            log(f"Scan error: {e}")


if __name__ == "__main__":
    main()
