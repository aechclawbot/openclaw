# OpenClaw Voice Listener

Always-on voice transcription with speaker recognition for the OASIS voice assistant.

## 🎙️ Service Management

The voice listener runs as a launchd service and starts automatically on boot.

### Control Commands

```bash
# Start the service
launchctl load ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist

# Stop the service
launchctl unload ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist

# Restart the service
launchctl unload ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist

# Check if service is running
launchctl list | grep openclaw

# View live logs
tail -f ~/.openclaw/logs/voice-listener.log

# View error logs
tail -f ~/.openclaw/logs/voice-listener-error.log
```

## 📁 Transcript Locations

### Curator Workspace (organized by date)

```
~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/HH-MM-SS.json
```

### Raw Directory (flat structure)

```
~/.openclaw/voice-transcripts/raw/YYYY-MM-DDTHH-MM-SS.json
```

## 🔍 Viewing Transcripts

Use the helper script:

```bash
# List all transcripts
~/openclaw/scripts/voice/view-transcripts.sh list

# View latest transcript
~/openclaw/scripts/voice/view-transcripts.sh latest

# View today's transcripts
~/openclaw/scripts/voice/view-transcripts.sh today

# Watch for new transcripts (real-time)
~/openclaw/scripts/voice/view-transcripts.sh watch
```

## 👤 Speaker Enrollment

### Manual Enrollment

To manually enroll new speakers for voice recognition:

```bash
source ~/.openclaw/voice-venv/bin/activate
python ~/openclaw/scripts/voice/enroll_speaker.py <name>
```

Example:

```bash
python ~/openclaw/scripts/voice/enroll_speaker.py courtney
python ~/openclaw/scripts/voice/enroll_speaker.py monty
```

Profiles are saved to: `~/.openclaw/voice-profiles/<name>.json`

### Automatic Profile Building ✨ NEW!

The system automatically tracks unknown speakers and builds candidate profiles:

1. **Automatic Tracking**: When unknown speakers are detected, the system collects voice samples and embeddings
2. **Candidate Creation**: After 10+ samples, a candidate profile is created
3. **Review & Approve**: Review candidates and assign names:
   ```bash
   source ~/.openclaw/voice-venv/bin/activate
   python ~/openclaw/scripts/voice/review_candidates.py
   ```
4. **Retroactive Tagging**: Past transcripts are automatically updated with the new speaker name

**Files:**

- Unknown speaker data: `~/.openclaw/unknown-speakers/`
- Candidate profiles: `~/.openclaw/unknown-speakers/candidates/`

## ⚙️ Configuration

- **Recording duration**: Dynamic (2-30 min, ends on 8s silence gap)
- **Sample rate**: 16000 Hz
- **Channels**: 1 (mono)
- **Models**:
  - Transcription: faster-whisper (base model)
  - Speaker recognition: SpeechBrain ECAPA-TDNN
  - Diarization: pyannote.audio (optional, requires HF token + terms acceptance)

## 🔧 Troubleshooting

### Service not starting

```bash
# Check error log
cat ~/.openclaw/logs/voice-listener-error.log

# Manually test the script
source ~/.openclaw/voice-venv/bin/activate
export HF_TOKEN="your-token"
python ~/openclaw/scripts/voice/listen.py
```

### No transcripts appearing

- Check if microphone is connected and working
- Verify the service is running: `launchctl list | grep openclaw`
- Check logs: `tail -f ~/.openclaw/logs/voice-listener.log`

### Speaker recognition not working

- Ensure speaker is enrolled: `ls ~/.openclaw/voice-profiles/`
- Re-enroll with better audio samples if needed
- Check embedding matching threshold in profile JSON (default: 0.25)

## 📊 Transcript Format

```json
{
  "timestamp": "2026-02-17T14:12:46.819879Z",
  "duration": 300,
  "transcript": "full text of conversation",
  "audioPath": "/path/to/audio/chunk.wav",
  "speakers": [
    {
      "id": "unknown",
      "name": "fred",
      "utterances": [
        {
          "text": "what someone said",
          "start": 0.0,
          "end": 2.5
        }
      ]
    }
  ],
  "numSpeakers": 1,
  "source": "voice-passive"
}
```

## 🚀 Next Steps

1. **Accept pyannote terms** at https://hf.co/pyannote/speaker-diarization-3.1 to enable multi-speaker diarization
2. **Enroll additional speakers** (Courtney, Monty) for better recognition
3. **Implement wake word detection** for "oasis" command routing
4. **Connect to OpenClaw gateway** to enable voice commands
