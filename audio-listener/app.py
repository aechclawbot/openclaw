"""
OASIS Audio Listener -- Always-On Microphone Monitor + AssemblyAI Transcription

Continuously listens to the system microphone, detects speech using
Voice Activity Detection (VAD), and saves audio segments to the inbox
folder. Each saved segment is submitted to AssemblyAI Universal-2 for
transcription + speaker diarization. After results arrive, SpeechBrain
ECAPA-TDNN runs locally to identify speakers against enrolled profiles.

Two threads:
  1. VAD listener   -- records speech, saves WAV to /audio/inbox,
                       submits to AssemblyAI (daemon threads per clip)
  2. Health server   -- HTTP health check on port 9001

Environment Variables:
  AUDIO_DEVICE           - Input device index (default: system default)
  SAMPLE_RATE            - Recording sample rate (default: 16000)
  VAD_AGGRESSIVENESS     - WebRTC VAD aggressiveness 0-3 (default: 2)
  MIN_SPEECH_SECONDS     - Minimum speech duration to save (default: 1.5)
  MAX_SEGMENT_SECONDS    - Max segment length before forced split (default: 300 = 5 min)
  SILENCE_TIMEOUT        - Seconds of silence before ending a segment (default: 2.5)
  SILENCE_TIMEOUT_MIN    - Adaptive: min silence timeout for short clips (default: SILENCE_TIMEOUT)
  SILENCE_TIMEOUT_MAX    - Adaptive: max silence timeout for long clips (default: SILENCE_TIMEOUT)
  SILENCE_GROW_AFTER_SECONDS - Speech duration after which timeout grows (default: 15)
  OUTPUT_DIR             - Where to save audio files (default: /audio/inbox)
  HEALTH_PORT            - Health check HTTP port (default: 9001)
  PULSE_SERVER           - PulseAudio server URI (default: unix:/tmp/pulseaudio.socket)
  OPENCLAW_GATEWAY_URL   - Gateway base URL (default: http://oasis:18789)
  OPENCLAW_GATEWAY_TOKEN - Bearer token for gateway hooks API
  ASSEMBLYAI_API_KEY     - AssemblyAI API key for transcription
  VERIFY_SPEAKER         - Enable speaker verification via ECAPA-TDNN (default: true)
  VOICE_PROFILES_DIR     - Path to enrolled voice profiles (default: /voice-profiles)
"""

import os
import re
import sys
import json
import wave
import time
import logging
import threading
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler

from speaker_verify import (
    verify_speaker_from_file,
    is_verification_enabled,
    get_identification_stats,
    VERIFY_SPEAKER,
)

# --- Configuration --------------------------------------------------------

AUDIO_DEVICE = os.getenv("AUDIO_DEVICE", "") or None
SAMPLE_RATE = int(os.getenv("SAMPLE_RATE", "16000"))
VAD_AGGRESSIVENESS = int(os.getenv("VAD_AGGRESSIVENESS", "2"))
MIN_SPEECH_SECONDS = float(os.getenv("MIN_SPEECH_SECONDS", "1.5"))
MAX_SEGMENT_SECONDS = float(os.getenv("MAX_SEGMENT_SECONDS", "300"))
SILENCE_TIMEOUT = float(os.getenv("SILENCE_TIMEOUT", "2.5"))
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/audio/inbox")
HEALTH_PORT = int(os.getenv("HEALTH_PORT", "9001"))

# Adaptive silence timeout
SILENCE_TIMEOUT_MIN = float(os.getenv("SILENCE_TIMEOUT_MIN", str(SILENCE_TIMEOUT)))
SILENCE_TIMEOUT_MAX = float(os.getenv("SILENCE_TIMEOUT_MAX", str(SILENCE_TIMEOUT)))
SILENCE_GROW_AFTER = float(os.getenv("SILENCE_GROW_AFTER_SECONDS", "15"))

# Voice command dispatch
GATEWAY_URL = os.getenv("OPENCLAW_GATEWAY_URL", "http://oasis:18789")
HOOKS_PATH = "/hooks/agent"
HOOKS_TOKEN = os.getenv("OPENCLAW_GATEWAY_TOKEN", "")
FRED_TELEGRAM_CHAT_ID = "7955595068"
VOICE_COMMAND_ALLOWED_SPEAKERS = set(
    s.strip().lower() for s in os.getenv("VOICE_COMMAND_ALLOWED_SPEAKERS", "").split(",") if s.strip()
)
TRANSCRIPT_DONE_DIR = os.getenv("TRANSCRIPT_WATCH_DIR", "/audio/done")

# Quiet hours: disable recording during specified hours (local time).
# Format: "HH-HH" e.g. "23-06" means 11pm to 6am. Empty string disables.
QUIET_HOURS = os.getenv("QUIET_HOURS", "")
QUIET_HOURS_START = None
QUIET_HOURS_END = None
if QUIET_HOURS and "-" in QUIET_HOURS:
    try:
        _qh_parts = QUIET_HOURS.split("-")
        QUIET_HOURS_START = int(_qh_parts[0])
        QUIET_HOURS_END = int(_qh_parts[1])
    except (ValueError, IndexError):
        pass


def is_quiet_hours():
    """Check if current local time falls within quiet hours."""
    if QUIET_HOURS_START is None or QUIET_HOURS_END is None:
        return False
    hour = datetime.now().hour
    if QUIET_HOURS_START > QUIET_HOURS_END:
        return hour >= QUIET_HOURS_START or hour < QUIET_HOURS_END
    else:
        return QUIET_HOURS_START <= hour < QUIET_HOURS_END


# Noise gate: minimum RMS energy for a frame to be considered speech.
NOISE_GATE_RMS = float(os.getenv("NOISE_GATE_RMS", "0.01"))

FRAME_DURATION_MS = 30
FRAME_SIZE = int(SAMPLE_RATE * FRAME_DURATION_MS / 1000)
CHANNELS = 1
SAMPLE_WIDTH = 2

# --- Logging --------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("audio-listener")

# --- Agent Trigger Registry -----------------------------------------------

AGENT_DEFINITIONS = [
    {"id": "oasis",   "triggers": ["hey oasis", "hay oasis", "oasis", "ohasis", "oh asis", "oases"]},
    {"id": "aech",    "triggers": ["hey aech", "hey h", "aech"]},
    {"id": "curator", "triggers": ["hey curator", "the curator", "curator"]},
    {"id": "art3mis", "triggers": ["hey artemis", "artemis", "artimis", "art3mis"]},
    {"id": "ogden",   "triggers": ["hey ogden", "ogden morrow", "ogden"]},
    {"id": "ir0k",    "triggers": ["hey irok", "irok", "i rok", "i rock", "i-rok", "eye rock"]},
    {"id": "nolan",   "triggers": ["hey nolan", "nolan"]},
    {"id": "dito",    "triggers": ["hey dito", "hey ditto", "dito", "ditto"]},
    {"id": "anorak",  "triggers": ["hey anorak", "anorak", "anna rack"]},
]

AGENT_TRIGGERS = {}
for _def in AGENT_DEFINITIONS:
    for _trig in _def["triggers"]:
        AGENT_TRIGGERS[_trig.lower()] = _def["id"]

SORTED_TRIGGERS = sorted(AGENT_TRIGGERS.keys(), key=len, reverse=True)

# --- State ----------------------------------------------------------------

listener_state = {
    "status": "starting",
    "recording": False,
    "segments_saved": 0,
    "segments_discarded_silent": 0,
    "current_segment_seconds": 0,
    "last_speech_detected": None,
    "commands_dispatched": 0,
    "last_command_dispatched": None,
    "commands_blocked_speaker": 0,
    "quiet_hours": QUIET_HOURS or None,
    "quiet_hours_active": False,
    "uptime_start": time.time(),
    # AssemblyAI pipeline stats
    "assemblyai_submitted": 0,
    "assemblyai_completed": 0,
    "assemblyai_failed": 0,
    "assemblyai_pending": 0,
    "assemblyai_cost_usd": 0.0,
    "assemblyai_hours_transcribed": 0.0,
    "last_transcript_completed": None,
}

# --- AssemblyAI Transcriber (initialized in main) -------------------------

_transcriber = None

# --- Health Check Server --------------------------------------------------

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            # Lightweight check for Docker healthcheck -- kept fast.
            self._handle_health_basic()
        elif self.path == "/health/detailed":
            # Full metrics: pipeline throughput, queue depth, speaker ID, recording state.
            self._handle_health_detailed()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_health_basic(self):
        """Minimal health response for Docker healthcheck (fast)."""
        basic = {
            "status": listener_state.get("status", "unknown"),
            "uptime_seconds": round(time.time() - listener_state.get("uptime_start", time.time()), 1),
            "recording": listener_state.get("recording", False),
            "quiet_hours_active": is_quiet_hours(),
        }
        self._json_response(200, basic)

    def _handle_health_detailed(self):
        """Expanded metrics for dashboards and diagnostics."""
        state = {**listener_state}
        uptime_start = state.pop("uptime_start", time.time())
        state["uptime_seconds"] = round(time.time() - uptime_start, 1)
        state["speaker_verification"] = VERIFY_SPEAKER
        state["quiet_hours_active"] = is_quiet_hours()

        # Pipeline throughput (from listener_state)
        state["pipeline"] = {
            "assemblyai_submitted": state.pop("assemblyai_submitted", 0),
            "assemblyai_completed": state.pop("assemblyai_completed", 0),
            "assemblyai_failed": state.pop("assemblyai_failed", 0),
            "assemblyai_pending": state.pop("assemblyai_pending", 0),
            "assemblyai_skipped_short": state.pop("assemblyai_skipped_short", 0),
            "assemblyai_cost_usd": round(state.pop("assemblyai_cost_usd", 0.0), 4),
            "assemblyai_hours_transcribed": round(state.pop("assemblyai_hours_transcribed", 0.0), 2),
            "last_transcript_completed": state.pop("last_transcript_completed", None),
            "commands_dispatched": state.pop("commands_dispatched", 0),
            "last_command_dispatched": state.pop("last_command_dispatched", None),
            "commands_blocked_speaker": state.pop("commands_blocked_speaker", 0),
            "commands_blocked_unauthorized": state.pop("commands_blocked_unauthorized", 0),
        }

        # Queue depth: count WAV files in inbox (OUTPUT_DIR)
        try:
            inbox = Path(OUTPUT_DIR)
            wav_files = list(inbox.glob("recording_*.wav"))
            state["queue"] = {
                "inbox_wav_count": len(wav_files),
                "inbox_path": OUTPUT_DIR,
            }
        except Exception:
            state["queue"] = {"inbox_wav_count": -1, "error": "failed to read inbox"}

        # Speaker ID status
        try:
            state["speaker_id"] = get_identification_stats()
        except Exception:
            state["speaker_id"] = {"error": "failed to read stats"}

        # Recording state
        state["recording_state"] = {
            "active": state.get("recording", False),
            "current_segment_seconds": state.get("current_segment_seconds", 0),
            "segments_saved": state.get("segments_saved", 0),
            "segments_discarded_silent": state.get("segments_discarded_silent", 0),
            "last_speech_detected": state.get("last_speech_detected"),
        }

        # AssemblyAI transcriber detail (active jobs)
        if _transcriber:
            state["assemblyai"] = _transcriber.get_stats()

        self._json_response(200, state)

    def _json_response(self, code, data):
        """Send a JSON HTTP response."""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_POST(self):
        if self.path == "/label-speaker":
            self._handle_label_speaker()
        elif self.path == "/reidentify":
            self._handle_reidentify()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_reidentify(self):
        """Trigger re-identification of transcripts with unidentified speakers."""
        global _transcriber
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode("utf-8")) if content_length > 0 else {}

            if not _transcriber:
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Transcriber not initialized"}).encode())
                return

            force_all = body.get("force_all", False)
            thread = threading.Thread(
                target=_transcriber.retry_failed_speaker_id,
                kwargs={"force_all": force_all},
                daemon=True,
                name="reidentify-trigger",
            )
            thread.start()

            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "message": "Re-identification started",
                "force_all": force_all,
            }).encode())
        except Exception as e:
            log.error(f"Reidentify failed: {e}")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _handle_label_speaker(self):
        """Handle speaker labeling requests from the dashboard.

        Expects JSON: { "transcript_file": "...", "speaker_id": "SPEAKER_00", "name": "fred" }
        """
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length).decode("utf-8"))

            transcript_file = body.get("transcript_file", "")
            speaker_id = body.get("speaker_id", "")
            name = body.get("name", "")

            if not transcript_file or not speaker_id or not name:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing required fields"}).encode())
                return

            # Find the transcript and audio files
            transcript_path = Path(TRANSCRIPT_DONE_DIR) / transcript_file
            if not transcript_path.exists():
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Transcript not found"}).encode())
                return

            transcript_data = json.loads(transcript_path.read_text(encoding="utf-8"))
            audio_filename = transcript_data.get("file", "")
            audio_path = Path(OUTPUT_DIR) / audio_filename if audio_filename else None

            # Find the speaker's segments and extract embeddings
            import numpy as np
            from speaker_verify import (
                extract_embedding,
                deduplicate_embeddings,
                compute_self_consistency,
                auto_threshold,
                _load_profiles,
            )

            segments = transcript_data.get("segments", [])
            speaker_segs = [s for s in segments if s.get("speaker") == speaker_id]

            if not speaker_segs:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Speaker {speaker_id} not found in transcript"}).encode())
                return

            # Extract embeddings from ALL qualifying segments (>= 1s)
            new_embeddings = []
            if audio_path and audio_path.exists():
                for seg in speaker_segs:
                    start = seg.get("start", 0)
                    end = seg.get("end", 0)
                    if (end - start) < 1.0:
                        continue
                    emb = extract_embedding(str(audio_path), start, end)
                    if emb is not None:
                        new_embeddings.append(emb)

            # Update or create voice profile
            profiles_dir = Path(os.getenv("VOICE_PROFILES_DIR", "/voice-profiles"))
            profile_path = profiles_dir / f"{name.lower()}.json"

            if profile_path.exists():
                profile = json.loads(profile_path.read_text(encoding="utf-8"))
            else:
                profile = {
                    "name": name.lower(),
                    "enrolledAt": datetime.now(timezone.utc).isoformat(),
                    "enrollmentMethod": "manual-label",
                    "numSamples": 0,
                    "embeddingDimensions": 192,
                    "embeddings": [],
                    "threshold": 0.35,
                    "selfConsistency": None,
                }

            if new_embeddings:
                # L2-normalize new embeddings before saving to profile
                for i, emb in enumerate(new_embeddings):
                    norm = np.linalg.norm(emb)
                    if norm > 0:
                        new_embeddings[i] = emb / norm

                # Merge with existing embeddings and deduplicate
                existing = [np.array(e) for e in profile.get("embeddings", [])]
                all_embs = existing + new_embeddings
                merged = deduplicate_embeddings(all_embs)

                profile["embeddings"] = [e.tolist() for e in merged]
                profile["numSamples"] = len(merged)
                profile["lastUpdated"] = datetime.now(timezone.utc).isoformat()

                # Auto-calibrate threshold from self-consistency
                consistency = compute_self_consistency(merged)
                if consistency is not None:
                    profile["selfConsistency"] = round(consistency, 4)
                    profile["threshold"] = auto_threshold(consistency)

                # Atomic write
                tmp_profile = profile_path.with_name(f".tmp_{profile_path.name}")
                tmp_profile.write_text(
                    json.dumps(profile, indent=2), encoding="utf-8"
                )
                tmp_profile.rename(profile_path)

                # Force reload profiles
                _load_profiles(force_reload=True)

                # Trigger background re-identification of existing transcripts
                # now that a new/updated profile is available
                if _transcriber:
                    threading.Thread(
                        target=_transcriber.retry_failed_speaker_id,
                        kwargs={"force_all": True},
                        daemon=True,
                        name="reidentify-after-label",
                    ).start()
                    log.info("Triggered re-identification after profile update")

            # Update transcript with speaker name
            for seg in segments:
                if seg.get("speaker") == speaker_id:
                    seg["speaker_name"] = name.lower()

            # Atomic write for transcript
            tmp_transcript = transcript_path.with_name(f".tmp_{transcript_path.name}")
            tmp_transcript.write_text(
                json.dumps(transcript_data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            tmp_transcript.rename(transcript_path)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "speaker_id": speaker_id,
                "name": name,
                "embeddings_added": len(new_embeddings),
                "total_embeddings": profile.get("numSamples", 0),
                "threshold": profile.get("threshold"),
            }).encode())

        except Exception as e:
            log.error(f"Label speaker failed: {e}")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, format, *args):
        pass


def start_health_server():
    server = HTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log.info(f"Health check server on port {HEALTH_PORT}")


# --- Voice Command Detection ----------------------------------------------

def detect_voice_commands(segments, audio_path=None):
    """Scan transcript segments for agent-directed commands.

    Returns a list of (agent_id, command_text, segment) tuples.

    When speaker verification is enabled (VERIFY_SPEAKER=true), only
    commands from verified enrolled speakers are returned. Commands from
    unrecognized voices are logged and dropped.
    """
    # --- Speaker verification gate ---
    if VERIFY_SPEAKER and audio_path:
        verified_speakers = verify_speaker_from_file(audio_path, segments)
        if not verified_speakers:
            log.warning(
                "BLOCKED: No enrolled speaker detected in audio -- "
                "dropping all voice commands"
            )
            listener_state["commands_blocked_speaker"] += 1
            return []
        has_verified = any(seg.get("speaker_name") for seg in segments)
    else:
        has_verified = False

    commands = []
    for seg in segments:
        if has_verified and not seg.get("speaker_name"):
            continue

        # Only allow commands from authorized speakers
        speaker = seg.get("speaker_name", "unknown")
        if VOICE_COMMAND_ALLOWED_SPEAKERS and speaker.lower() not in VOICE_COMMAND_ALLOWED_SPEAKERS:
            text = seg.get("text", "").strip()
            if text:
                log.info(f"BLOCKED: Voice command from '{speaker}' (not in allowed speakers: {VOICE_COMMAND_ALLOWED_SPEAKERS})")
                listener_state["commands_blocked_unauthorized"] = listener_state.get("commands_blocked_unauthorized", 0) + 1
            continue

        text = seg.get("text", "").strip()
        if not text:
            continue

        text_lower = text.lower()

        for trigger in SORTED_TRIGGERS:
            idx = text_lower.find(trigger)
            if idx == -1:
                continue

            if idx > 20:
                continue

            after = text[idx + len(trigger):]
            after = re.sub(r'^[,;:\.\s]+', '', after).strip()

            if len(after) < 3:
                continue

            agent_id = AGENT_TRIGGERS[trigger]
            log.info(f"Voice command from authorized speaker '{speaker}': {agent_id}")
            commands.append((agent_id, after, seg))
            break

    return commands


def dispatch_voice_command(agent_id, command_text, segment):
    """Send a detected voice command to the gateway hooks API."""
    if not HOOKS_TOKEN:
        log.warning(f"SKIP dispatch (no token): {agent_id} <- {command_text}")
        return False

    payload = {
        "message": command_text,
        "name": "Fred (Voice)",
        "agentId": agent_id,
        "channel": "telegram",
        "to": FRED_TELEGRAM_CHAT_ID,
        "deliver": True,
        "sessionKey": f"voice:{agent_id}:fred",
    }

    data = json.dumps(payload).encode("utf-8")
    url = f"{GATEWAY_URL}{HOOKS_PATH}"

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {HOOKS_TOKEN}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            run_id = body.get("runId", "?")
            log.info(f"DISPATCHED -> {agent_id}: \"{command_text}\" (runId={run_id})")
            listener_state["commands_dispatched"] += 1
            listener_state["last_command_dispatched"] = datetime.now(timezone.utc).isoformat()
            return True
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        log.error(f"DISPATCH FAILED -> {agent_id}: HTTP {e.code} -- {error_body}")
        return False
    except Exception as e:
        log.error(f"DISPATCH FAILED -> {agent_id}: {e}")
        return False


def on_transcript_ready(segments, audio_path):
    """Callback invoked by AssemblyAI transcriber after results arrive.

    Runs voice command detection + dispatch inline.
    """
    if not segments:
        return

    audio_path = Path(audio_path) if audio_path else None
    commands = detect_voice_commands(segments, audio_path=audio_path)
    for agent_id, command_text, seg in commands:
        log.info(f"Voice command detected: {agent_id} <- \"{command_text}\"")
        dispatch_voice_command(agent_id, command_text, seg)


# --- Audio Recording ------------------------------------------------------

def frame_rms(data):
    """Compute RMS energy of a 16-bit PCM audio frame, normalized to [0, 1]."""
    import struct as _struct
    n_samples = len(data) // 2
    if n_samples == 0:
        return 0.0
    samples = _struct.unpack(f"<{n_samples}h", data)
    sum_sq = sum(s * s for s in samples)
    return (sum_sq / n_samples) ** 0.5 / 32768.0


def has_speech_content(frames):
    """Check if frames contain actual speech above the noise gate threshold."""
    if not frames or NOISE_GATE_RMS <= 0:
        return True

    min_speech_frames = max(1, int(0.5 * 1000 / FRAME_DURATION_MS))
    speech_frames = 0
    for data in frames:
        rms = frame_rms(data)
        if rms >= NOISE_GATE_RMS:
            speech_frames += 1
            if speech_frames >= min_speech_frames:
                return True
    return False


def save_segment(frames, segment_start_time):
    if not frames:
        return None

    duration = len(frames) * FRAME_DURATION_MS / 1000.0
    if duration < MIN_SPEECH_SECONDS:
        log.debug(f"Segment too short ({duration:.1f}s < {MIN_SPEECH_SECONDS}s), discarding")
        return None

    if not has_speech_content(frames):
        log.info(f"Segment discarded: {duration:.1f}s of audio with no clear speech (below noise gate)")
        listener_state["segments_discarded_silent"] += 1
        return None

    timestamp = segment_start_time.strftime("%Y%m%d_%H%M%S")
    filename = f"recording_{timestamp}.wav"
    filepath = Path(OUTPUT_DIR) / filename
    tmp_filepath = Path(OUTPUT_DIR) / f".tmp_{filename}"

    with wave.open(str(tmp_filepath), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(b"".join(frames))

    tmp_filepath.rename(filepath)

    listener_state["segments_saved"] += 1
    log.info(f"Saved: {filename} ({duration:.1f}s)")

    # Submit to AssemblyAI for transcription + diarization + speaker ID
    if _transcriber:
        thread = threading.Thread(
            target=_transcriber.submit_and_process,
            args=(filepath,),
            daemon=True,
        )
        thread.start()
    else:
        log.warning(f"No transcriber configured -- {filename} saved but not submitted")

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
        try:
            default = pa.get_default_input_device_info()
            log.info(f"Using default audio device: {default['name']}")
        except OSError:
            log.info("No default input device, scanning for PulseAudio...")
            for i in range(pa.get_device_count()):
                d = pa.get_device_info_by_index(i)
                if d["maxInputChannels"] > 0 and "pulse" in d["name"].lower():
                    device_index = i
                    log.info(f"Found PulseAudio device: {d['name']} (index {i})")
                    break
            if device_index is None:
                log.error("No input device found. Is PulseAudio running on the host?")
                sys.exit(1)

    stream = pa.open(
        format=pyaudio.paInt16,
        channels=CHANNELS,
        rate=SAMPLE_RATE,
        input=True,
        input_device_index=device_index,
        frames_per_buffer=FRAME_SIZE
    )

    log.info("Audio listener active -- listening for speech...")
    log.info(f"Silence timeout: adaptive {SILENCE_TIMEOUT_MIN}s-{SILENCE_TIMEOUT_MAX}s (grows after {SILENCE_GROW_AFTER}s of speech)")
    log.info(f"Noise gate: RMS threshold={NOISE_GATE_RMS}, VAD aggressiveness={VAD_AGGRESSIVENESS}")
    if QUIET_HOURS:
        log.info(f"Quiet hours: {QUIET_HOURS_START}:00 - {QUIET_HOURS_END}:00 (recording paused)")
    listener_state["status"] = "listening"

    is_recording = False
    frames = []
    segment_start_time = None
    silence_frames = 0
    max_frames = int(MAX_SEGMENT_SECONDS * 1000 / FRAME_DURATION_MS)

    consecutive_errors = 0
    MAX_CONSECUTIVE_ERRORS = 50

    try:
        while True:
            try:
                data = stream.read(FRAME_SIZE, exception_on_overflow=False)
                consecutive_errors = 0
            except IOError as e:
                consecutive_errors += 1
                if consecutive_errors <= 3:
                    log.warning(f"Audio read error: {e}")
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    log.error(f"Stream broken ({consecutive_errors} consecutive errors), reconnecting...")
                    listener_state["status"] = "reconnecting"
                    try:
                        stream.stop_stream()
                        stream.close()
                    except Exception:
                        pass
                    time.sleep(5)
                    try:
                        stream = pa.open(
                            format=pyaudio.paInt16,
                            channels=CHANNELS,
                            rate=SAMPLE_RATE,
                            input=True,
                            input_device_index=device_index,
                            frames_per_buffer=FRAME_SIZE
                        )
                        consecutive_errors = 0
                        is_recording = False
                        frames = []
                        listener_state["status"] = "listening"
                        listener_state["recording"] = False
                        log.info("Audio stream reconnected successfully")
                    except Exception as re_err:
                        log.error(f"Reconnect failed: {re_err}, retrying in 10s...")
                        time.sleep(10)
                continue

            # Quiet hours: pause recording between configured hours
            if is_quiet_hours():
                if listener_state["status"] != "quiet_hours":
                    if is_recording and frames:
                        save_segment(frames, segment_start_time)
                    is_recording = False
                    frames = []
                    segment_start_time = None
                    silence_frames = 0
                    listener_state["recording"] = False
                    listener_state["current_segment_seconds"] = 0
                    listener_state["status"] = "quiet_hours"
                    listener_state["quiet_hours_active"] = True
                    log.info(f"Quiet hours active ({QUIET_HOURS_START}:00-{QUIET_HOURS_END}:00) -- recording paused")
                continue
            elif listener_state["status"] == "quiet_hours":
                listener_state["status"] = "listening"
                listener_state["quiet_hours_active"] = False
                log.info("Quiet hours ended -- recording resumed")

            try:
                is_speech = vad.is_speech(data, SAMPLE_RATE)
            except Exception:
                continue

            # Noise gate: reject VAD false-positives from AGC-amplified ambient noise
            if is_speech and NOISE_GATE_RMS > 0:
                rms = frame_rms(data)
                if rms < NOISE_GATE_RMS:
                    is_speech = False

            if is_speech:
                listener_state["last_speech_detected"] = datetime.now(timezone.utc).isoformat()

                if not is_recording:
                    is_recording = True
                    frames = []
                    segment_start_time = datetime.now()
                    silence_frames = 0
                    listener_state["recording"] = True
                    log.info("Speech detected -- recording started")

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

                    # Adaptive silence threshold
                    speech_duration = len(frames) * FRAME_DURATION_MS / 1000.0
                    if speech_duration < SILENCE_GROW_AFTER:
                        effective_timeout = SILENCE_TIMEOUT_MIN
                    else:
                        progress = min((speech_duration - SILENCE_GROW_AFTER) / 60.0, 1.0)
                        effective_timeout = SILENCE_TIMEOUT_MIN + progress * (SILENCE_TIMEOUT_MAX - SILENCE_TIMEOUT_MIN)
                    silence_threshold = int(effective_timeout * 1000 / FRAME_DURATION_MS)

                    if silence_frames >= silence_threshold:
                        save_segment(frames, segment_start_time)
                        is_recording = False
                        frames = []
                        segment_start_time = None
                        silence_frames = 0
                        listener_state["recording"] = False
                        listener_state["current_segment_seconds"] = 0
                        log.info(f"Silence timeout ({effective_timeout:.1f}s) -- recording stopped")

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


# --- Main -----------------------------------------------------------------

if __name__ == "__main__":
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

    log.info(f"Agent triggers loaded: {len(SORTED_TRIGGERS)} phrases for {len(AGENT_DEFINITIONS)} agents")

    if VERIFY_SPEAKER:
        log.info("Speaker verification ENABLED -- only enrolled speakers can issue commands")
        if is_verification_enabled():
            log.info("Speaker profiles loaded successfully")
        else:
            log.warning("Speaker verification enabled but NO profiles found -- all commands will be BLOCKED")
    else:
        log.warning("Speaker verification DISABLED -- any voice can issue commands")

    # Initialize AssemblyAI transcriber
    from assemblyai_transcriber import AssemblyAITranscriber, ASSEMBLYAI_API_KEY

    if ASSEMBLYAI_API_KEY:
        _transcriber = AssemblyAITranscriber(
            done_dir=TRANSCRIPT_DONE_DIR,
            inbox_dir=OUTPUT_DIR,
            listener_state=listener_state,
            voice_command_callback=on_transcript_ready,
        )
        log.info("AssemblyAI transcriber initialized (Universal-2 + speaker diarization)")

        # Run audio cleanup on startup
        _transcriber.cleanup_old_audio()
    else:
        log.warning("ASSEMBLYAI_API_KEY not set -- audio will be saved but NOT transcribed")

    start_health_server()

    # Run the VAD listener (blocks)
    run_listener()
