#!/usr/bin/env bash
# sync-transcripts.sh — Bridge between Docker audio pipeline and dashboard/curator
#
# Watches ~/oasis-audio/done/ for new WhisperX transcript JSONs,
# converts them into the dashboard-expected format, and saves to
# ~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/HH-MM-SS.json
#
# Also handles diarized transcripts (.boosted.json) which include speaker labels.
#
# Designed to run as a launchd service or manually.

set -euo pipefail

SOURCE_DIR="${HOME}/oasis-audio/done"
CURATOR_VOICE_DIR="${HOME}/.openclaw/workspace-curator/transcripts/voice"
MARKER_SUFFIX=".synced"
POLL_INTERVAL="${SYNC_POLL_INTERVAL:-5}"

mkdir -p "$CURATOR_VOICE_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [sync] $*"; }

convert_and_save() {
    local src="$1"
    local basename
    basename=$(basename "$src")

    # Skip error files, non-json, already-synced
    [[ "$basename" == *.error.* ]] && return 0
    [[ "$basename" != *.json ]] && return 0
    [[ -f "${src}${MARKER_SUFFIX}" ]] && return 0

    # Prefer the diarized (.boosted.json) version if it exists
    local boosted="${src%.json}"
    boosted="${boosted}.boosted.json"
    # Only use boosted if: this IS the base file AND boosted exists AND boosted has no error
    if [[ "$basename" != *.boosted.json ]] && [[ -f "$boosted" ]] && [[ ! -f "${boosted%.json}.error.txt" ]]; then
        # Skip the base file; the boosted version will be processed instead
        touch "${src}${MARKER_SUFFIX}"
        return 0
    fi

    # Skip boosted files that have errors (the base file will be used instead)
    if [[ "$basename" == *.boosted.json ]]; then
        local error_file="${src%.json}.error.txt"
        if [[ -f "$error_file" ]]; then
            touch "${src}${MARKER_SUFFIX}"
            return 0
        fi
    fi

    # Parse the WhisperX JSON and convert to dashboard format using Python
    python3 -c "
import json, sys, os
from datetime import datetime
from pathlib import Path

src = sys.argv[1]
curator_dir = sys.argv[2]

with open(src) as f:
    data = json.load(f)

segments = data.get('segments', [])
if not segments:
    sys.exit(0)

# Extract timestamp from filename or JSON
ts_str = data.get('timestamp', '')
if ts_str:
    # Parse ISO timestamp
    try:
        ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    except ValueError:
        ts = datetime.utcnow()
else:
    # Try to parse from filename: recording_YYYYMMDD_HHMMSS
    fname = Path(src).stem.replace('.boosted', '')
    try:
        parts = fname.split('_')
        date_str = parts[1]
        time_str = parts[2] if len(parts) > 2 else '000000'
        ts = datetime.strptime(f'{date_str}_{time_str}', '%Y%m%d_%H%M%S')
    except (IndexError, ValueError):
        ts = datetime.utcnow()

# Build full transcript text
full_text = ' '.join(seg.get('text', '').strip() for seg in segments).strip()
if not full_text:
    sys.exit(0)

# Calculate duration from segments
duration = 0
for seg in segments:
    end = seg.get('end', 0)
    if end > duration:
        duration = end

# Extract speakers info
has_diarization = data.get('diarization', False)
speakers_map = {}
utterances_list = []

for seg in segments:
    text = seg.get('text', '').strip()
    if not text:
        continue

    speaker_id = seg.get('speaker', 'unknown')
    speaker_name = seg.get('speaker_name', None)

    if speaker_id not in speakers_map:
        speakers_map[speaker_id] = {
            'id': speaker_id,
            'name': speaker_name,
            'utterances': []
        }
    elif speaker_name and not speakers_map[speaker_id]['name']:
        speakers_map[speaker_id]['name'] = speaker_name

    speakers_map[speaker_id]['utterances'].append({
        'text': text,
        'start': seg.get('start', 0),
        'end': seg.get('end', 0)
    })

    utterances_list.append({
        'speaker': speaker_name or speaker_id,
        'text': text,
        'start': seg.get('start', 0),
        'end': seg.get('end', 0)
    })

# Build dashboard-compatible JSON
result = {
    'timestamp': ts.isoformat() + 'Z',
    'duration': round(duration),
    'transcript': full_text,
    'audioPath': data.get('file', ''),
    'speakers': list(speakers_map.values()),
    'numSpeakers': len(speakers_map),
    'utterances': utterances_list,
    'source': 'voice-passive',
    'model': data.get('model', 'unknown'),
    'diarization': has_diarization,
}

# Save to curator directory: YYYY/MM/DD/HH-MM-SS.json
date_dir = Path(curator_dir) / ts.strftime('%Y/%m/%d')
date_dir.mkdir(parents=True, exist_ok=True)

# Use timestamp for filename, add suffix if boosted
suffix = '-diarized' if has_diarization and 'boosted' in Path(src).name else ''
out_file = date_dir / f\"{ts.strftime('%H-%M-%S')}{suffix}.json\"

# Avoid overwriting
counter = 1
while out_file.exists():
    out_file = date_dir / f\"{ts.strftime('%H-%M-%S')}{suffix}-{counter}.json\"
    counter += 1

with open(out_file, 'w') as f:
    json.dump(result, f, indent=2)

print(f'Saved: {out_file}')
" "$src" "$CURATOR_VOICE_DIR"

    local rc=$?
    if [[ $rc -eq 0 ]]; then
        touch "${src}${MARKER_SUFFIX}"
    else
        log "ERROR converting $basename (exit $rc)"
    fi
}

# --- Main loop ---

log "Starting transcript sync: ${SOURCE_DIR} -> ${CURATOR_VOICE_DIR}"
log "Poll interval: ${POLL_INTERVAL}s"

# First pass: backfill all existing transcripts
backfill_count=0
for f in "$SOURCE_DIR"/*.json; do
    [[ -f "$f" ]] || continue
    if convert_and_save "$f"; then
        ((backfill_count++)) || true
    fi
done
log "Backfill complete: processed $backfill_count files"

# Continuous watch loop
while true; do
    for f in "$SOURCE_DIR"/*.json; do
        [[ -f "$f" ]] || continue
        convert_and_save "$f" || true
    done
    sleep "$POLL_INTERVAL"
done
