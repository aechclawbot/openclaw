#!/usr/bin/env python3
"""Group temporally adjacent transcript segments into logical conversations.

Scans the curator voice transcripts directory (YYYY/MM/DD/) and groups
consecutive transcripts that are within a configurable time gap of each other.
When two consecutive transcripts share at least one identified speaker, an
extended gap threshold is used.

Each transcript gets a `conversationId` written back in-place, and a
`conversations.json` index is generated per day directory.

Usage:
    python3 stitch_conversations.py                # Incremental: only un-stitched days
    python3 stitch_conversations.py --reindex      # Rebuild all conversations
    python3 stitch_conversations.py --dry-run      # Preview without modifying files
    python3 stitch_conversations.py --gap 180      # Custom gap threshold (seconds)
"""
import argparse
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

CURATOR_VOICE_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"

DEFAULT_GAP_SECONDS = 120        # 2 minutes
DEFAULT_SPEAKER_GAP_SECONDS = 300  # 5 minutes


def log(msg: str):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [stitch] {msg}", flush=True)


def parse_timestamp(ts_str: str) -> datetime | None:
    """Parse an ISO timestamp string, tolerating trailing Z after offset."""
    if not ts_str:
        return None
    # Handle malformed "...+00:00Z" -> "...+00:00"
    cleaned = ts_str
    if re.search(r'[+-]\d{2}:\d{2}Z$', cleaned):
        cleaned = cleaned[:-1]
    try:
        return datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def get_speakers(transcript: dict) -> set[str]:
    """Extract named (non-null) speaker names from a transcript."""
    names = set()
    for sp in transcript.get("speakers", []):
        name = sp.get("name")
        if name and name.lower() not in ("unknown", "none"):
            names.add(name)
    return names


def get_word_count(transcript: dict) -> int:
    """Count words in the transcript text."""
    text = transcript.get("transcript", "")
    if not text:
        return 0
    return len(text.split())


def load_day_transcripts(day_dir: Path) -> list[tuple[Path, dict]]:
    """Load all transcript JSONs from a day directory, sorted by timestamp."""
    transcripts = []
    for f in day_dir.glob("*.json"):
        if f.name == "conversations.json":
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        ts = parse_timestamp(data.get("timestamp", ""))
        if ts is None:
            continue
        transcripts.append((f, data, ts))

    # Sort by timestamp
    transcripts.sort(key=lambda x: x[2])
    return [(f, d) for f, d, _ts in transcripts]


def has_unstitched(transcripts: list[tuple[Path, dict]]) -> bool:
    """Check if any transcript in a day lacks a conversationId."""
    return any("conversationId" not in data for _path, data in transcripts)


def group_conversations(
    transcripts: list[tuple[Path, dict]],
    gap_seconds: int,
    speaker_gap_seconds: int,
) -> list[list[tuple[Path, dict]]]:
    """Group transcripts into conversation clusters based on time gaps."""
    if not transcripts:
        return []

    groups: list[list[tuple[Path, dict]]] = [[transcripts[0]]]

    for i in range(1, len(transcripts)):
        prev_path, prev_data = transcripts[i - 1]
        curr_path, curr_data = transcripts[i]

        # Calculate gap: end of previous to start of current
        prev_ts = parse_timestamp(prev_data.get("timestamp", ""))
        curr_ts = parse_timestamp(curr_data.get("timestamp", ""))
        prev_duration = prev_data.get("duration", 0) or 0

        if prev_ts is None or curr_ts is None:
            # Can't determine gap, start new group
            groups.append([(curr_path, curr_data)])
            continue

        prev_end = prev_ts + timedelta(seconds=prev_duration)
        gap = (curr_ts - prev_end).total_seconds()

        # Determine threshold: use extended gap if they share a speaker
        prev_speakers = get_speakers(prev_data)
        curr_speakers = get_speakers(curr_data)
        shared = prev_speakers & curr_speakers

        threshold = speaker_gap_seconds if shared else gap_seconds

        if gap <= threshold:
            groups[-1].append((curr_path, curr_data))
        else:
            groups.append([(curr_path, curr_data)])

    return groups


def make_conversation_id(first_transcript: dict) -> str:
    """Generate a conversation ID from the first transcript's timestamp."""
    ts = parse_timestamp(first_transcript.get("timestamp", ""))
    if ts is None:
        ts = datetime.now(timezone.utc)
    return f"conv-{ts.strftime('%Y%m%d-%H%M%S')}"


def stitch_day(
    day_dir: Path,
    gap_seconds: int,
    speaker_gap_seconds: int,
    dry_run: bool = False,
) -> bool:
    """Stitch conversations for a single day directory. Returns True if work was done."""
    transcripts = load_day_transcripts(day_dir)
    if not transcripts:
        return False

    groups = group_conversations(transcripts, gap_seconds, speaker_gap_seconds)
    conversations_index = []

    for group in groups:
        first_data = group[0][1]
        conv_id = make_conversation_id(first_data)

        # Compute conversation metadata
        all_speakers: set[str] = set()
        total_words = 0
        segments = []

        start_ts = parse_timestamp(first_data.get("timestamp", ""))
        end_ts = start_ts

        for path, data in group:
            segments.append(path.name)
            all_speakers.update(get_speakers(data))
            total_words += get_word_count(data)

            ts = parse_timestamp(data.get("timestamp", ""))
            dur = data.get("duration", 0) or 0
            if ts:
                seg_end = ts + timedelta(seconds=dur)
                if end_ts is None or seg_end > end_ts:
                    end_ts = seg_end

            # Also include SPEAKER_XX IDs for un-named speakers
            for sp in data.get("speakers", []):
                sp_id = sp.get("id", "")
                sp_name = sp.get("name")
                if sp_name and sp_name.lower() not in ("unknown", "none"):
                    all_speakers.add(sp_name)
                elif sp_id:
                    all_speakers.add(sp_id)

        # Compute duration
        if start_ts and end_ts:
            duration = int((end_ts - start_ts).total_seconds())
        else:
            duration = sum((d.get("duration", 0) or 0) for _, d in group)

        conv_entry = {
            "id": conv_id,
            "startTime": start_ts.isoformat() if start_ts else None,
            "endTime": end_ts.isoformat() if end_ts else None,
            "duration": duration,
            "segments": segments,
            "speakers": sorted(all_speakers),
            "totalWords": total_words,
            "transcriptCount": len(group),
        }
        conversations_index.append(conv_entry)

        # Write conversationId back to each transcript
        if not dry_run:
            for path, data in group:
                if data.get("conversationId") != conv_id:
                    data["conversationId"] = conv_id
                    try:
                        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
                    except OSError as e:
                        log(f"ERROR writing {path.name}: {e}")

    # Write conversations.json index
    date_str = day_dir.name
    # Build full date from path: YYYY/MM/DD
    parts = []
    d = day_dir
    for _ in range(3):
        parts.insert(0, d.name)
        d = d.parent
    full_date = "-".join(parts) if len(parts) == 3 else date_str

    index = {
        "date": full_date,
        "conversations": conversations_index,
        "generated": datetime.now(timezone.utc).isoformat(),
    }

    if dry_run:
        log(f"  [dry-run] {full_date}: {len(conversations_index)} conversations from {sum(len(g) for g in groups)} transcripts")
    else:
        index_path = day_dir / "conversations.json"
        try:
            index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
        except OSError as e:
            log(f"ERROR writing conversations.json for {full_date}: {e}")

    return True


def find_day_dirs() -> list[Path]:
    """Find all YYYY/MM/DD day directories under the voice transcripts dir."""
    day_dirs = []
    if not CURATOR_VOICE_DIR.exists():
        return day_dirs

    for year_dir in sorted(CURATOR_VOICE_DIR.iterdir()):
        if not year_dir.is_dir() or not re.match(r'^\d{4}$', year_dir.name):
            continue
        for month_dir in sorted(year_dir.iterdir()):
            if not month_dir.is_dir() or not re.match(r'^\d{2}$', month_dir.name):
                continue
            for day_dir in sorted(month_dir.iterdir()):
                if not day_dir.is_dir() or not re.match(r'^\d{2}$', day_dir.name):
                    continue
                day_dirs.append(day_dir)

    return day_dirs


def stitch_all_days(
    incremental: bool = True,
    gap_seconds: int = DEFAULT_GAP_SECONDS,
    speaker_gap_seconds: int = DEFAULT_SPEAKER_GAP_SECONDS,
    dry_run: bool = False,
) -> int:
    """Stitch conversations for all day directories.

    Args:
        incremental: If True, only process days with un-stitched transcripts.
        gap_seconds: Time gap threshold for conversation grouping.
        speaker_gap_seconds: Extended gap when consecutive transcripts share a speaker.
        dry_run: If True, preview without modifying files.

    Returns:
        Number of days processed.
    """
    day_dirs = find_day_dirs()
    if not day_dirs:
        return 0

    days_processed = 0
    for day_dir in day_dirs:
        transcripts = load_day_transcripts(day_dir)
        if not transcripts:
            continue

        if incremental and not has_unstitched(transcripts):
            continue

        if stitch_day(day_dir, gap_seconds, speaker_gap_seconds, dry_run):
            days_processed += 1

    return days_processed


def main():
    parser = argparse.ArgumentParser(description="Group transcripts into conversations")
    parser.add_argument("--reindex", action="store_true", help="Rebuild all conversations (default: only un-stitched)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without modifying files")
    parser.add_argument("--gap", type=int, default=DEFAULT_GAP_SECONDS, help=f"Conversation gap threshold in seconds (default: {DEFAULT_GAP_SECONDS})")
    parser.add_argument("--speaker-gap", type=int, default=DEFAULT_SPEAKER_GAP_SECONDS, help=f"Extended gap for same-speaker continuity (default: {DEFAULT_SPEAKER_GAP_SECONDS})")
    args = parser.parse_args()

    log(f"Voice transcripts dir: {CURATOR_VOICE_DIR}")
    log(f"Gap threshold: {args.gap}s, speaker gap: {args.speaker_gap}s")

    if args.dry_run:
        log("DRY RUN - no files will be modified")

    incremental = not args.reindex
    if args.reindex:
        log("Full reindex mode")
    else:
        log("Incremental mode (un-stitched transcripts only)")

    days = stitch_all_days(
        incremental=incremental,
        gap_seconds=args.gap,
        speaker_gap_seconds=args.speaker_gap,
        dry_run=args.dry_run,
    )

    log(f"Done: processed {days} day(s)")


if __name__ == "__main__":
    main()
