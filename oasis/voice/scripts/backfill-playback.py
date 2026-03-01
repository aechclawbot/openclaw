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
