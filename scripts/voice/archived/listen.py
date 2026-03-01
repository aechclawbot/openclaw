#!/usr/bin/env python3
"""OpenClaw continuous voice listener with speaker recognition
Uses faster-whisper for transcription and pyannote.audio for speaker diarization
"""
import os
import re
import subprocess
import urllib.request
import urllib.error
# Fix OpenMP library conflicts between faster-whisper and SpeechBrain
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
os.environ['OMP_NUM_THREADS'] = '1'

# Lower process priority so diarization doesn't starve the system
try:
    os.nice(10)
except OSError:
    pass

def _read_keychain(key_name):
    """Read a value from macOS Keychain (service: openclaw)."""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", "openclaw", "-a", key_name, "-w"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return None

# Pull HF_TOKEN from macOS Keychain if not already in environment
if not os.getenv("HF_TOKEN"):
    _hf = _read_keychain("HF_TOKEN")
    if _hf:
        os.environ["HF_TOKEN"] = _hf

import pyaudio
import wave
import torch
import numpy as np
import json
import time
import threading
from queue import Queue
from datetime import datetime
from pathlib import Path
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline
from speechbrain.inference.speaker import EncoderClassifier
import sys
sys.path.insert(0, str(Path(__file__).parent))
from unknown_speaker_tracker import UnknownSpeakerTracker
from transcription_lock import transcription_lock

# Configuration
CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
MIN_CHUNK_SECONDS = 120    # 2 min — minimum before silence can end chunk
MAX_CHUNK_SECONDS = 1800   # 30 min — hard cap
SILENCE_GAP_SECONDS = 8    # seconds of continuous silence to trigger boundary
OUTPUT_DIR = Path.home() / ".openclaw" / "voice-transcripts" / "raw"
AUDIO_DIR = OUTPUT_DIR / "audio"
PROFILES_DIR = Path.home() / ".openclaw" / "voice-profiles"
CURATOR_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"

# Auto-cleanup: delete audio and raw transcripts older than this
RETENTION_DAYS = 3

# Silence detection: RMS threshold below which a chunk is considered silent
# 16-bit audio range is -32768..32767; typical silence is RMS < 200-500
SILENCE_RMS_THRESHOLD = 300

# Create directories
for d in [OUTPUT_DIR, AUDIO_DIR, CURATOR_DIR]:
    d.mkdir(parents=True, exist_ok=True)

print("Loading models (first run may take 1-2 minutes)...")
print("  [1/4] Whisper transcription model...")
whisper_model = WhisperModel("base.en", device="cpu", compute_type="int8")
print("  [2/4] Speaker recognition model...")
classifier = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir=str(Path.home() / ".openclaw" / "models" / "spkrec")
)
print("  [3/4] Speaker diarization model...")
HF_TOKEN = os.getenv("HF_TOKEN")
diarize_pipeline = None
if HF_TOKEN:
    # Try 3.0 first (uses ONNX embeddings — ~2.5x faster on CPU than 3.1)
    for model_id in ["pyannote/speaker-diarization-3.0", "pyannote/speaker-diarization-3.1"]:
        try:
            diarize_pipeline = Pipeline.from_pretrained(
                model_id,
                use_auth_token=HF_TOKEN
            )
            if diarize_pipeline is not None:
                print(f"  [4/4] ✅ All models loaded! (diarization: {model_id})")
                break
        except Exception as e:
            print(f"  [4/4] ⚠️  {model_id} failed: {e}")
            diarize_pipeline = None
    if diarize_pipeline is None:
        print("         Continuing without speaker diarization...")
else:
    print("  [4/4] ⚠️  HF_TOKEN not set - speaker diarization disabled")
    print("         Set HF_TOKEN to enable speaker diarization")

print()

# Load speaker profiles
profiles = {}
for pf in PROFILES_DIR.glob("*.json"):
    with open(pf) as f:
        p = json.load(f)
        profiles[p["name"]] = p
        print(f"  Loaded profile: {p['name']}")

if not profiles:
    print("  ⚠️  No speaker profiles found. Run enroll_speaker.py first.")

# Initialize unknown speaker tracker
unknown_tracker = UnknownSpeakerTracker()
print(f"  🔍 Unknown speaker tracking: enabled (min {unknown_tracker.min_samples} samples)")

# ---------------------------------------------------------------------------
# Voice command routing — detect agent-directed commands from Fred and
# dispatch them to the gateway hooks API (same as messaging on Telegram).
# ---------------------------------------------------------------------------

# Gateway hooks config
GATEWAY_URL = os.getenv("OPENCLAW_GATEWAY_URL", "http://localhost:18789")
HOOKS_PATH = "/hooks/agent"
FRED_TELEGRAM_CHAT_ID = "7955595068"

HOOKS_TOKEN = _read_keychain("OPENCLAW_GATEWAY_TOKEN")
if HOOKS_TOKEN:
    print(f"  🔗 Voice command dispatch: enabled (gateway {GATEWAY_URL})")
else:
    print("  ⚠️  No gateway token found — voice command dispatch disabled")

# Agent trigger registry: maps spoken phrases → agent IDs.
# Sorted longest-first at lookup time so "hey oasis" wins over bare "oasis".
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

AGENT_TRIGGERS = {}  # trigger_phrase (lowercase) -> agent_id
for _def in AGENT_DEFINITIONS:
    for _trig in _def["triggers"]:
        AGENT_TRIGGERS[_trig.lower()] = _def["id"]

# Sort longest-first for greedy matching
SORTED_TRIGGERS = sorted(AGENT_TRIGGERS.keys(), key=len, reverse=True)

print(f"  🎙️  Agent triggers loaded: {len(SORTED_TRIGGERS)} phrases for {len(AGENT_DEFINITIONS)} agents")

print()

def record_chunk():
    """Record audio with dynamic silence-boundary chunking."""
    p = pyaudio.PyAudio()
    stream = p.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)

    frames = []
    silence_start = None
    has_had_speech = False
    start = time.time()
    last_status = start

    print(f"🔴 Recording (min {MIN_CHUNK_SECONDS}s, max {MAX_CHUNK_SECONDS}s, "
          f"silence gap {SILENCE_GAP_SECONDS}s)...")

    while True:
        try:
            data = stream.read(CHUNK, exception_on_overflow=False)
        except OSError:
            continue  # skip this read on buffer overflow
        frames.append(data)
        now = time.time()
        elapsed = now - start

        # Hard cap
        if elapsed >= MAX_CHUNK_SECONDS:
            print(f"  ⏱️  Max duration reached ({MAX_CHUNK_SECONDS}s)")
            break

        # RMS check on this read
        audio_data = np.frombuffer(data, dtype=np.int16).astype(np.float32)
        rms = np.sqrt(np.mean(audio_data ** 2))

        if rms > SILENCE_RMS_THRESHOLD:
            has_had_speech = True
            silence_start = None
        else:
            if silence_start is None:
                silence_start = now

            # Speech → silence transition: end chunk if past min duration
            if (has_had_speech
                    and now - silence_start >= SILENCE_GAP_SECONDS
                    and elapsed >= MIN_CHUNK_SECONDS):
                print(f"  🔇 Silence gap detected after {elapsed:.0f}s of recording")
                break

            # All silence — give up after min duration
            if not has_had_speech and elapsed >= MIN_CHUNK_SECONDS:
                print(f"  🔇 No speech detected in {MIN_CHUNK_SECONDS}s — skipping")
                break

        # Periodic status every 60 seconds
        if now - last_status >= 60:
            status = "🗣️ speech" if silence_start is None else "🔇 silence"
            print(f"  ⏱️  {elapsed:.0f}s elapsed — {status}")
            last_status = now

    stream.stop_stream()
    stream.close()
    p.terminate()

    actual_duration = time.time() - start
    return frames, actual_duration, has_had_speech

def save_audio(frames, path):
    """Save audio frames to WAV file"""
    wf = wave.open(str(path), 'wb')
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(pyaudio.PyAudio().get_sample_size(FORMAT))
    wf.setframerate(RATE)
    wf.writeframes(b''.join(frames))
    wf.close()

def transcribe(audio_path):
    """Transcribe audio using faster-whisper"""
    print("  [1/3] Transcribing...")
    segments, info = whisper_model.transcribe(str(audio_path), language="en",
                                              vad_filter=True)

    # Convert segments to list with timestamps
    result_segments = []
    for segment in segments:
        result_segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text
        })

    return result_segments

def diarize(audio_path):
    """Perform speaker diarization"""
    if not diarize_pipeline:
        return None

    print("  [2/3] Identifying speakers...")
    try:
        diarization = diarize_pipeline(str(audio_path))

        # Convert diarization to speaker segments
        speaker_segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speaker_segments.append({
                "start": turn.start,
                "end": turn.end,
                "speaker": speaker
            })
        return speaker_segments
    except Exception as e:
        print(f"    ⚠️  Diarization failed: {e}")
        return None

def assign_speakers_to_transcripts(transcript_segments, speaker_segments):
    """Assign speaker labels to transcript segments"""
    if not speaker_segments:
        return transcript_segments

    for seg in transcript_segments:
        seg_mid = (seg["start"] + seg["end"]) / 2

        # Find which speaker segment this transcript segment belongs to
        for spk_seg in speaker_segments:
            if spk_seg["start"] <= seg_mid <= spk_seg["end"]:
                seg["speaker"] = spk_seg["speaker"]
                break

        if "speaker" not in seg:
            seg["speaker"] = "unknown"

    return transcript_segments

def match_speakers(segments, audio_path):
    """Match diarized speakers against enrolled profiles"""
    if not profiles:
        return segments

    print("  [3/3] Matching speakers...")

    # Load audio using SpeechBrain's classifier
    audio = classifier.load_audio(str(audio_path))

    # Group segments by speaker
    speakers_audio = {}

    for seg in segments:
        speaker_id = seg.get("speaker", "unknown")
        if speaker_id not in speakers_audio:
            speakers_audio[speaker_id] = []

        # Extract audio for this segment
        start_sample = int(seg["start"] * RATE)
        end_sample = int(seg["end"] * RATE)
        if end_sample > len(audio):
            end_sample = len(audio)
        segment_audio = audio[start_sample:end_sample]
        speakers_audio[speaker_id].append(segment_audio)

    # Extract embeddings for each speaker
    speaker_mapping = {}
    for speaker_id, audio_chunks in speakers_audio.items():
        if speaker_id == "unknown":
            continue

        try:
            # Concatenate all audio for this speaker
            combined_audio = np.concatenate(audio_chunks)
            if len(combined_audio) < RATE:  # Less than 1 second
                continue

            # Extract embedding
            audio_tensor = torch.tensor(combined_audio).unsqueeze(0)
            with torch.no_grad():
                embedding = classifier.encode_batch(audio_tensor)
            embedding_np = embedding.squeeze().cpu().numpy()

            # Match against profiles
            best_name, best_dist = None, float('inf')
            for name, prof in profiles.items():
                for enrolled in prof["embeddings"]:
                    e1, e2 = embedding_np, np.array(enrolled)
                    sim = np.dot(e1, e2) / (np.linalg.norm(e1) * np.linalg.norm(e2))
                    dist = 1 - sim
                    if dist < best_dist:
                        best_dist = dist
                        best_name = name

            threshold = profiles.get(best_name, {}).get("threshold", 0.25)
            if best_dist < threshold:
                speaker_mapping[speaker_id] = best_name
                print(f"    ✅ {speaker_id} → {best_name} (distance: {best_dist:.3f})")
            else:
                speaker_mapping[speaker_id] = None
                print(f"    ❓ {speaker_id} unknown (best: {best_dist:.3f})")

                # Track unknown speaker for automatic profile building
                try:
                    # Get transcript for this speaker
                    speaker_transcript = " ".join([s["text"] for s in segments if s.get("speaker") == speaker_id])
                    timestamp = datetime.utcnow().isoformat() + "Z"

                    # Save embedding and audio sample
                    unknown_tracker.add_sample(
                        speaker_id=speaker_id,
                        embedding=embedding_np,
                        audio_segment=combined_audio,
                        transcript=speaker_transcript,
                        timestamp=timestamp
                    )
                except Exception as track_err:
                    print(f"    ⚠️  Failed to track unknown speaker: {track_err}")
        except Exception as e:
            print(f"    ⚠️  Failed to match {speaker_id}: {e}")

    # Apply mapping to segments
    for seg in segments:
        speaker_id = seg.get("speaker")
        if speaker_id and speaker_id in speaker_mapping:
            seg["speaker_name"] = speaker_mapping[speaker_id]

    return segments

def save_transcript(segments, audio_path, ts, duration):
    """Save transcript with speaker information"""
    # Group by speaker
    speakers = {}
    for seg in segments:
        speaker_id = seg.get("speaker", "unknown")
        if speaker_id not in speakers:
            speakers[speaker_id] = {
                "id": speaker_id,
                "name": seg.get("speaker_name"),
                "utterances": []
            }
        speakers[speaker_id]["utterances"].append({
            "text": seg["text"],
            "start": seg["start"],
            "end": seg["end"]
        })

    data = {
        "timestamp": ts.isoformat() + "Z",
        "duration": round(duration),
        "transcript": " ".join([s["text"] for s in segments]),
        "audioPath": str(audio_path),
        "speakers": list(speakers.values()),
        "numSpeakers": len(speakers),
        "source": "voice-passive"
    }

    # Save to raw directory
    raw_file = OUTPUT_DIR / f"{ts.strftime('%Y-%m-%dT%H-%M-%S')}.json"
    with open(raw_file, 'w') as f:
        json.dump(data, f, indent=2)

    # Save to curator workspace
    curator_date_dir = CURATOR_DIR / ts.strftime('%Y/%m/%d')
    curator_date_dir.mkdir(parents=True, exist_ok=True)
    curator_file = curator_date_dir / f"{ts.strftime('%H-%M-%S')}.json"
    with open(curator_file, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"💾 Saved: {raw_file.name}")
    print(f"💾 Curator: {curator_file}")
    print(f"\n📊 Summary: {len(speakers)} speaker(s)")
    for spk in speakers.values():
        name = spk['name'] or spk['id']
        print(f"    - {name}: {len(spk['utterances'])} utterances")

def cleanup_old_files():
    """Delete audio WAVs and raw transcripts older than RETENTION_DAYS."""
    cutoff = time.time() - (RETENTION_DAYS * 86400)
    removed = 0

    # Clean audio files
    for f in AUDIO_DIR.glob("*.wav"):
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)
            removed += 1

    # Clean raw transcript JSONs
    for f in OUTPUT_DIR.glob("*.json"):
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)
            removed += 1

    if removed:
        print(f"  🧹 Cleaned up {removed} file(s) older than {RETENTION_DAYS} days")

def detect_voice_commands(segments):
    """Scan transcript segments for agent-directed commands.

    Returns a list of (agent_id, command_text, segment) tuples.
    Prefers segments from identified speakers (e.g. "fred"), but falls
    back to all segments when speaker recognition hasn't matched anyone.
    The trigger phrase itself provides sufficient intent signal.
    """
    # Check if any segment has a recognized speaker
    has_identified = any(seg.get("speaker_name") for seg in segments)

    commands = []
    for seg in segments:
        # If we have identified speakers, only check those
        if has_identified and not seg.get("speaker_name"):
            continue

        text = seg.get("text", "").strip()
        if not text:
            continue

        text_lower = text.lower()

        for trigger in SORTED_TRIGGERS:
            idx = text_lower.find(trigger)
            if idx == -1:
                continue

            # Only match if trigger is at (or very near) the start of the utterance.
            # Allow up to ~20 chars of preamble ("so", "um", "okay", etc.)
            if idx > 20:
                continue

            # Extract everything after the trigger as the command
            after = text[idx + len(trigger):]
            # Strip leading punctuation and whitespace
            after = re.sub(r'^[,;:\.\s]+', '', after).strip()

            if len(after) < 3:
                # Too short — likely just addressing the agent with no command
                continue

            agent_id = AGENT_TRIGGERS[trigger]
            commands.append((agent_id, after, seg))
            break  # first match wins for this segment

    return commands


def dispatch_voice_command(agent_id, command_text, segment):
    """Send a detected voice command to the gateway hooks API.

    POST /hooks/agent → agent processes the command and delivers
    the response to Fred's Telegram, same as a direct message.
    """
    if not HOOKS_TOKEN:
        print(f"    ⏭️  SKIP dispatch (no token): {agent_id} <- {command_text}")
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
            print(f"    📡 DISPATCHED -> {agent_id}: \"{command_text}\" (runId={run_id})")
            return True
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"    ❌ DISPATCH FAILED -> {agent_id}: HTTP {e.code} — {error_body}")
        return False
    except Exception as e:
        print(f"    ❌ DISPATCH FAILED -> {agent_id}: {e}")
        return False


def process_chunk(chunk_num, frames, actual_duration, ts):
    """Process a recorded chunk in the background: transcribe, diarize, match, save.

    Acquires the cross-process transcription lock so only one transcription
    (across the listener and the audio importer) runs at a time.
    """
    try:
        audio_file = AUDIO_DIR / f"chunk-{ts.strftime('%Y%m%d-%H%M%S')}.wav"
        save_audio(frames, audio_file)
        print(f"  💾 [Chunk {chunk_num}] Saved audio ({actual_duration:.0f}s), waiting for lock...")

        with transcription_lock():
            print(f"  🔓 [Chunk {chunk_num}] Lock acquired, processing...")

            # Transcribe
            segments = transcribe(audio_file)

            if not segments:
                print(f"  🔇 [Chunk {chunk_num}] No speech transcribed — removing audio")
                audio_file.unlink(missing_ok=True)
                return

            # Diarize
            speaker_segments = diarize(audio_file)
            if speaker_segments:
                segments = assign_speakers_to_transcripts(segments, speaker_segments)

            # Match speakers
            if profiles:
                segments = match_speakers(segments, audio_file)

        # Voice command dispatch and saving don't need the lock
        commands = detect_voice_commands(segments)
        if commands:
            print(f"  🎯 Voice command(s) detected: {len(commands)}")
            for agent_id, cmd_text, cmd_seg in commands:
                dispatch_voice_command(agent_id, cmd_text, cmd_seg)

        # Save
        save_transcript(segments, audio_file, ts, actual_duration)

        print(f"  ✅ [Chunk {chunk_num}] Complete ({actual_duration:.0f}s)")
    except Exception as e:
        print(f"  ❌ [Chunk {chunk_num}] Processing error: {e}")


def processing_worker(q):
    """Background worker that processes recorded chunks from the queue."""
    while True:
        item = q.get()
        if item is None:
            break
        process_chunk(*item)
        q.task_done()


def main():
    """Main loop with background processing."""
    print("="*60)
    print("OpenClaw Voice Listener")
    print("="*60)
    print(f"Enrolled speakers: {', '.join(profiles.keys()) or 'none'}")
    print(f"Diarization: {'enabled' if diarize_pipeline else 'disabled'}")
    print(f"Chunking: dynamic ({MIN_CHUNK_SECONDS}s min, {MAX_CHUNK_SECONDS}s max, {SILENCE_GAP_SECONDS}s silence gap)")
    print("Processing: background thread (no recording gaps)")
    print("Press Ctrl+C to stop")
    print()

    q = Queue()
    worker = threading.Thread(target=processing_worker, args=(q,), daemon=True)
    worker.start()

    chunk = 0
    try:
        while True:
            chunk += 1
            ts = datetime.utcnow()
            print("="*60)
            print(f"[Chunk {chunk}] {ts.strftime('%Y-%m-%d %H:%M:%S UTC')}")
            print("="*60)

            cleanup_old_files()

            frames, actual_duration, had_speech = record_chunk()

            if not had_speech:
                print()
                continue

            pending = q.qsize()
            if pending > 0:
                print(f"  📋 Queued for processing ({pending} chunk(s) ahead)")
            q.put((chunk, frames, actual_duration, ts))

    except KeyboardInterrupt:
        print("\n\nShutting down — waiting for processing to finish...")
        q.put(None)
        worker.join(timeout=30)
        print("Goodbye!")

if __name__ == "__main__":
    main()
