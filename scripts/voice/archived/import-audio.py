#!/usr/bin/env python3
"""OpenClaw audio file importer with speaker recognition.
Scans a directory for audio files, transcribes new ones using faster-whisper,
performs speaker diarization and matching, and saves transcripts to the curator workspace.

Usage:
    python scripts/voice/import-audio.py [--source /path/to/audio/folder]

Designed to run weekly via launchd. Idempotent — skips already-transcribed files.
"""
import os
import subprocess
import argparse
import time
import tempfile
import shutil

# Fix OpenMP library conflicts between faster-whisper and SpeechBrain
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
os.environ['OMP_NUM_THREADS'] = '1'

# Pull HF_TOKEN from macOS Keychain if not already in environment
if not os.getenv("HF_TOKEN"):
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", "openclaw", "-a", "HF_TOKEN", "-w"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            os.environ["HF_TOKEN"] = result.stdout.strip()
    except Exception:
        pass

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import torch
import numpy as np
import json
from datetime import datetime
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline
from speechbrain.inference.speaker import EncoderClassifier
from transcription_lock import transcription_lock

# Configuration
RATE = 16000
AUDIO_EXTENSIONS = {'.mp3', '.m4a', '.wav', '.ogg', '.webm', '.flac', '.aac'}
PROFILES_DIR = Path.home() / ".openclaw" / "voice-profiles"
OUTPUT_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice" / "imported"
DEFAULT_SOURCE = Path.home() / "Library" / "CloudStorage" / \
    "GoogleDrive-aech.clawbot@gmail.com" / ".shortcut-targets-by-id" / \
    "1XPKf8bAq0qbOL7AmAPspViT82YUf_h8V" / \
    "The Oasis - Personal AI Agent Framework" / "00_The_Library" / "Audio Recordings"

# Create output directory
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def load_models():
    """Load all ML models."""
    print("Loading models...")
    print("  [1/3] Whisper transcription model...")
    whisper_model = WhisperModel("base.en", device="cpu", compute_type="int8")

    print("  [2/3] Speaker recognition model...")
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(Path.home() / ".openclaw" / "models" / "spkrec")
    )

    print("  [3/3] Speaker diarization model...")
    diarize_pipeline = None
    HF_TOKEN = os.getenv("HF_TOKEN")
    if HF_TOKEN:
        try:
            diarize_pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.0",
                use_auth_token=HF_TOKEN
            )
            print("  ✅ All models loaded (diarization enabled)")
        except Exception as e:
            print(f"  ⚠️  Diarization failed: {e}")
    else:
        print("  ⚠️  HF_TOKEN not set — diarization disabled")

    return whisper_model, classifier, diarize_pipeline


def load_profiles():
    """Load enrolled speaker profiles."""
    profiles = {}
    for pf in PROFILES_DIR.glob("*.json"):
        try:
            with open(pf) as f:
                p = json.load(f)
                profiles[p["name"]] = p
        except Exception:
            pass
    if profiles:
        print(f"  Speakers: {', '.join(profiles.keys())}")
    return profiles


def validate_audio_file(audio_path):
    """Validate audio file integrity using ffprobe.

    Returns:
        tuple: (is_valid, error_message)
    """
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration,bit_rate",
                "-of", "json",
                str(audio_path)
            ],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            error = result.stderr.strip() or "ffprobe validation failed"
            return False, error

        # Parse output to ensure we got valid format info
        try:
            data = json.loads(result.stdout)
            if "format" not in data or "duration" not in data["format"]:
                return False, "Missing format/duration info"
        except json.JSONDecodeError:
            return False, "Invalid ffprobe output"

        return True, None

    except subprocess.TimeoutExpired:
        return False, "ffprobe timeout (file may be corrupted)"
    except FileNotFoundError:
        return False, "ffprobe not found (install ffmpeg)"
    except Exception as e:
        return False, f"Validation error: {e}"


def convert_to_wav(audio_path, temp_dir):
    """Convert audio file to WAV format using ffmpeg.

    Args:
        audio_path: Path to source audio file
        temp_dir: Temporary directory for converted file

    Returns:
        Path to converted WAV file, or None if conversion fails
    """
    try:
        wav_path = Path(temp_dir) / f"{audio_path.stem}.wav"

        result = subprocess.run(
            [
                "ffmpeg",
                "-i", str(audio_path),
                "-ar", str(RATE),  # Resample to 16kHz
                "-ac", "1",  # Mono
                "-c:a", "pcm_s16le",  # PCM 16-bit
                "-y",  # Overwrite
                str(wav_path)
            ],
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes max
        )

        if result.returncode != 0:
            error = result.stderr.strip()
            print(f"    ❌ FFmpeg conversion failed: {error}")
            return None

        if not wav_path.exists():
            print(f"    ❌ WAV file not created: {wav_path}")
            return None

        return wav_path

    except subprocess.TimeoutExpired:
        print(f"    ❌ FFmpeg timeout (file may be very large or corrupted)")
        return None
    except FileNotFoundError:
        print(f"    ❌ ffmpeg not found (install ffmpeg)")
        return None
    except Exception as e:
        print(f"    ❌ Conversion error: {e}")
        return None


def find_new_files(source_dir):
    """Find audio files that haven't been transcribed yet."""
    all_files = []
    for f in sorted(source_dir.iterdir()):
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS:
            all_files.append(f)

    # Check which ones already have transcripts
    new_files = []
    for f in all_files:
        transcript_path = OUTPUT_DIR / f"{f.stem}.json"
        if not transcript_path.exists():
            new_files.append(f)

    return all_files, new_files


def transcribe(whisper_model, audio_path):
    """Transcribe audio file using faster-whisper with VAD filtering."""
    segments, info = whisper_model.transcribe(
        str(audio_path),
        language="en",
        vad_filter=True
    )

    result_segments = []
    for segment in segments:
        result_segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text
        })

    return result_segments, info


def diarize(diarize_pipeline, audio_path):
    """Perform speaker diarization."""
    if not diarize_pipeline:
        return None

    try:
        diarization = diarize_pipeline(str(audio_path))
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


def assign_speakers(transcript_segments, speaker_segments):
    """Assign speaker labels to transcript segments."""
    if not speaker_segments:
        return transcript_segments

    for seg in transcript_segments:
        seg_mid = (seg["start"] + seg["end"]) / 2
        for spk_seg in speaker_segments:
            if spk_seg["start"] <= seg_mid <= spk_seg["end"]:
                seg["speaker"] = spk_seg["speaker"]
                break
        if "speaker" not in seg:
            seg["speaker"] = "unknown"

    return transcript_segments


def match_speakers(segments, audio_path, classifier, profiles):
    """Match diarized speakers against enrolled profiles."""
    if not profiles:
        return segments

    audio = classifier.load_audio(str(audio_path))
    speakers_audio = {}

    for seg in segments:
        speaker_id = seg.get("speaker", "unknown")
        if speaker_id not in speakers_audio:
            speakers_audio[speaker_id] = []

        start_sample = int(seg["start"] * RATE)
        end_sample = int(seg["end"] * RATE)
        if end_sample > len(audio):
            end_sample = len(audio)
        segment_audio = audio[start_sample:end_sample]
        speakers_audio[speaker_id].append(segment_audio)

    speaker_mapping = {}
    for speaker_id, audio_chunks in speakers_audio.items():
        if speaker_id == "unknown":
            continue

        try:
            combined_audio = np.concatenate(audio_chunks)
            if len(combined_audio) < RATE:
                continue

            audio_tensor = torch.tensor(combined_audio).unsqueeze(0)
            with torch.no_grad():
                embedding = classifier.encode_batch(audio_tensor)
            embedding_np = embedding.squeeze().cpu().numpy()

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
            else:
                speaker_mapping[speaker_id] = None
        except Exception:
            pass

    for seg in segments:
        speaker_id = seg.get("speaker")
        if speaker_id and speaker_id in speaker_mapping:
            seg["speaker_name"] = speaker_mapping[speaker_id]

    return segments


def save_transcript(segments, audio_path, duration, stem):
    """Save transcript JSON to the curator workspace."""
    # Use file modification time as timestamp
    mtime = os.path.getmtime(str(audio_path))
    timestamp = datetime.utcfromtimestamp(mtime)

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
        "timestamp": timestamp.isoformat() + "Z",
        "duration": round(duration),
        "transcript": " ".join([s["text"] for s in segments]),
        "audioPath": str(audio_path),
        "title": stem.replace("_", " "),
        "speakers": list(speakers.values()),
        "numSpeakers": len(speakers),
        "source": "voice-import"
    }

    out_file = OUTPUT_DIR / f"{stem}.json"
    with open(out_file, 'w') as f:
        json.dump(data, f, indent=2)

    return out_file, len(speakers)


def process_file(audio_path, whisper_model, classifier, diarize_pipeline, profiles):
    """Process a single audio file end-to-end with validation and conversion.

    Acquires the cross-process transcription lock so only one transcription
    (across the listener and the audio importer) runs at a time. Validation
    and conversion happen outside the lock since they're lightweight.
    """
    stem = audio_path.stem
    temp_dir = None
    wav_path = None

    try:
        # Step 1: Validate audio file integrity (no lock needed)
        print(f"    Validating...", end="", flush=True)
        is_valid, error_msg = validate_audio_file(audio_path)
        if not is_valid:
            print(f"\r    ❌ Validation failed: {error_msg}", flush=True)
            return False
        print(f"\r    ✓ Valid", flush=True)

        # Step 2: Convert to WAV for reliable processing (no lock needed)
        print(f"    Converting to WAV...", end="", flush=True)
        temp_dir = tempfile.mkdtemp(prefix="openclaw_audio_")
        wav_path = convert_to_wav(audio_path, temp_dir)
        if not wav_path:
            print(f"\r    ❌ Failed to convert to WAV", flush=True)
            return False
        print(f"\r    ✓ Converted ({wav_path.stat().st_size // 1024 // 1024}MB)", flush=True)

        # Steps 3-5: ML-heavy work — one at a time across all processes
        print(f"    Waiting for transcription lock...", end="", flush=True)
        with transcription_lock():
            print(f"\r    🔓 Lock acquired                  ", flush=True)

            # Step 3: Transcribe (using WAV)
            print(f"    Transcribing...", end="", flush=True)
            segments, info = transcribe(whisper_model, wav_path)

            if not segments:
                print(f"\r    🔇 No speech detected — skipping", flush=True)
                return False

            duration = info.duration
            print(f"\r    ✓ Transcribed ({len(segments)} segments)", flush=True)

            # Step 4: Diarize (using WAV)
            if diarize_pipeline:
                print(f"    Diarizing...", end="", flush=True)
                speaker_segments = diarize(diarize_pipeline, wav_path)
                if speaker_segments:
                    segments = assign_speakers(segments, speaker_segments)
                    print(f"\r    ✓ Diarized ({len(speaker_segments)} turns)", flush=True)
                else:
                    print(f"\r    ⚠️  Diarization skipped", flush=True)

            # Step 5: Match speakers (using WAV)
            if profiles:
                print(f"    Matching speakers...", end="", flush=True)
                segments = match_speakers(segments, wav_path, classifier, profiles)
                print(f"\r    ✓ Matched", flush=True)

        # Step 6: Save (reference original file path) — lock released
        out_file, num_speakers = save_transcript(segments, audio_path, duration, stem)

        word_count = len(" ".join(s["text"] for s in segments).split())
        print(f"    ✅ {num_speakers} speaker(s), {word_count} words, {round(duration)}s → {out_file.name}", flush=True)

        return True

    except Exception as e:
        print(f"\r    ❌ Processing error: {e}", flush=True)
        return False

    finally:
        # Cleanup: Remove temporary WAV file and directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                print(f"    ⚠️  Cleanup warning: {e}", flush=True)


def check_dependencies():
    """Verify ffmpeg and ffprobe are installed."""
    missing = []
    for cmd in ["ffmpeg", "ffprobe"]:
        try:
            result = subprocess.run([cmd, "-version"], capture_output=True, timeout=5, check=True)
            print(f"  ✓ {cmd} found", flush=True)
        except FileNotFoundError:
            print(f"  ✗ {cmd} not found in PATH", flush=True)
            missing.append(cmd)
        except subprocess.SubprocessError as e:
            print(f"  ✗ {cmd} error: {e}", flush=True)
            missing.append(cmd)

    if missing:
        print(f"\n❌ Missing required dependencies: {', '.join(missing)}", flush=True)
        print(f"   Install with: brew install ffmpeg", flush=True)
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Import and transcribe audio files")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE,
                        help="Directory containing audio files")
    parser.add_argument("--max", type=int, default=0,
                        help="Max files to process per run (0 = unlimited)")
    parser.add_argument("--nice", type=int, default=10,
                        help="Nice level for CPU priority (0-20, default: 10)")
    args = parser.parse_args()

    # Set process priority (nice level) to conserve CPU for other tools
    try:
        import os
        current_nice = os.nice(0)  # Get current nice level
        os.nice(args.nice)  # Increment by nice value
        print(f"Process priority: nice level {current_nice} → {current_nice + args.nice}", flush=True)
    except Exception as e:
        print(f"⚠️  Could not set nice level: {e}", flush=True)

    source_dir = args.source
    if not source_dir.exists():
        print(f"❌ Source directory not found: {source_dir}")
        return

    # Check for required dependencies
    if not check_dependencies():
        return

    print("=" * 60)
    print("OpenClaw Audio Importer")
    print("=" * 60)
    print(f"Source: {source_dir}")
    print(f"Output: {OUTPUT_DIR}")
    print()

    # Find new files
    all_files, new_files = find_new_files(source_dir)
    print(f"📁 Found {len(all_files)} audio files, {len(new_files)} new")

    if not new_files:
        print("✅ Nothing to process — all files already transcribed")
        return

    # Apply max limit
    batch = new_files[:args.max] if args.max > 0 else new_files
    if args.max > 0 and len(new_files) > args.max:
        print(f"⏱️  Processing {len(batch)} of {len(new_files)} new files (--max {args.max})")

    # Load models (only if we have work to do)
    print()
    whisper_model, classifier, diarize_pipeline = load_models()
    profiles = load_profiles()
    print()

    # Process each new file
    processed = 0
    failed = 0
    skipped = 0
    start_time = time.time()

    for i, audio_file in enumerate(batch, 1):
        print(f"[{i}/{len(batch)}] {audio_file.name}", flush=True)
        try:
            result = process_file(audio_file, whisper_model, classifier, diarize_pipeline, profiles)
            if result:
                processed += 1
            else:
                # process_file returns False for validation failures, no speech, etc.
                failed += 1
        except KeyboardInterrupt:
            print("\n⚠️  Interrupted by user", flush=True)
            break
        except Exception as e:
            print(f"    ❌ Unexpected error: {e}", flush=True)
            import traceback
            traceback.print_exc()
            failed += 1

    elapsed = time.time() - start_time
    print()
    print("=" * 60)
    summary_parts = [f"{processed} transcribed"]
    if failed > 0:
        summary_parts.append(f"{failed} failed")
    if skipped > 0:
        summary_parts.append(f"{skipped} skipped")
    summary_parts.append(f"{elapsed:.0f}s elapsed")
    print(f"Done: {', '.join(summary_parts)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
