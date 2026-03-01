# Audio Import System — User Guide

## Overview

The enhanced audio import script processes podcast/audio files with robust error handling, validation, and CPU throttling.

## Key Features ✅

### 1. **MP3 Validation**

- Validates file integrity with `ffprobe` before processing
- Detects corrupted files early (30s timeout)
- Skips broken files without crashing the batch

### 2. **MP3-to-WAV Conversion**

- Converts all audio to clean 16kHz mono WAV format
- Bypasses MP3 codec issues (libmpg123 errors)
- Uses ffmpeg with robust error recovery (5min timeout)

### 3. **Robust Error Handling**

- Real-time progress indicators (validation → conversion → transcription → diarization)
- Continues processing remaining files when one fails
- Automatic cleanup of temporary WAV files
- Detailed error messages with context

### 4. **CPU Throttling** (Nice Level)

- **Default nice level: 10** (conserves CPU for other tools)
- Configurable via `--nice` flag
- LaunchD job runs at nice level 15 (extra low priority)

## Usage

### Manual Run (Full Import)

```bash
source ~/.openclaw/voice-venv/bin/activate
python -u scripts/voice/import-audio.py
```

### Batch Limit (Test Run)

```bash
# Process only 10 files
python -u scripts/voice/import-audio.py --max 10
```

### Custom Nice Level

```bash
# Lower priority (higher nice = lower CPU priority)
python -u scripts/voice/import-audio.py --nice 15

# Default priority (runs at nice 0)
python -u scripts/voice/import-audio.py --nice 0
```

### Custom Source Directory

```bash
python -u scripts/voice/import-audio.py --source /path/to/audio/files
```

## Automated Schedule (LaunchD)

The job runs **nightly at 1:00 AM** via LaunchD:

- **Location**: `~/Library/LaunchAgents/ai.openclaw.audio-import.plist`
- **Nice level**: 15 (very low CPU priority)
- **Batch size**: 20 files per run
- **Logs**: `~/.openclaw/logs/audio-import.log`

### Check Job Status

```bash
launchctl list | grep audio-import
```

### Force Run Now

```bash
launchctl start ai.openclaw.audio-import
```

### View Logs

```bash
tail -f ~/.openclaw/logs/audio-import.log
```

## Progress Indicators

The script shows real-time progress:

```
[1/156] podcast_episode.mp3
    ✓ Valid
    ✓ Converted (61MB)
    ✓ Transcribed (142 segments)
    ✓ Diarized (87 turns)
    ✓ Matched
    ✅ 2 speaker(s), 3241 words, 2002s → podcast_episode.json
```

## Error Handling Examples

### Corrupted File

```
[1/156] corrupted.mp3
    ❌ Validation failed: Invalid data found when processing input
```

→ Skipped, continues to next file

### No Speech Detected

```
[2/156] music_only.mp3
    ✓ Valid
    ✓ Converted (42MB)
    🔇 No speech detected — skipping
```

→ Skipped, continues to next file

### Conversion Failure

```
[3/156] huge_file.mp3
    ✓ Valid
    ❌ FFmpeg timeout (file may be very large or corrupted)
```

→ Skipped, continues to next file

## Output Format

Transcripts saved to:

```
~/.openclaw/workspace-curator/transcripts/voice/imported/<filename>.json
```

JSON structure:

```json
{
  "timestamp": "2026-01-07T12:30:00Z",
  "duration": 2002,
  "transcript": "Full text...",
  "audioPath": "/path/to/original.mp3",
  "title": "The Future of Marketing AI Agents",
  "speakers": [
    {
      "id": "SPEAKER_00",
      "name": "fred",
      "utterances": [
        {
          "text": "Welcome to the show...",
          "start": 0.5,
          "end": 3.2
        }
      ]
    }
  ],
  "numSpeakers": 2,
  "source": "voice-import"
}
```

## Performance Notes

- **Whisper transcription**: ~0.2x realtime (33min audio = ~2.5min processing)
- **Speaker diarization**: ~1-2min per 30min of audio
- **WAV conversion**: <1s for most files
- **Nice level 10**: ~50% CPU usage (leaves headroom for other tasks)
- **Nice level 15**: ~25-30% CPU usage (minimal interference)

## Troubleshooting

### "Missing required dependencies: ffmpeg"

```bash
brew install ffmpeg
```

### Process hangs on a file

The script has built-in timeouts:

- Validation: 30s
- Conversion: 5min

If hung beyond these, kill and restart:

```bash
pkill -f import-audio.py
```

### Out of disk space (temp WAV files)

Temp files are auto-cleaned, but if interrupted:

```bash
rm -rf /var/folders/*/openclaw_audio_*
```

## Files Modified

- **Script**: `scripts/voice/import-audio.py`
- **LaunchD job**: `~/Library/LaunchAgents/ai.openclaw.audio-import.plist`
- **Output dir**: `~/.openclaw/workspace-curator/transcripts/voice/imported/`
- **Logs**: `~/.openclaw/logs/audio-import*.log`
