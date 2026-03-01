#!/usr/bin/env python3
"""Backfill unprocessed audio files through AssemblyAI.

Scans ~/oasis-audio/inbox/ for WAV files that have no matching transcript
JSON in ~/oasis-audio/done/, then submits each to AssemblyAI Universal-2
for transcription + diarization, runs speaker identification, and saves
results — same format as the ongoing pipeline.

Usage:
    python3 backfill-assemblyai.py                  # Process all unprocessed WAVs
    python3 backfill-assemblyai.py --dry-run        # Show what would be processed
    python3 backfill-assemblyai.py --limit 10       # Process at most 10 files
    python3 backfill-assemblyai.py --min-duration 5 # Skip files shorter than 5 seconds
"""
import argparse
import json
import os
import sys
import time
import wave
from datetime import datetime
from pathlib import Path

# Add audio-listener dir to path so we can reuse the transcriber module
AUDIO_LISTENER_DIR = Path(__file__).resolve().parent.parent.parent / "audio-listener"
sys.path.insert(0, str(AUDIO_LISTENER_DIR))

INBOX_DIR = Path.home() / "oasis-audio" / "inbox"
DONE_DIR = Path.home() / "oasis-audio" / "done"
VOICE_PROFILES_DIR = Path.home() / ".openclaw" / "voice-profiles"
UNKNOWN_SPEAKERS_DIR = Path.home() / ".openclaw" / "unknown-speakers"


def log(msg: str):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [backfill] {msg}", flush=True)


def get_wav_duration(path: Path) -> float:
    """Get duration of a WAV file in seconds."""
    try:
        with wave.open(str(path), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate()
            return frames / rate if rate > 0 else 0
    except Exception:
        return 0


def find_unprocessed(min_duration: float = 1.0) -> list[Path]:
    """Find WAV files in inbox that have no matching JSON in done."""
    if not INBOX_DIR.exists():
        log(f"Inbox directory does not exist: {INBOX_DIR}")
        return []

    unprocessed = []
    for wav in sorted(INBOX_DIR.glob("*.wav")):
        base = wav.stem
        transcript = DONE_DIR / f"{base}.json"
        if transcript.exists():
            continue
        duration = get_wav_duration(wav)
        if duration < min_duration:
            log(f"Skipping {wav.name} (duration {duration:.1f}s < {min_duration}s)")
            continue
        unprocessed.append(wav)

    return unprocessed


def main():
    parser = argparse.ArgumentParser(description="Backfill unprocessed audio via AssemblyAI")
    parser.add_argument("--dry-run", action="store_true", help="Show files to process without submitting")
    parser.add_argument("--limit", type=int, default=0, help="Max files to process (0 = all)")
    parser.add_argument("--min-duration", type=float, default=1.5, help="Min WAV duration in seconds (default: 1.5)")
    args = parser.parse_args()

    api_key = os.getenv("ASSEMBLYAI_API_KEY", "")
    if not api_key and not args.dry_run:
        log("ERROR: ASSEMBLYAI_API_KEY environment variable is required")
        sys.exit(1)

    DONE_DIR.mkdir(parents=True, exist_ok=True)

    files = find_unprocessed(args.min_duration)
    if not files:
        log("No unprocessed WAV files found")
        return

    if args.limit > 0:
        files = files[:args.limit]

    total_duration = sum(get_wav_duration(f) for f in files)
    est_cost = (total_duration / 3600) * 0.17

    log(f"Found {len(files)} unprocessed WAV files")
    log(f"Total duration: {total_duration / 3600:.2f} hours")
    log(f"Estimated cost: ${est_cost:.2f}")

    if args.dry_run:
        log("Dry run — files that would be processed:")
        for f in files:
            dur = get_wav_duration(f)
            log(f"  {f.name} ({dur:.1f}s)")
        return

    # Import the transcriber module
    try:
        from assemblyai_transcriber import AssemblyAITranscriber
    except ImportError:
        log("ERROR: Cannot import assemblyai_transcriber. Make sure audio-listener/assemblyai_transcriber.py exists.")
        sys.exit(1)

    transcriber = AssemblyAITranscriber(
        api_key=api_key,
        done_dir=str(DONE_DIR),
        voice_profiles_dir=str(VOICE_PROFILES_DIR),
        unknown_speakers_dir=str(UNKNOWN_SPEAKERS_DIR),
    )

    succeeded = 0
    failed = 0

    for i, wav in enumerate(files, 1):
        log(f"[{i}/{len(files)}] Processing {wav.name}...")
        try:
            result = transcriber.submit_and_process(str(wav))
            if result:
                log(f"  OK: {result.get('assemblyai', {}).get('audio_duration', 0):.0f}s audio, "
                    f"{result.get('num_speakers', 0)} speakers, "
                    f"${result.get('assemblyai', {}).get('cost_usd', 0):.4f}")
                succeeded += 1
            else:
                log(f"  FAILED: no result returned")
                failed += 1
        except Exception as e:
            log(f"  ERROR: {e}")
            failed += 1

        # Brief pause between submissions to avoid rate limits
        if i < len(files):
            time.sleep(1)

    stats = transcriber.get_stats()
    log(f"Backfill complete: {succeeded} succeeded, {failed} failed")
    log(f"Total cost so far: ${stats.get('cost_usd', 0):.2f}")


if __name__ == "__main__":
    main()
