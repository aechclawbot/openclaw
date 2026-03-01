# OASIS Stack Expansion — Implementation Instructions

## Overview

You are adding three new Docker containers to an existing OpenClaw deployment on this Mac Mini 2018 (Intel, 16GB RAM, 4 CPU cores). The existing OpenClaw gateway is already running via Docker Compose. Replace any of the existing functionality that overlaps with these new containers already part of the configuration. Make any necessary adjustments to this plan to keep the intent of those tools.

**New containers to add:**

1. **Ollama** — Local LLM inference server (Mistral 7B)
2. **WhisperX** — Audio transcription + speaker diarization service
3. **Audio Listener** — Always-on microphone monitor with voice activity detection

**Constraints:** This machine has limited resources. All containers share 16GB RAM and 4 CPU cores with macOS. WhisperX and audio-listener are lowest priority and must yield to everything else.

---

## Phase 1 — Verify Current State

Before making any changes, check what's running:

```bash
docker ps
docker compose ls
docker network ls
```

Find the existing OpenClaw project directory (likely `~/openclaw/`) and identify:

- The existing `docker-compose.yml` file
- The network name used by the OpenClaw gateway container
- The current state of `~/.openclaw/openclaw.json`

Report back what you find before proceeding.

---

## Phase 2 — Confirm Directory Structure

```bash
# Audio watch folders for WhisperX
mkdir -p ~/oasis-audio/inbox
mkdir -p ~/oasis-audio/done

# WhisperX custom Docker build context
mkdir -p ~/openclaw/whisperx-service

# Audio listener custom Docker build context
mkdir -p ~/openclaw/audio-listener
```

---

## Phase 3 — Create the WhisperX Service

### 3.1 — Create the Dockerfile

Create `~/openclaw/whisperx-service/Dockerfile` with this exact content:

```dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip install --no-cache-dir \
    whisperx \
    pyannote.audio \
    faster-whisper \
    flask \
    gunicorn \
    watchdog \
    && pip install --no-cache-dir --force-reinstall onnxruntime

# Create directories
RUN mkdir -p /audio/inbox /audio/done /app

WORKDIR /app

# Copy the API server and watcher
COPY app.py /app/app.py

EXPOSE 9000

CMD ["python", "/app/app.py"]
```

### 3.2 — Create the API Server

Create `~/openclaw/whisperx-service/app.py` with the following content. This is a Flask API server that provides two modes: a REST endpoint for on-demand transcription, and a watch folder that auto-processes dropped audio files.

```python
"""
WhisperX Transcription + Diarization Service
CPU-optimized API server with watch folder support.

API Endpoints:
  POST /transcribe     - Transcribe an uploaded audio file
  GET  /health         - Health check
  GET  /status         - Model info and queue status

Watch Folder:
  Drop audio files into /audio/inbox → transcripts appear in /audio/done
"""

import os
import json
import time
import threading
import logging
from pathlib import Path
from datetime import datetime

from flask import Flask, request, jsonify
import whisperx

# ─── Configuration ───────────────────────────────────────────

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "4"))
HF_TOKEN = os.getenv("HF_TOKEN", "")
DIARIZE_BY_DEFAULT = os.getenv("DIARIZE_BY_DEFAULT", "true").lower() == "true"
MIN_SPEAKERS = os.getenv("MIN_SPEAKERS", "") or None
MAX_SPEAKERS = os.getenv("MAX_SPEAKERS", "") or None
API_PORT = int(os.getenv("API_PORT", "9000"))
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "500"))
WATCH_FOLDER = os.getenv("WATCH_FOLDER", "/audio/inbox")
OUTPUT_FOLDER = os.getenv("OUTPUT_FOLDER", "/audio/done")
WATCH_INTERVAL = int(os.getenv("WATCH_INTERVAL", "30"))
OUTPUT_FORMAT = os.getenv("OUTPUT_FORMAT", "json")

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wma", ".aac", ".mp4", ".webm"}

# ─── Logging ─────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("whisperx-service")

# ─── Model Loading ───────────────────────────────────────────

log.info(f"Loading WhisperX model: {WHISPER_MODEL} (device={DEVICE}, compute={COMPUTE_TYPE})")
model = whisperx.load_model(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
log.info("WhisperX model loaded successfully.")

diarize_model = None
if HF_TOKEN:
    log.info("Loading diarization pipeline (pyannote)...")
    try:
        diarize_model = whisperx.DiarizationPipeline(use_auth_token=HF_TOKEN, device=DEVICE)
        log.info("Diarization pipeline loaded.")
    except Exception as e:
        log.warning(f"Diarization pipeline failed to load: {e}")
        log.warning("Transcription will work, but speaker labels will be unavailable.")
else:
    log.warning("No HF_TOKEN set — diarization (speaker identification) disabled.")
    log.warning("Set HF_TOKEN in .env to enable speaker diarization.")

# Track processing state
processing_lock = threading.Lock()
current_task = None

# ─── Core Transcription Function ─────────────────────────────

def transcribe_audio(audio_path, language=None, diarize=None, min_speakers=None, max_speakers=None):
    global current_task
    start_time = time.time()
    audio_path = str(audio_path)

    if diarize is None:
        diarize = DIARIZE_BY_DEFAULT

    min_sp = int(min_speakers) if min_speakers else (int(MIN_SPEAKERS) if MIN_SPEAKERS else None)
    max_sp = int(max_speakers) if max_speakers else (int(MAX_SPEAKERS) if MAX_SPEAKERS else None)

    current_task = os.path.basename(audio_path)
    log.info(f"Transcribing: {current_task}")

    try:
        # Step 1: Load audio
        audio = whisperx.load_audio(audio_path)

        # Step 2: Transcribe
        transcribe_kwargs = {"batch_size": BATCH_SIZE}
        if language:
            transcribe_kwargs["language"] = language
        result = model.transcribe(audio, **transcribe_kwargs)

        detected_language = result.get("language", language or "unknown")
        log.info(f"Detected language: {detected_language}")

        # Step 3: Align timestamps (word-level)
        try:
            align_model, align_metadata = whisperx.load_align_model(
                language_code=detected_language, device=DEVICE
            )
            result = whisperx.align(
                result["segments"], align_model, align_metadata, audio, DEVICE,
                return_char_alignments=False
            )
        except Exception as e:
            log.warning(f"Alignment failed (continuing without word-level timestamps): {e}")

        # Step 4: Diarize (if requested and available)
        if diarize and diarize_model:
            log.info("Running speaker diarization...")
            diarize_kwargs = {}
            if min_sp:
                diarize_kwargs["min_speakers"] = min_sp
            if max_sp:
                diarize_kwargs["max_speakers"] = max_sp

            diarize_segments = diarize_model(audio_path, **diarize_kwargs)
            result = whisperx.assign_word_speakers(diarize_segments, result)
            log.info("Diarization complete.")
        elif diarize and not diarize_model:
            log.warning("Diarization requested but pipeline not loaded (missing HF_TOKEN).")

        elapsed = round(time.time() - start_time, 2)
        log.info(f"Completed: {current_task} in {elapsed}s")

        return {
            "file": os.path.basename(audio_path),
            "language": detected_language,
            "segments": result.get("segments", []),
            "processing_time_seconds": elapsed,
            "model": WHISPER_MODEL,
            "diarization": diarize and diarize_model is not None,
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        log.error(f"Transcription failed for {audio_path}: {e}")
        raise
    finally:
        current_task = None


def format_output(result, fmt="json"):
    if fmt == "json":
        return json.dumps(result, indent=2, ensure_ascii=False)

    elif fmt == "txt":
        lines = []
        for seg in result.get("segments", []):
            speaker = seg.get("speaker", "")
            prefix = f"[{speaker}] " if speaker else ""
            lines.append(f"{prefix}{seg.get('text', '').strip()}")
        return "\n".join(lines)

    elif fmt == "srt":
        srt_lines = []
        for i, seg in enumerate(result.get("segments", []), 1):
            start = _seconds_to_srt_time(seg.get("start", 0))
            end = _seconds_to_srt_time(seg.get("end", 0))
            speaker = seg.get("speaker", "")
            prefix = f"[{speaker}] " if speaker else ""
            srt_lines.append(f"{i}\n{start} --> {end}\n{prefix}{seg.get('text', '').strip()}\n")
        return "\n".join(srt_lines)

    elif fmt == "vtt":
        vtt_lines = ["WEBVTT\n"]
        for seg in result.get("segments", []):
            start = _seconds_to_vtt_time(seg.get("start", 0))
            end = _seconds_to_vtt_time(seg.get("end", 0))
            speaker = seg.get("speaker", "")
            prefix = f"<v {speaker}>" if speaker else ""
            vtt_lines.append(f"{start} --> {end}\n{prefix}{seg.get('text', '').strip()}\n")
        return "\n".join(vtt_lines)

    return json.dumps(result, indent=2, ensure_ascii=False)


def _seconds_to_srt_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _seconds_to_vtt_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


# ─── Watch Folder ────────────────────────────────────────────

def watch_folder():
    log.info(f"Watch folder active: {WATCH_FOLDER} → {OUTPUT_FOLDER}")
    processed_marker = ".processed"

    while True:
        try:
            inbox = Path(WATCH_FOLDER)
            if inbox.exists():
                for audio_file in sorted(inbox.iterdir()):
                    if audio_file.suffix.lower() not in SUPPORTED_EXTENSIONS:
                        continue
                    marker = audio_file.with_suffix(audio_file.suffix + processed_marker)
                    if marker.exists():
                        continue

                    with processing_lock:
                        try:
                            result = transcribe_audio(str(audio_file))
                            output = format_output(result, OUTPUT_FORMAT)

                            ext_map = {"json": ".json", "txt": ".txt", "srt": ".srt", "vtt": ".vtt"}
                            out_ext = ext_map.get(OUTPUT_FORMAT, ".json")
                            out_path = Path(OUTPUT_FOLDER) / (audio_file.stem + out_ext)
                            out_path.write_text(output, encoding="utf-8")

                            marker.touch()
                            log.info(f"Watch: Completed {audio_file.name} → {out_path.name}")

                        except Exception as e:
                            log.error(f"Watch: Failed to process {audio_file.name}: {e}")
                            error_path = Path(OUTPUT_FOLDER) / (audio_file.stem + ".error.txt")
                            error_path.write_text(str(e), encoding="utf-8")
                            marker.touch()

        except Exception as e:
            log.error(f"Watch folder error: {e}")

        time.sleep(WATCH_INTERVAL)


# ─── Flask API ───────────────────────────────────────────────

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE_MB * 1024 * 1024


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model": WHISPER_MODEL,
        "device": DEVICE,
        "diarization_available": diarize_model is not None
    })


@app.route("/status", methods=["GET"])
def status():
    return jsonify({
        "model": WHISPER_MODEL,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "diarization_available": diarize_model is not None,
        "currently_processing": current_task,
        "watch_folder": WATCH_FOLDER,
        "output_folder": OUTPUT_FOLDER
    })


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided. Use form field 'audio'."}), 400

    audio_file = request.files["audio"]
    if not audio_file.filename:
        return jsonify({"error": "Empty filename"}), 400

    language = request.form.get("language", None)
    diarize = request.form.get("diarize", str(DIARIZE_BY_DEFAULT)).lower() == "true"
    min_speakers = request.form.get("min_speakers", None)
    max_speakers = request.form.get("max_speakers", None)
    fmt = request.form.get("output_format", "json")

    tmp_path = f"/tmp/{audio_file.filename}"
    audio_file.save(tmp_path)

    try:
        with processing_lock:
            result = transcribe_audio(
                tmp_path,
                language=language,
                diarize=diarize,
                min_speakers=min_speakers,
                max_speakers=max_speakers
            )

        if fmt == "json":
            return jsonify(result)
        else:
            output = format_output(result, fmt)
            return output, 200, {"Content-Type": "text/plain; charset=utf-8"}

    except Exception as e:
        log.error(f"API transcription error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


# ─── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    watcher_thread = threading.Thread(target=watch_folder, daemon=True)
    watcher_thread.start()

    log.info(f"WhisperX API listening on port {API_PORT}")
    app.run(host="0.0.0.0", port=API_PORT, threaded=False)
```

---

## Phase 3B — Create the Audio Listener Service

The audio listener is an always-on microphone monitor. It uses WebRTC Voice Activity Detection (VAD) to detect speech, records it, and drops the audio files into the same inbox that WhisperX watches. It is extremely lightweight — ~5MB RAM and near-zero CPU when idle. It only uses resources when someone is speaking.

**The pipeline:** Microphone → Audio Listener (VAD + record) → ~/oasis-audio/inbox/ → WhisperX (transcribe + diarize) → ~/oasis-audio/done/

### 3B.1 — Create the Dockerfile

Create `~/openclaw/audio-listener/Dockerfile`:

```dockerfile
FROM python:3.11-slim

# Install system dependencies for PyAudio (ALSA/PulseAudio)
RUN apt-get update && apt-get install -y --no-install-recommends \
    portaudio19-dev \
    python3-pyaudio \
    pulseaudio-utils \
    alsa-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages — intentionally minimal
RUN pip install --no-cache-dir \
    pyaudio \
    webrtcvad

RUN mkdir -p /audio/inbox /app

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 9001

CMD ["python", "/app/app.py"]
```

### 3B.2 — Create the Listener App

Create `~/openclaw/audio-listener/app.py` with the following content. This is a lightweight Python app that uses WebRTC VAD to detect speech, records audio segments, and saves them to the WhisperX inbox.

```python
"""
OASIS Audio Listener — Always-On Microphone Monitor

Continuously listens to the system microphone, detects speech using
Voice Activity Detection (VAD), and saves audio segments to the
WhisperX inbox folder for transcription + diarization.

Designed to be extremely lightweight when idle — only consumes
meaningful resources when speech is detected.

Environment Variables:
  AUDIO_DEVICE        - Input device index (default: system default)
  SAMPLE_RATE         - Recording sample rate (default: 16000)
  VAD_AGGRESSIVENESS  - WebRTC VAD aggressiveness 0-3 (default: 2)
  MIN_SPEECH_SECONDS  - Minimum speech duration to save (default: 3)
  MAX_SEGMENT_SECONDS - Max segment length before forced split (default: 300 = 5 min)
  SILENCE_TIMEOUT     - Seconds of silence before ending a segment (default: 5)
  OUTPUT_DIR          - Where to save audio files (default: /audio/inbox)
  HEALTH_PORT         - Health check HTTP port (default: 9001)
"""

import os
import sys
import wave
import time
import struct
import logging
import threading
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

# ─── Configuration ───────────────────────────────────────────

AUDIO_DEVICE = os.getenv("AUDIO_DEVICE", "") or None
SAMPLE_RATE = int(os.getenv("SAMPLE_RATE", "16000"))
VAD_AGGRESSIVENESS = int(os.getenv("VAD_AGGRESSIVENESS", "2"))
MIN_SPEECH_SECONDS = float(os.getenv("MIN_SPEECH_SECONDS", "3"))
MAX_SEGMENT_SECONDS = float(os.getenv("MAX_SEGMENT_SECONDS", "300"))
SILENCE_TIMEOUT = float(os.getenv("SILENCE_TIMEOUT", "5"))
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/audio/inbox")
HEALTH_PORT = int(os.getenv("HEALTH_PORT", "9001"))

FRAME_DURATION_MS = 30
FRAME_SIZE = int(SAMPLE_RATE * FRAME_DURATION_MS / 1000)
CHANNELS = 1
SAMPLE_WIDTH = 2

# ─── Logging ─────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("audio-listener")

# ─── State ───────────────────────────────────────────────────

listener_state = {
    "status": "starting",
    "recording": False,
    "segments_saved": 0,
    "current_segment_seconds": 0,
    "last_speech_detected": None,
    "uptime_start": time.time()
}

# ─── Health Check Server ─────────────────────────────────────

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        import json
        if self.path == "/health":
            state = {**listener_state}
            state["uptime_seconds"] = round(time.time() - state.pop("uptime_start"), 1)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(state).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def start_health_server():
    server = HTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log.info(f"Health check server on port {HEALTH_PORT}")


# ─── Audio Recording ─────────────────────────────────────────

def save_segment(frames, segment_start_time):
    if not frames:
        return None

    duration = len(frames) * FRAME_DURATION_MS / 1000.0
    if duration < MIN_SPEECH_SECONDS:
        log.debug(f"Segment too short ({duration:.1f}s < {MIN_SPEECH_SECONDS}s), discarding")
        return None

    timestamp = segment_start_time.strftime("%Y%m%d_%H%M%S")
    filename = f"recording_{timestamp}.wav"
    filepath = Path(OUTPUT_DIR) / filename

    with wave.open(str(filepath), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(b"".join(frames))

    listener_state["segments_saved"] += 1
    log.info(f"Saved: {filename} ({duration:.1f}s)")
    return filepath


def run_listener():
    try:
        import pyaudio
        import webrtcvad
    except ImportError as e:
        log.error(f"Missing dependency: {e}")
        sys.exit(1)

    vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
    pa = pyaudio.PyAudio()

    device_index = None
    if AUDIO_DEVICE:
        device_index = int(AUDIO_DEVICE)
        info = pa.get_device_info_by_index(device_index)
        log.info(f"Using audio device: {info['name']} (index {device_index})")
    else:
        default = pa.get_default_input_device_info()
        log.info(f"Using default audio device: {default['name']}")

    stream = pa.open(
        format=pyaudio.paInt16,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        input_device_index=device_index,
        frames_per_buffer=FRAME_SIZE
    )

    log.info("Audio listener active — listening for speech...")
    listener_state["status"] = "listening"

    is_recording = False
    frames = []
    segment_start_time = None
    silence_frames = 0
    silence_threshold = int(SILENCE_TIMEOUT * 1000 / FRAME_DURATION_MS)
    max_frames = int(MAX_SEGMENT_SECONDS * 1000 / FRAME_DURATION_MS)

    try:
        while True:
            try:
                data = stream.read(FRAME_SIZE, exception_on_overflow=False)
            except IOError as e:
                log.warning(f"Audio read error: {e}")
                continue

            try:
                is_speech = vad.is_speech(data, SAMPLE_RATE)
            except Exception:
                continue

            if is_speech:
                listener_state["last_speech_detected"] = datetime.utcnow().isoformat()

                if not is_recording:
                    is_recording = True
                    frames = []
                    segment_start_time = datetime.now()
                    silence_frames = 0
                    listener_state["recording"] = True
                    log.info("Speech detected — recording started")

                frames.append(data)
                silence_frames = 0

                if len(frames) >= max_frames:
                    log.info(f"Max segment length reached ({MAX_SEGMENT_SECONDS}s), saving and continuing")
                    save_segment(frames, segment_start_time)
                    frames = []
                    segment_start_time = datetime.now()

            else:
                if is_recording:
                    frames.append(data)
                    silence_frames += 1

                    if silence_frames >= silence_threshold:
                        save_segment(frames, segment_start_time)
                        is_recording = False
                        frames = []
                        segment_start_time = None
                        silence_frames = 0
                        listener_state["recording"] = False
                        listener_state["current_segment_seconds"] = 0
                        log.info("Silence timeout — recording stopped")

            if is_recording:
                listener_state["current_segment_seconds"] = round(
                    len(frames) * FRAME_DURATION_MS / 1000.0, 1
                )

    except KeyboardInterrupt:
        log.info("Shutting down listener...")
    finally:
        if is_recording and frames:
            save_segment(frames, segment_start_time)
        stream.stop_stream()
        stream.close()
        pa.terminate()
        listener_state["status"] = "stopped"


# ─── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    start_health_server()
    run_listener()
```

### 3B.3 — macOS Audio Passthrough Setup

Docker containers on macOS cannot directly access the host microphone. You need PulseAudio to bridge the audio from macOS into the container. This must be set up **on the Mac Mini host** (not inside Docker).

**Install PulseAudio on the host:**

```bash
brew install pulseaudio
```

**Configure PulseAudio to expose a Unix socket:**

Edit (or create) `~/.config/pulse/default.pa` and add:

```
load-module module-native-protocol-unix socket=/tmp/pulseaudio.socket
```

**Start PulseAudio:**

```bash
pulseaudio --start --load="module-native-protocol-unix socket=/tmp/pulseaudio.socket"
```

**Verify it works:**

```bash
pactl info  # Should show PulseAudio server info
pactl list sources short  # Should list your Mac Mini's microphone
```

**To make PulseAudio start on boot**, create a Launch Agent:

```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/org.pulseaudio.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>org.pulseaudio</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/pulseaudio</string>
        <string>--start</string>
        <string>--load=module-native-protocol-unix socket=/tmp/pulseaudio.socket</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/org.pulseaudio.plist
```

**IMPORTANT:** If `brew install pulseaudio` installs to `/opt/homebrew/bin/pulseaudio` instead of `/usr/local/bin/pulseaudio`, update the plist path accordingly. Check with `which pulseaudio`.

---

## Phase 4 — Create the .env File

Create `~/openclaw/.env` (or append to existing):

```bash
# Hugging Face token for pyannote speaker diarization
# 1. Create free account: https://huggingface.co/join
# 2. Accept model terms at:
#    - https://huggingface.co/pyannote/speaker-diarization-3.1
#    - https://huggingface.co/pyannote/segmentation-3.0
# 3. Generate READ token: https://huggingface.co/settings/tokens
HF_TOKEN=hf_YOUR_TOKEN_HERE
```

**IMPORTANT:** Ask Fred for his Hugging Face token before proceeding. If he doesn't have one yet, skip diarization for now — transcription will still work without it. The service will log a warning but function normally.

---

## Phase 5 — Add Services to Docker Compose

Determine how the existing OpenClaw docker-compose.yml is structured. Then either add these services directly into the existing file, or create separate override files. The goal is that all three services (openclaw, ollama, whisperx) share the same Docker network.

### 5.1 — Ollama Service

Add this service:

```yaml
ollama:
  image: ollama/ollama:latest
  container_name: ollama
  restart: unless-stopped
  ports:
    - "11434:11434"
  volumes:
    - ollama-data:/root/.ollama
  deploy:
    resources:
      limits:
        cpus: "3.0"
        memory: 8G
      reservations:
        cpus: "1.0"
        memory: 4G
  environment:
    - OLLAMA_HOST=0.0.0.0
    - OLLAMA_NUM_PARALLEL=1
    - OLLAMA_MAX_LOADED_MODELS=1
    - OLLAMA_KEEP_ALIVE=5m
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:11434/"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 15s
```

### 5.2 — WhisperX Service

Add this service. Note the low-priority scheduling directives — these are critical:

```yaml
whisperx:
  build:
    context: ./whisperx-service
    dockerfile: Dockerfile
  container_name: whisperx
  restart: unless-stopped
  ports:
    - "9000:9000"
  volumes:
    - whisperx-cache:/root/.cache
    - ~/oasis-audio/inbox:/audio/inbox
    - ~/oasis-audio/done:/audio/done
  deploy:
    resources:
      limits:
        cpus: "2.0"
        memory: 3G
      reservations:
        cpus: "0.25"
        memory: 512M
  # ── Low Priority Scheduling ──
  cpu_shares: 256
  oom_score_adj: 500
  blkio_config:
    weight: 100
  environment:
    - WHISPER_MODEL=small
    - DEVICE=cpu
    - COMPUTE_TYPE=int8
    - BATCH_SIZE=4
    - HF_TOKEN=${HF_TOKEN}
    - DIARIZE_BY_DEFAULT=true
    - MIN_SPEAKERS=
    - MAX_SPEAKERS=
    - API_PORT=9000
    - MAX_FILE_SIZE_MB=500
    - WATCH_FOLDER=/audio/inbox
    - OUTPUT_FOLDER=/audio/done
    - WATCH_INTERVAL=30
    - OUTPUT_FORMAT=json
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:9000/health"]
    interval: 60s
    timeout: 15s
    retries: 3
    start_period: 120s
```

### 5.3 — Audio Listener Service

Add this service. It's the most lightweight of all — VAD is trivial computation:

```yaml
audio-listener:
  build:
    context: ./audio-listener
    dockerfile: Dockerfile
  container_name: audio-listener
  restart: unless-stopped
  volumes:
    - ~/oasis-audio/inbox:/audio/inbox
    - /tmp/pulseaudio.socket:/tmp/pulseaudio.socket
    - ~/.config/pulse/cookie:/root/.config/pulse/cookie:ro
  deploy:
    resources:
      limits:
        cpus: "0.5"
        memory: 256M
      reservations:
        cpus: "0.1"
        memory: 64M
  cpu_shares: 256
  oom_score_adj: 500
  environment:
    - SAMPLE_RATE=16000
    - VAD_AGGRESSIVENESS=2
    - MIN_SPEECH_SECONDS=3
    - MAX_SEGMENT_SECONDS=300
    - SILENCE_TIMEOUT=5
    - OUTPUT_DIR=/audio/inbox
    - HEALTH_PORT=9001
    - PULSE_SERVER=unix:/tmp/pulseaudio.socket
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:9001/health"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 10s
```

### 5.4 — Add Volumes

Make sure these volumes are declared in the top-level `volumes:` section:

```yaml
volumes:
  ollama-data:
  whisperx-cache:
```

### 5.5 — Networking

All three services must be on the same Docker network. Check what network the existing OpenClaw gateway uses and ensure ollama and whisperx join the same network. If the existing compose file defines a network, add both new services to it. If it uses the default network, all services in the same compose file will share it automatically.

---

## Phase 6 — Install the CLAUDE.md

Create `~/openclaw/CLAUDE.md` with this content:

```markdown
# CLAUDE.md — Project Context for Claude Code

## Project: OASIS Agent Swarm

This is an OpenClaw-based multi-agent system running on a Mac Mini 2018 (Intel, 16GB RAM) via Docker. Resources are tight.

## Docker Stack

| Container | Purpose                       | Port  |
| --------- | ----------------------------- | ----- |
| openclaw  | AI gateway (OASIS + agents)   | 18789 |
| ollama    | Local LLM (Mistral 7B)        | 11434 |
| whisperx  | Audio transcription + diarize | 9000  |

## CRITICAL: Resource Management

This machine only has 16GB RAM and 4 CPU cores. Before doing any work, **always pause the ollama, whisperx, and audio-listener containers** to free up resources. Unpause them when done.

### On every task start:

\`\`\`bash
docker pause ollama whisperx audio-listener 2>/dev/null || true
\`\`\`

### On every task completion:

\`\`\`bash
docker unpause ollama whisperx audio-listener 2>/dev/null || true
\`\`\`

Never stop or restart these containers — only pause/unpause. Stopping them loses loaded model state and causes slow restarts.

## Key Paths

- OpenClaw config: `~/.openclaw/openclaw.json`
- Agent workspaces: `~/.openclaw/workspace-{oasis,aech,curator,art3mis,ogden}/`
- Agent personas: `workspace-{agent}/SOUL.md`
- Agent directives: `workspace-{agent}/AGENTS.md`
- Audio inbox: `~/oasis-audio/inbox/`
- Audio transcripts: `~/oasis-audio/done/`
- Docker compose files: `~/openclaw/`

## Agents

- **OASIS** — Primary orchestrator, routes all Telegram/WhatsApp messages
- **Aech** — Arbitrage engine
- **Curator** — Archivist, handles transcripts and records
- **Art3mis** — Security firewall, vets links/contracts
- **Ogden** — Risk and strategy advisor

## Guidelines

- Always check container health before making Docker config changes: `docker ps`
- Do not modify the openclaw container while it's serving — restart gracefully
- The whisperx container is lowest priority — if resources are tight, it goes first
- Ollama model loads are slow on CPU — avoid unnecessary restarts
```

---

## Phase 7 — Build and Launch

### 7.1 — Build the custom images

```bash
cd ~/openclaw
docker compose build whisperx audio-listener
```

WhisperX will take several minutes (PyTorch + WhisperX + pyannote). Audio listener is fast (~30 seconds).

### 7.2 — Verify PulseAudio is running on the host

```bash
pactl info
ls -la /tmp/pulseaudio.socket
```

If PulseAudio isn't running, start it:

```bash
pulseaudio --start --load="module-native-protocol-unix socket=/tmp/pulseaudio.socket"
```

### 7.3 — Start the new services

```bash
docker compose up -d ollama whisperx audio-listener
```

### 7.4 — Pull a model into Ollama

```bash
docker exec ollama ollama pull mistral
```

This downloads Mistral 7B (~4.1GB). Wait for it to complete.

### 7.5 — Verify everything is running

```bash
# All four containers should be running
docker ps

# Check Ollama health
curl http://localhost:11434/

# Check WhisperX health
curl http://localhost:9000/health

# Check Audio Listener health
curl http://localhost:9001/health

# Check OpenClaw is still healthy
curl http://localhost:18789/
```

### 7.6 — Test the audio pipeline end-to-end

Test the full pipeline: microphone → audio-listener → inbox → whisperx → done

```bash
# Check the listener is hearing audio (speak near the Mac Mini mic)
curl http://localhost:9001/health
# Look for "recording": true and "last_speech_detected" updating

# After speaking for a few seconds, check the inbox
ls ~/oasis-audio/inbox/

# Wait for WhisperX to process (up to 30 seconds for the watcher interval)
ls ~/oasis-audio/done/
cat ~/oasis-audio/done/recording_*.json
```

If you want to test WhisperX independently with a known audio file:

```bash
curl -X POST http://localhost:9000/transcribe \
  -F "audio=@/path/to/test-audio.wav" \
  -F "language=en" \
  -F "diarize=true" \
  -F "output_format=json"
```

---

## Phase 8 — Verify Resource Limits

```bash
# Check resource constraints are applied
docker stats --no-stream

# Verify WhisperX low-priority settings
docker inspect whisperx | grep -A5 "CpuShares\|OomScoreAdj\|BlkioWeight"

# Verify audio-listener low-priority settings
docker inspect audio-listener | grep -A5 "CpuShares\|OomScoreAdj"
```

Expected output for both whisperx and audio-listener:

- `CpuShares: 256` (low priority)
- `OomScoreAdj: 500` (killed first under memory pressure)

Audio-listener should show ~5-10MB memory usage when idle.

---

## Phase 9 — Test the Pause/Unpause Workflow

Verify the CLAUDE.md resource management works:

```bash
# Pause all low-priority containers
docker pause ollama whisperx audio-listener

# Confirm they're paused
docker ps  # Status should show "(Paused)" for all three

# Unpause all
docker unpause ollama whisperx audio-listener

# Confirm they're running again
docker ps
curl http://localhost:11434/
curl http://localhost:9000/health
curl http://localhost:9001/health
```

---

## Final Architecture

```
┌──────────────────────────────────────────────────────┐
│              MAC MINI 2018 (16GB / 4 cores)          │
│                                                      │
│  ┌────────────────────────┐  2 CPU / 3GB             │
│  │  OpenClaw Gateway      │  Port 18789              │
│  │  (OASIS + 4 agents)    │  Priority: HIGH          │
│  └────────────┬───────────┘                          │
│               │ openclaw-net                         │
│  ┌────────────┴───────────┐                          │
│  │  Ollama                │  3 CPU / 8GB             │
│  │  http://ollama:11434   │  Mistral 7B              │
│  │                        │  Priority: HIGH          │
│  └────────────────────────┘                          │
│                                                      │
│  ┌────────────────────────┐                          │
│  │  Audio Listener (LOW)  │  0.5 CPU / 256MB         │
│  │  http://localhost:9001 │  cpu_shares=256           │
│  │  Mic → VAD → .wav      │  oom_score_adj=500       │
│  └───────────┬────────────┘                          │
│              │ ~/oasis-audio/inbox/                   │
│              ▼                                       │
│  ┌────────────────────────┐                          │
│  │  WhisperX (LOW)        │  2 CPU / 3GB             │
│  │  http://whisperx:9000  │  cpu_shares=256           │
│  │  .wav → transcript     │  oom_score_adj=500       │
│  └───────────┬────────────┘  blkio_weight=100        │
│              │ ~/oasis-audio/done/                    │
│              ▼                                       │
│  Curator agent reads transcripts                     │
│                                                      │
│  Shared network: openclaw-net                        │
│  Volumes: ollama-data, whisperx-cache                │
└──────────────────────────────────────────────────────┘
```

---

## Troubleshooting

| Issue                                            | Solution                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| WhisperX build fails                             | Check Docker has internet access; `pip install` needs to download packages                                |
| Diarization not working                          | Verify HF_TOKEN is set in .env and model terms are accepted on Hugging Face                               |
| Ollama pull hangs                                | Check disk space: `df -h`; Mistral needs ~4.1GB                                                           |
| Out of memory                                    | `docker pause whisperx audio-listener` then try again; check `docker stats`                               |
| WhisperX 403 on startup                          | HF model agreements not accepted — visit the 3 URLs in the .env file                                      |
| Services can't talk to each other                | Verify all services are on the same Docker network: `docker network inspect openclaw-net`                 |
| Slow Ollama inference                            | Normal on CPU — Mistral 7B generates ~5-10 tokens/sec on Intel i7                                         |
| Watch folder not processing                      | Check permissions on ~/oasis-audio/inbox; check `docker logs whisperx`                                    |
| Audio listener: no microphone                    | Verify PulseAudio is running: `pactl info`; check socket exists: `ls /tmp/pulseaudio.socket`              |
| Audio listener: permission denied on socket      | Run `chmod 777 /tmp/pulseaudio.socket` on the host                                                        |
| Audio listener: recording but no files appearing | Check VAD_AGGRESSIVENESS (lower = more sensitive); check MIN_SPEECH_SECONDS (lower = shorter clips saved) |
| PulseAudio not starting on boot                  | Verify the LaunchAgent: `launchctl list \| grep pulse`; check `which pulseaudio` path matches the plist   |
| Audio listener paused, missing recordings        | Expected — when paused during Claude Code work, speech is not captured. Unpause resumes listening.        |
