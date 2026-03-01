#!/usr/bin/env python3
"""Approve a speaker candidate. Called by the dashboard API."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from unknown_speaker_tracker import UnknownSpeakerTracker

if len(sys.argv) != 3:
    print("Usage: approve_speaker.py <speaker_id> <name>", file=sys.stderr)
    sys.exit(1)

speaker_id = sys.argv[1]
name = sys.argv[2]

tracker = UnknownSpeakerTracker()
try:
    profile_path = tracker.approve_candidate(speaker_id, name)
    print(f"SUCCESS:{profile_path}")
except Exception as e:
    print(f"ERROR:{e}", file=sys.stderr)
    sys.exit(1)
