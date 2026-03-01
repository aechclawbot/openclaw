# Automatic Speaker Profile Building System

## 🎯 Overview

The voice listener now automatically learns and builds profiles for unknown speakers without manual intervention.

## 🔄 How It Works

### 1. **Automatic Detection & Tracking**

When the voice listener encounters an unknown speaker:

- Diarization separates speakers: `SPEAKER_00`, `SPEAKER_01`, etc.
- Voice embeddings are extracted for each speaker
- Embeddings are compared against enrolled profiles (Fred, Courtney, Monty)
- If no match is found (distance > 0.25), speaker is marked as "unknown"

**NEW:** The system automatically saves:

- Voice embeddings (192-dimensional vectors)
- Audio segments
- Transcript text
- Timestamp metadata

Files stored in: `~/.openclaw/unknown-speakers/embeddings/SPEAKER_XX/`

### 2. **Candidate Profile Creation**

After **10 samples** from the same unknown speaker:

- A candidate profile is automatically created
- Average embedding (centroid) is calculated
- Consistency (variance) is measured
- Candidate saved to: `~/.openclaw/unknown-speakers/candidates/`

### 3. **Review & Approval**

Run the interactive review tool:

```bash
cd ~/openclaw
source ~/.openclaw/voice-venv/bin/activate
python scripts/voice/review_candidates.py
```

**What you'll see:**

```
🎤 Found 2 pending speaker candidate(s)

============================================================
Candidate Speaker: SPEAKER_01
============================================================
Detected: 2026-02-17T14:30:00Z
Samples: 12
Consistency (variance): 0.0453
  (lower = more consistent, <0.1 is excellent)

Sample Transcripts:
  [1] Hey Fred, did you see the email about the meeting tomorrow?
  [2] I think we should push that deadline back a bit...
  [3] Let me grab the file from my desk...

Options:
  1. Approve and assign name
  2. Reject (not a real speaker)
  3. Skip (review later)

Choice for SPEAKER_01 [1/2/3]:
```

**Options:**

1. **Approve**: Enter a name (e.g., "courtney")
   - Creates permanent profile at `~/.openclaw/voice-profiles/courtney.json`
   - Automatically updates all past transcripts with the new name
   - Speaker will be recognized in future recordings

2. **Reject**: Mark as not a real speaker (e.g., TV, background noise)

3. **Skip**: Review later when you have more information

### 4. **Retroactive Tagging** ✨

When you approve a candidate:

- All past transcripts are scanned
- Speaker IDs are updated with the assigned name
- The curator now knows who said what in old conversations!

**Manual retroactive tagging:**

```bash
# Dry run (see what would change)
python scripts/voice/retag_transcripts.py --dry-run

# Update all transcripts
python scripts/voice/retag_transcripts.py

# Update only a specific speaker
python scripts/voice/retag_transcripts.py --speaker-id SPEAKER_01
```

## 📁 File Structure

```
~/.openclaw/
├── voice-profiles/              # Permanent enrolled profiles
│   ├── fred.json                # Manual enrollment
│   ├── courtney.json            # Auto-enrolled from candidate
│   └── monty.json
│
├── unknown-speakers/            # Automatic tracking data
│   ├── embeddings/
│   │   ├── SPEAKER_01/          # Unknown speaker #1
│   │   │   ├── 20260217-*.npy  # Voice embeddings
│   │   │   └── 20260217-*.json # Metadata
│   │   └── SPEAKER_02/          # Unknown speaker #2
│   │
│   ├── audio/                   # Audio segments (optional)
│   │   ├── SPEAKER_01/
│   │   └── SPEAKER_02/
│   │
│   └── candidates/              # Ready for review
│       ├── SPEAKER_01.json      # Candidate profile (pending)
│       └── SPEAKER_02.json
│
└── workspace-curator/
    └── transcripts/voice/       # Transcripts with speaker IDs
        └── 2026/02/17/
            └── 14-30-15.json    # Updated with real names
```

## 🔧 Configuration

**Minimum samples for candidate creation:**

Default: 10 samples

To change, edit `~/.openclaw/unknown-speakers/config.json`:

```json
{
  "min_samples": 15,
  "similarity_threshold": 0.3
}
```

## 🔔 Notifications (Optional)

Set up periodic checks for new candidates:

```bash
# Add to crontab (every hour)
0 * * * * /Users/oasis/openclaw/scripts/voice/notify_new_candidates.sh

# Or run manually
~/openclaw/scripts/voice/notify_new_candidates.sh
```

Sends Telegram notification when new candidates are ready for review.

## 📊 Example Workflow

### Day 1: Courtney visits

- Voice listener captures 15 minutes of conversation
- Diarization detects `SPEAKER_01` (unknown)
- 12 samples collected automatically
- Candidate profile created

### Day 1 Evening: You review

```bash
python scripts/voice/review_candidates.py
# Choice: 1 (Approve)
# Name: courtney
```

### Result:

- ✅ `courtney.json` profile created
- ✅ All past transcripts updated: `SPEAKER_01` → `courtney`
- ✅ Future conversations automatically recognize Courtney

### Day 2: Courtney visits again

- Voice listener immediately recognizes her
- Transcripts show: `"name": "courtney"` instead of `"unknown"`
- Curator can now track Courtney-specific conversations and context

## 🎯 Use Cases

1. **Office Visitors**: Automatically learn voices of frequent guests
2. **Family Members**: Build profiles for Courtney, Monty, etc.
3. **Remote Calls**: Recognize participants on conference calls
4. **Historical Context**: Retroactively identify who said what in past recordings

## 🔍 Checking Status

```bash
# Check pending candidates
python -c "
from unknown_speaker_tracker import UnknownSpeakerTracker
tracker = UnknownSpeakerTracker()
candidates = tracker.get_pending_candidates()
print(f'Pending candidates: {len(candidates)}')
for c in candidates:
    print(f'  {c[\"speaker_id\"]}: {c[\"num_samples\"]} samples')
"

# Check unknown speaker directories
ls -la ~/.openclaw/unknown-speakers/embeddings/
ls -la ~/.openclaw/unknown-speakers/candidates/
```

## 🚀 Advanced Features

### Profile Metadata

Auto-enrolled profiles include:

```json
{
  "name": "courtney",
  "enrolledAt": "2026-02-17T15:30:00Z",
  "enrollmentMethod": "automatic",
  "originalSpeakerId": "SPEAKER_01",
  "numSamples": 12,
  "embeddings": [...],
  "threshold": 0.25,
  "metadata": {
    "variance": 0.0453,
    "auto_enrolled_from": "2026-02-17T14:30:00Z"
  }
}
```

### Improving Recognition

If a speaker is frequently misidentified:

1. Collect more samples (manual enrollment)
2. Adjust threshold in profile JSON (lower = stricter)
3. Re-train with better quality audio

## 📝 Notes

- **Privacy**: All processing is local, no cloud services
- **Storage**: Embeddings are small (~1KB each), audio is optional
- **Accuracy**: Typical variance < 0.1 indicates high consistency
- **Performance**: No impact on real-time transcription

## ✅ Benefits

- **Zero Manual Enrollment**: System learns automatically
- **Historical Awareness**: Past conversations get tagged retroactively
- **Curator Intelligence**: OASIS knows WHO said WHAT over time
- **Voice Memory**: System builds its own "address book" of voices
