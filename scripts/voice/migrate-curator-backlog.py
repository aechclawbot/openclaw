#!/usr/bin/env python3
"""One-time migration: move unidentified transcripts to _pending/.

Scans curator workspace for transcripts where speaker_identification.unidentified
is non-empty. Moves them to _pending/ subdirectory and removes their .synced
markers so the orchestrator can re-gate them.

Usage:
    python3 migrate-curator-backlog.py              # Execute migration
    python3 migrate-curator-backlog.py --dry-run    # Preview without changes
"""
from __future__ import annotations

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
