#!/usr/bin/env bash
# nightly-import.sh — Queue up to 5 unprocessed audio files from Google Drive
# into the WhisperX transcription pipeline each night.
#
# Tracks which files have been imported via a state file so each file is
# only transcribed once. Files are copied to a local staging area first
# (handles Google Drive File Stream), then sent to WhisperX HTTP API with
# diarization enabled. Results are saved to the curator voice directory.
#
# Designed to run via launchd at 1 AM nightly.

set -uo pipefail

# --- Configuration ---
SOURCE_DIR="/Users/oasis/Library/CloudStorage/GoogleDrive-aech.clawbot@gmail.com/.shortcut-targets-by-id/1XPKf8bAq0qbOL7AmAPspViT82YUf_h8V/The Oasis - Personal AI Agent Framework/00_The_Library/Audio Recordings"
STATE_FILE="${HOME}/.openclaw/nightly-import-state.json"
CURATOR_VOICE_DIR="${HOME}/.openclaw/workspace-curator/transcripts/voice/imported"
STAGING_DIR="${HOME}/.openclaw/nightly-import-staging"
WHISPERX_URL="http://127.0.0.1:9000/transcribe"
MAX_FILES="${MAX_FILES:-5}"
# 30 minutes per file — long meetings on CPU take time
CURL_TIMEOUT="${CURL_TIMEOUT:-1800}"
LOG_PREFIX="[nightly-import]"

mkdir -p "$CURATOR_VOICE_DIR" "$STAGING_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $LOG_PREFIX $*"; }

# --- State management ---
init_state() {
    if [[ ! -f "$STATE_FILE" ]]; then
        echo '{"imported":[]}' > "$STATE_FILE"
    fi
}

is_imported() {
    python3 -c "
import json, sys
with open('$STATE_FILE') as f:
    state = json.load(f)
sys.exit(0 if sys.argv[1] in state.get('imported', []) else 1)
" "$1"
}

mark_imported() {
    python3 -c "
import json, sys
with open('$STATE_FILE') as f:
    state = json.load(f)
imported = state.get('imported', [])
if sys.argv[1] not in imported:
    imported.append(sys.argv[1])
    state['imported'] = imported
    with open('$STATE_FILE', 'w') as f:
        json.dump(state, f, indent=2)
" "$1"
}

# --- Wait for WhisperX to be idle ---
wait_for_whisperx() {
    local max_wait=600  # 10 minutes
    local waited=0
    while true; do
        if curl -sf --max-time 5 http://127.0.0.1:9000/health > /dev/null 2>&1; then
            return 0
        fi
        if [[ $waited -ge $max_wait ]]; then
            log "ERROR: WhisperX not available after ${max_wait}s"
            return 1
        fi
        if [[ $((waited % 60)) -eq 0 ]] && [[ $waited -gt 0 ]]; then
            log "  Waiting for WhisperX... (${waited}s elapsed)"
        fi
        sleep 10
        waited=$((waited + 10))
    done
}

# --- Transcribe a single file ---
transcribe_file() {
    local filepath="$1"
    local filename
    filename=$(basename "$filepath")
    local stem="${filename%.*}"
    local ext="${filename##*.}"

    # Stage: copy to local temp (avoids Google Drive cloud-only issues)
    local staged="${STAGING_DIR}/${filename}"
    log "  Staging: ${filename}"
    if ! cp "$filepath" "$staged" 2>/dev/null; then
        log "  ERROR: Failed to copy file (may be cloud-only)"
        return 1
    fi

    local filesize
    filesize=$(stat -f '%z' "$staged" 2>/dev/null || echo "0")
    local size_mb=$((filesize / 1048576))
    log "  Transcribing: ${filename} (${size_mb}MB)"

    # Wait for WhisperX to be available before sending
    if ! wait_for_whisperx; then
        rm -f "$staged"
        return 1
    fi

    # Send to WhisperX
    local tmpfile
    tmpfile=$(mktemp /tmp/whisperx-resp.XXXXXX)

    local http_code
    http_code=$(curl -s -w "%{http_code}" \
        -o "$tmpfile" \
        --connect-timeout 30 \
        --max-time "$CURL_TIMEOUT" \
        -F "audio=@${staged};filename=${filename}" \
        -F "language=en" \
        -F "diarize=true" \
        -F "output_format=json" \
        "$WHISPERX_URL" 2>/dev/null) || http_code="000"

    # Clean up staged file
    rm -f "$staged"

    if [[ "$http_code" != "200" ]]; then
        log "  ERROR: WhisperX returned HTTP $http_code"
        if [[ -s "$tmpfile" ]]; then
            log "  Response: $(head -3 "$tmpfile")"
        fi
        rm -f "$tmpfile"
        return 1
    fi

    local body
    body=$(cat "$tmpfile")
    rm -f "$tmpfile"

    # Convert to dashboard format
    python3 << 'PYEOF' "$body" "$filename" "$stem" "$CURATOR_VOICE_DIR"
import json, sys, re
from datetime import datetime
from pathlib import Path

body = sys.argv[1]
filename = sys.argv[2]
stem = sys.argv[3]
curator_dir = sys.argv[4]

data = json.loads(body)
segments = data.get('segments', [])

if not segments:
    print(f'  No segments found in transcript for {filename}')
    sys.exit(0)

# Parse date from filename: YYYY-MM-DD_... or MM-DD_...
ts = datetime.utcnow()
m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', filename)
if m:
    try:
        ts = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        pass
else:
    m = re.match(r'^(\d{2})-(\d{2})_', filename)
    if m:
        month, day = int(m.group(1)), int(m.group(2))
        year = ts.year if month <= ts.month else ts.year - 1
        try:
            ts = datetime(year, month, day)
        except ValueError:
            pass

full_text = ' '.join(seg.get('text', '').strip() for seg in segments).strip()
duration = max((seg.get('end', 0) for seg in segments), default=0)

has_diarization = data.get('diarization', False)
speakers_map = {}
utterances = []

for seg in segments:
    text = seg.get('text', '').strip()
    if not text:
        continue
    sid = seg.get('speaker', 'unknown')
    sname = seg.get('speaker_name')
    if sid not in speakers_map:
        speakers_map[sid] = {'id': sid, 'name': sname, 'utterances': []}
    elif sname and not speakers_map[sid]['name']:
        speakers_map[sid]['name'] = sname
    speakers_map[sid]['utterances'].append({
        'text': text, 'start': seg.get('start', 0), 'end': seg.get('end', 0)
    })
    utterances.append({
        'speaker': sname or sid, 'text': text,
        'start': seg.get('start', 0), 'end': seg.get('end', 0)
    })

result = {
    'timestamp': ts.isoformat() + 'Z',
    'duration': round(duration),
    'transcript': full_text,
    'audioPath': filename,
    'speakers': list(speakers_map.values()),
    'numSpeakers': len(speakers_map),
    'utterances': utterances,
    'source': 'imported',
    'sourceFile': filename,
    'model': data.get('model', 'unknown'),
    'diarization': has_diarization,
}

safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', stem)[:120]
out_file = Path(curator_dir) / f'{safe_name}.json'

counter = 1
while out_file.exists():
    out_file = Path(curator_dir) / f'{safe_name}-{counter}.json'
    counter += 1

with open(out_file, 'w') as f:
    json.dump(result, f, indent=2)

word_count = len(full_text.split())
print(f'  Saved: {out_file.name} ({len(speakers_map)} speakers, {word_count} words, {round(duration)}s)')
PYEOF
}

# --- Main ---
init_state

if [[ ! -d "$SOURCE_DIR" ]]; then
    log "ERROR: Source directory not found: $SOURCE_DIR"
    log "  (Is Google Drive mounted?)"
    exit 1
fi

log "Waiting for WhisperX to be ready..."
if ! wait_for_whisperx; then
    exit 1
fi
log "WhisperX is ready."

log "Scanning for unprocessed audio files (max $MAX_FILES)..."

queued=0

for filepath in "$SOURCE_DIR"/*; do
    [[ $queued -ge $MAX_FILES ]] && break
    [[ -f "$filepath" ]] || continue

    filename=$(basename "$filepath")

    # Skip non-audio files
    ext="${filename##*.}"
    ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
    case "$ext" in
        mp3|m4a|wav|ogg|flac|aac|webm|opus|wma|mp4) ;;
        *) continue ;;
    esac

    # Skip already imported
    if is_imported "$filename"; then
        continue
    fi

    queued=$((queued + 1))
    log "[$queued/$MAX_FILES] $filename"

    if transcribe_file "$filepath"; then
        mark_imported "$filename"
        log "  Complete."
    else
        log "  Failed — will retry next run."
        queued=$((queued - 1))
    fi
done

total_imported=$(python3 -c "import json; print(len(json.load(open('$STATE_FILE')).get('imported',[])))")
total_available=$(ls "$SOURCE_DIR" 2>/dev/null | wc -l | tr -d ' ')

# Clean up staging dir
rm -rf "$STAGING_DIR"

log "Done: $queued transcribed this run ($total_imported/$total_available total imported)"
