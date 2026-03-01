#!/usr/bin/env python3
"""Re-run speaker identification on transcripts that failed or were skipped.

Scans /audio/done/ for transcripts with incomplete speaker identification
(pipeline_status is "speaker_id_failed", "transcribed", or missing) and
re-runs the SpeechBrain ECAPA-TDNN identification pipeline on them.

With --all, also re-identifies 'complete' transcripts that still have
unidentified speakers (useful after enrolling new voice profiles).

Requires the corresponding WAV file to still exist in /audio/inbox/.

Usage:
    python3 reidentify_speakers.py              # Process failed/incomplete only
    python3 reidentify_speakers.py --all        # Also re-identify with new profiles
    python3 reidentify_speakers.py --dry-run    # Show what would be processed
"""
import argparse
import json
import sys
from pathlib import Path

DONE_DIR = Path.home() / "oasis-audio" / "done"
INBOX_DIR = Path.home() / "oasis-audio" / "inbox"
SYNCED_SUFFIX = ".synced"

# Add audio-listener to path for speaker_verify import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "audio-listener"))


def log(msg: str):
    from datetime import datetime
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [reidentify] {msg}", flush=True)


def needs_reidentification(data, include_all=False):
    """Check if a transcript needs speaker identification re-run.

    Args:
        data: Transcript data dict.
        include_all: If True, also re-identify 'complete' transcripts that
                     have unidentified speakers (useful after enrolling
                     new voice profiles).
    """
    status = data.get("pipeline_status", "")

    # Always re-run: failed or incomplete
    if status in ("speaker_id_failed", "transcribed"):
        return True
    if not status and "speaker_identification" not in data:
        return True

    # With --all: also re-run 'complete' transcripts that have unidentified speakers
    if include_all and status == "complete":
        si = data.get("speaker_identification", {})
        if si.get("unidentified"):
            return True

    if status in ("complete", "complete_no_speaker_id"):
        return False

    return False


def main():
    parser = argparse.ArgumentParser(
        description="Re-run speaker identification on incomplete transcripts"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be processed without making changes"
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Also re-identify 'complete' transcripts that have unidentified "
             "speakers (useful after enrolling new voice profiles)"
    )
    parser.add_argument(
        "--done-dir", default=str(DONE_DIR),
        help="Transcript directory (default: ~/oasis-audio/done)"
    )
    parser.add_argument(
        "--inbox-dir", default=str(INBOX_DIR),
        help="Audio directory (default: ~/oasis-audio/inbox)"
    )
    args = parser.parse_args()

    done_dir = Path(args.done_dir)
    inbox_dir = Path(args.inbox_dir)

    if not done_dir.exists():
        log(f"Transcript directory not found: {done_dir}")
        sys.exit(1)

    # Find transcripts needing re-identification
    candidates = []
    for transcript_path in sorted(done_dir.glob("*.json")):
        if transcript_path.name.startswith("."):
            continue
        try:
            data = json.loads(transcript_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        if not needs_reidentification(data, include_all=args.all):
            continue

        audio_file = data.get("file", "")
        audio_path = inbox_dir / audio_file if audio_file else None

        candidates.append({
            "transcript_path": transcript_path,
            "audio_path": audio_path,
            "audio_file": audio_file,
            "status": data.get("pipeline_status", "<none>"),
            "data": data,
        })

    if not candidates:
        log("No transcripts need re-identification")
        return

    log(f"Found {len(candidates)} transcript(s) needing re-identification")

    if args.dry_run:
        for c in candidates:
            audio_exists = c["audio_path"] and c["audio_path"].exists()
            log(f"  {c['transcript_path'].name} "
                f"(status={c['status']}, audio={'found' if audio_exists else 'MISSING'})")
        return

    # Import speaker_verify (heavy — loads SpeechBrain)
    from speaker_verify import identify_all_speakers

    processed = 0
    skipped = 0

    for c in candidates:
        transcript_path = c["transcript_path"]
        audio_path = c["audio_path"]
        data = c["data"]

        if not audio_path or not audio_path.exists():
            log(f"SKIP {transcript_path.name}: audio file not found ({c['audio_file']})")
            skipped += 1
            continue

        log(f"Re-identifying: {transcript_path.name} (was: {c['status']})")

        try:
            data = identify_all_speakers(str(audio_path), data)
            data["pipeline_status"] = "complete"

            # Atomic write
            tmp = transcript_path.with_name(f".tmp_{transcript_path.name}")
            tmp.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            tmp.rename(transcript_path)

            # Remove .synced marker so sync-transcripts.py re-syncs
            marker = transcript_path.with_name(transcript_path.name + SYNCED_SUFFIX)
            if marker.exists():
                marker.unlink()

            identified = data.get("speaker_identification", {}).get("identified", {})
            log(f"  Done: identified {len(identified)} speaker(s)")
            processed += 1

        except Exception as e:
            log(f"  FAILED: {e}")
            skipped += 1

    log(f"Complete: {processed} processed, {skipped} skipped")


if __name__ == "__main__":
    main()
