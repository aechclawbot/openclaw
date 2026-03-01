#!/usr/bin/env python3
"""Reject a speaker candidate. Called by the dashboard API."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from unknown_speaker_tracker import UnknownSpeakerTracker

if len(sys.argv) != 2:
    print("Usage: reject_speaker.py <speaker_id>", file=sys.stderr)
    sys.exit(1)

speaker_id = sys.argv[1]

tracker = UnknownSpeakerTracker()
try:
    tracker.reject_candidate(speaker_id)
    print("OK")
except Exception as e:
    print(f"ERROR:{e}", file=sys.stderr)
    sys.exit(1)
