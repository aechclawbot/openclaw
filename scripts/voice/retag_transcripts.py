#!/usr/bin/env python3
"""Retroactively update transcripts with newly identified speaker names"""
import json
import argparse
from pathlib import Path
from datetime import datetime


CURATOR_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"
CANDIDATES_DIR = Path.home() / ".openclaw" / "unknown-speakers" / "candidates"


def load_speaker_mappings():
    """Load mappings from speaker_id to assigned names from approved candidates"""
    mappings = {}

    for candidate_file in CANDIDATES_DIR.glob("*.json"):
        with open(candidate_file) as f:
            candidate = json.load(f)

        if candidate.get("status") == "approved":
            speaker_id = candidate["speaker_id"]
            assigned_name = candidate.get("assigned_name")
            if assigned_name:
                mappings[speaker_id] = assigned_name

    return mappings


def retag_transcript(transcript_path, mappings):
    """Update a single transcript file with new speaker names"""
    with open(transcript_path) as f:
        transcript = json.load(f)

    updated = False

    # Update speaker names
    for speaker in transcript.get("speakers", []):
        speaker_id = speaker.get("id")

        # Check if this speaker_id has been identified
        if speaker_id in mappings and speaker.get("name") is None:
            speaker["name"] = mappings[speaker_id]
            updated = True

    if updated:
        # Add metadata about the update
        if "metadata" not in transcript:
            transcript["metadata"] = {}

        transcript["metadata"]["retag_updated_at"] = datetime.utcnow().isoformat() + "Z"

        # Save updated transcript
        with open(transcript_path, 'w') as f:
            json.dump(transcript, f, indent=2)

        return True

    return False


def retag_all_transcripts(mappings, dry_run=False):
    """Update all transcripts with new speaker identifications"""
    if not mappings:
        print("No speaker mappings found. Run review_candidates.py first.")
        return

    print(f"Speaker mappings:")
    for speaker_id, name in mappings.items():
        print(f"  {speaker_id} → {name}")
    print()

    # Find all transcript files
    transcript_files = list(CURATOR_DIR.rglob("*.json"))
    print(f"Found {len(transcript_files)} transcript files")

    if dry_run:
        print("\n🔍 DRY RUN - No files will be modified\n")

    updated_count = 0

    for transcript_path in transcript_files:
        try:
            if dry_run:
                # Just check if it would be updated
                with open(transcript_path) as f:
                    transcript = json.load(f)

                would_update = False
                for speaker in transcript.get("speakers", []):
                    speaker_id = speaker.get("id")
                    if speaker_id in mappings and speaker.get("name") is None:
                        would_update = True
                        break

                if would_update:
                    print(f"Would update: {transcript_path.relative_to(CURATOR_DIR)}")
                    updated_count += 1
            else:
                # Actually update
                if retag_transcript(transcript_path, mappings):
                    print(f"✅ Updated: {transcript_path.relative_to(CURATOR_DIR)}")
                    updated_count += 1

        except Exception as e:
            print(f"❌ Error processing {transcript_path}: {e}")

    print(f"\n{'Would update' if dry_run else 'Updated'} {updated_count} transcript(s)")


def main():
    parser = argparse.ArgumentParser(
        description="Retroactively tag transcripts with identified speaker names"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be updated without making changes"
    )
    parser.add_argument(
        "--speaker-id",
        help="Only update transcripts for a specific speaker ID"
    )

    args = parser.parse_args()

    # Load speaker mappings from approved candidates
    mappings = load_speaker_mappings()

    if args.speaker_id:
        # Filter to specific speaker
        if args.speaker_id in mappings:
            mappings = {args.speaker_id: mappings[args.speaker_id]}
        else:
            print(f"No approved mapping found for {args.speaker_id}")
            return

    retag_all_transcripts(mappings, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
