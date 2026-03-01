#!/usr/bin/env python3
"""Review and approve unknown speaker candidates for profile building"""
import sys
import subprocess
from pathlib import Path
from unknown_speaker_tracker import UnknownSpeakerTracker


def show_candidate_details(candidate):
    """Display detailed information about a candidate"""
    print(f"\n{'='*60}")
    print(f"Candidate Speaker: {candidate['speaker_id']}")
    print(f"{'='*60}")
    print(f"Detected: {candidate['created_at']}")
    print(f"Samples: {candidate['num_samples']}")
    print(f"Consistency (variance): {candidate['variance']:.4f}")
    print(f"  (lower = more consistent, <0.1 is excellent)")
    print()

    # Show sample transcripts
    print("Sample Transcripts:")
    for i, meta in enumerate(candidate['sample_metadata'][:5], 1):
        print(f"  [{i}] {meta['transcript'][:80]}")
        if len(meta['transcript']) > 80:
            print(f"      {meta['transcript'][80:160]}...")
    print()


def main():
    tracker = UnknownSpeakerTracker()
    candidates = tracker.get_pending_candidates()

    if not candidates:
        print("No pending speaker candidates found.")
        print("Candidates will appear after 10+ samples from an unknown speaker.")
        return

    print(f"\n🎤 Found {len(candidates)} pending speaker candidate(s)\n")

    for idx, candidate in enumerate(candidates, 1):
        show_candidate_details(candidate)

        print("Options:")
        print("  1. Approve and assign name")
        print("  2. Reject (not a real speaker)")
        print("  3. Skip (review later)")
        print()

        choice = input(f"Choice for {candidate['speaker_id']} [1/2/3]: ").strip()

        if choice == "1":
            name = input("Enter speaker name: ").strip().lower()
            if name:
                try:
                    profile_path = tracker.approve_candidate(
                        candidate['speaker_id'],
                        name
                    )
                    print(f"\n✅ Profile created: {name}")
                    print(f"   Path: {profile_path}")
                    print(f"   This speaker will now be recognized automatically!")

                    # Run retroactive tagging
                    print(f"\n🔄 Updating past transcripts with {name}...")
                    retag_script = Path(__file__).parent / "retag_transcripts.py"
                    result = subprocess.run(
                        ["python", str(retag_script), "--speaker-id", candidate['speaker_id']],
                        capture_output=True,
                        text=True
                    )
                    if result.returncode == 0:
                        print(result.stdout)
                    else:
                        print(f"⚠️  Retroactive tagging failed: {result.stderr}")
                except Exception as e:
                    print(f"\n❌ Error creating profile: {e}")
            else:
                print("❌ Invalid name, skipping.")

        elif choice == "2":
            confirm = input(f"Confirm reject {candidate['speaker_id']}? [y/N]: ")
            if confirm.lower() == 'y':
                tracker.reject_candidate(candidate['speaker_id'])
                print(f"❌ Candidate rejected")
            else:
                print("Skipped rejection")

        elif choice == "3":
            print("⏭️  Skipped")

        else:
            print("⏭️  Invalid choice, skipped")

    print("\n✅ Review complete!")
    print()
    print("Restart the voice listener to load new profiles:")
    print("  launchctl unload ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist")
    print("  launchctl load ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist")


if __name__ == "__main__":
    main()
