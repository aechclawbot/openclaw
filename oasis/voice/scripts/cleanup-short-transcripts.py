#!/usr/bin/env python3
"""Remove transcripts for audio recordings shorter than a configurable threshold.

Scans ~/oasis-audio/done/ for transcript JSONs, checks their duration, and
removes short ones along with their .synced markers and curator-synced copies.

Duration is read from (in order of preference):
  1. assemblyai.audio_duration (most accurate, from AssemblyAI API)
  2. max(segment.end) across all segments (fallback)

Usage:
    python3 cleanup-short-transcripts.py                    # Remove short transcripts (< 10s)
    python3 cleanup-short-transcripts.py --threshold 5      # Custom threshold (5 seconds)
    python3 cleanup-short-transcripts.py --dry-run           # Preview without deleting
    python3 cleanup-short-transcripts.py --delete-source     # Also remove the source JSON
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

SOURCE_DIR = Path.home() / "oasis-audio" / "done"
CURATOR_VOICE_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"
SYNCED_SUFFIX = ".synced"


def log(msg: str):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [cleanup] {msg}", flush=True)


def get_duration(data: dict) -> float:
    """Extract audio duration from transcript data.

    Prefers assemblyai.audio_duration (seconds, from API).
    Falls back to max segment end time.
    Returns 0 if neither is available.
    """
    # Primary: AssemblyAI reported duration
    aai_duration = data.get("assemblyai", {}).get("audio_duration", 0)
    if aai_duration and aai_duration > 0:
        return float(aai_duration)

    # Fallback: max segment end time
    segments = data.get("segments", [])
    if segments:
        return max((seg.get("end", 0) for seg in segments), default=0)

    return 0


def find_curator_transcript(audio_filename: str) -> Path | None:
    """Find the curator transcript that matches a given audio filename.

    Curator transcripts are stored at:
        ~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/HH-MM-SS-diarized.json

    Each has an 'audioPath' field matching the WAV filename (e.g., recording_20260215_173450.wav).
    We scan all date directories to find a match.
    """
    if not CURATOR_VOICE_DIR.exists():
        return None

    for curator_json in CURATOR_VOICE_DIR.rglob("*.json"):
        try:
            with open(curator_json) as f:
                curator_data = json.load(f)
            if curator_data.get("audioPath") == audio_filename:
                return curator_json
        except (json.JSONDecodeError, OSError):
            continue

    return None


def scan_short_transcripts(threshold: float) -> list[dict]:
    """Scan source directory for transcripts shorter than threshold.

    Returns a list of dicts with info about each short transcript found.
    """
    if not SOURCE_DIR.exists():
        log(f"Source directory does not exist: {SOURCE_DIR}")
        return []

    results = []
    for src in sorted(SOURCE_DIR.glob("*.json")):
        name = src.name

        # Skip non-transcript files
        if ".error." in name or name.startswith("."):
            continue

        try:
            with open(src) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log(f"WARNING: cannot read {name}: {e}")
            continue

        duration = get_duration(data)
        if duration >= threshold:
            continue

        # This is a short transcript
        audio_filename = data.get("file", "")
        marker = src.with_name(name + SYNCED_SUFFIX)
        curator_path = find_curator_transcript(audio_filename) if audio_filename else None

        results.append({
            "source_json": src,
            "audio_filename": audio_filename,
            "duration": duration,
            "marker": marker if marker.exists() else None,
            "curator_transcript": curator_path,
        })

    return results


def cleanup(entries: list[dict], dry_run: bool, delete_source: bool) -> dict:
    """Remove files for short transcripts.

    Returns a summary dict with counts and file lists.
    """
    removed_markers = []
    removed_curator = []
    removed_sources = []
    errors = []

    for entry in entries:
        src = entry["source_json"]
        marker = entry["marker"]
        curator = entry["curator_transcript"]

        # Remove .synced marker
        if marker:
            if dry_run:
                log(f"  [dry-run] Would remove marker: {marker.name}")
            else:
                try:
                    marker.unlink()
                    removed_markers.append(str(marker))
                    log(f"  Removed marker: {marker.name}")
                except OSError as e:
                    errors.append(f"Failed to remove marker {marker}: {e}")
                    log(f"  ERROR removing marker {marker.name}: {e}")

        # Remove curator transcript
        if curator:
            rel = curator.relative_to(CURATOR_VOICE_DIR) if curator.is_relative_to(CURATOR_VOICE_DIR) else curator
            if dry_run:
                log(f"  [dry-run] Would remove curator transcript: {rel}")
            else:
                try:
                    curator.unlink()
                    removed_curator.append(str(curator))
                    log(f"  Removed curator transcript: {rel}")
                except OSError as e:
                    errors.append(f"Failed to remove curator {curator}: {e}")
                    log(f"  ERROR removing curator transcript {rel}: {e}")

        # Remove source JSON (only with --delete-source)
        if delete_source:
            if dry_run:
                log(f"  [dry-run] Would remove source: {src.name}")
            else:
                try:
                    src.unlink()
                    removed_sources.append(str(src))
                    log(f"  Removed source: {src.name}")
                except OSError as e:
                    errors.append(f"Failed to remove source {src}: {e}")
                    log(f"  ERROR removing source {src.name}: {e}")

    return {
        "removed_markers": removed_markers,
        "removed_curator": removed_curator,
        "removed_sources": removed_sources,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Remove transcripts for short audio recordings"
    )
    parser.add_argument(
        "--threshold", type=float, default=10.0,
        help="Duration threshold in seconds (default: 10)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview what would be removed without deleting"
    )
    parser.add_argument(
        "--delete-source", action="store_true",
        help="Also remove the source JSON from ~/oasis-audio/done/"
    )
    args = parser.parse_args()

    log(f"Source dir:  {SOURCE_DIR}")
    log(f"Curator dir: {CURATOR_VOICE_DIR}")
    log(f"Threshold:   {args.threshold}s")
    if args.dry_run:
        log("Mode: DRY RUN (no files will be deleted)")
    if args.delete_source:
        log("Flag: --delete-source (source JSONs will also be removed)")

    # Scan for short transcripts
    log("Scanning for short transcripts...")
    total_scanned = len(list(SOURCE_DIR.glob("*.json"))) if SOURCE_DIR.exists() else 0
    short_entries = scan_short_transcripts(args.threshold)

    if not short_entries:
        log(f"No short transcripts found (scanned {total_scanned} files, threshold {args.threshold}s)")
        return

    log(f"Found {len(short_entries)} short transcript(s) out of {total_scanned} total")
    log("")

    # Show each short transcript
    for entry in short_entries:
        src = entry["source_json"]
        log(f"  {src.name}  duration={entry['duration']:.1f}s  audio={entry['audio_filename']}")

    log("")

    # Perform cleanup
    summary = cleanup(short_entries, args.dry_run, args.delete_source)

    # Print summary
    log("--- Summary ---")
    log(f"Transcripts scanned:        {total_scanned}")
    log(f"Short transcripts found:    {len(short_entries)}")
    action = "would remove" if args.dry_run else "removed"
    marker_count = len(summary["removed_markers"]) if not args.dry_run else sum(1 for e in short_entries if e["marker"])
    curator_count = len(summary["removed_curator"]) if not args.dry_run else sum(1 for e in short_entries if e["curator_transcript"])
    source_count = len(summary["removed_sources"]) if not args.dry_run else (len(short_entries) if args.delete_source else 0)
    log(f"Synced markers {action}:    {marker_count}")
    log(f"Curator transcripts {action}: {curator_count}")
    if args.delete_source:
        log(f"Source JSONs {action}:       {source_count}")
    if summary["errors"]:
        log(f"Errors:                     {len(summary['errors'])}")
        for err in summary["errors"]:
            log(f"  {err}")


if __name__ == "__main__":
    main()
