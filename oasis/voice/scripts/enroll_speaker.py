#!/usr/bin/env python3
"""Enroll speaker voice profile for OpenClaw voice recognition.

Records multiple audio samples with guided reading passages to build a
robust speaker embedding profile. Designed to be run interactively with
the same microphone the voice listener uses (e.g. Jabra SPEAK 410).
"""
import pyaudio
import wave
import numpy as np
from pathlib import Path
import json
from datetime import datetime
import torch
from speechbrain.inference.speaker import EncoderClassifier

# Configuration
CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
RECORD_SECONDS = 20
NUM_SAMPLES = 6
PROFILES_DIR = Path.home() / ".openclaw" / "voice-profiles"
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

# Reading passages — diverse speech patterns, varying sentence length and
# intonation so the embedding captures the speaker's full vocal range.
READING_PASSAGES = [
    {
        "label": "Narrative (calm, steady pace)",
        "text": (
            "Three keys. That was all Halliday had hidden inside the OASIS. "
            "Three keys that opened three gates. And whoever found them first "
            "would inherit his fortune. The whole world was searching, but "
            "nobody had found even the first key. Not in five long years."
        ),
    },
    {
        "label": "Conversational (casual, natural)",
        "text": (
            "So I was thinking we could grab dinner around seven, maybe "
            "try that new place on Fifth Street. I heard they have great "
            "tacos. Honestly though, I'm easy — whatever you feel like "
            "works for me. Just let me know before five so I can plan."
        ),
    },
    {
        "label": "Technical (deliberate, precise)",
        "text": (
            "The system uses a sixteen-kilohertz sample rate with single "
            "channel audio. Speaker embeddings are extracted using the "
            "ECAPA-TDNN architecture, producing a one-hundred-ninety-two "
            "dimensional vector. Cosine distance below zero point two five "
            "indicates a positive match."
        ),
    },
    {
        "label": "Energetic (expressive, varied pitch)",
        "text": (
            "No way! Are you serious? That's absolutely incredible — I "
            "can't believe it actually worked! We spent months on that "
            "problem and you just solved it in one afternoon? Okay, okay, "
            "tell me everything. Start from the beginning. Don't skip "
            "a single detail!"
        ),
    },
    {
        "label": "Reflective (slow, thoughtful)",
        "text": (
            "Looking back, I think the most important thing I learned was "
            "patience. Not everything has to happen right away. Sometimes "
            "the best ideas come when you stop trying so hard and just "
            "let your mind wander for a while. There's real value in "
            "slowing down."
        ),
    },
    {
        "label": "Instructional (clear, commanding)",
        "text": (
            "First, open the settings menu and scroll down to audio. "
            "Make sure the input device is set to your USB microphone, "
            "not the built-in one. Then adjust the gain until the meter "
            "stays in the green zone. Hit apply, close the window, and "
            "you should be good to go."
        ),
    },
    {
        "label": "Storytelling (warm, animated)",
        "text": (
            "There was this one time, back in college, when my roommate "
            "decided we absolutely had to build a treehouse. In the middle "
            "of December. With no tools. We ended up just duct-taping "
            "boards to a tree and sitting up there drinking hot chocolate. "
            "Best bad idea I ever said yes to."
        ),
    },
    {
        "label": "Freeform (just talk naturally)",
        "text": None,
    },
]

print("Loading speaker recognition model...")
classifier = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir=str(Path.home() / ".openclaw" / "models" / "spkrec")
)
print("Model loaded\n")


def record_sample(sample_num, passage):
    """Record a single audio sample, retrying if audio is silent."""
    while True:
        print(f"\n{'='*60}")
        print(f"  Sample {sample_num}/{NUM_SAMPLES}  —  {passage['label']}")
        print(f"  Recording length: {RECORD_SECONDS} seconds")
        print("="*60)

        if passage["text"]:
            print("\nRead this aloud:\n")
            # Word-wrap the passage for readability
            words = passage["text"].split()
            line = "  "
            for w in words:
                if len(line) + len(w) + 1 > 60:
                    print(line)
                    line = "  " + w
                else:
                    line += (" " if len(line) > 2 else "") + w
            if line.strip():
                print(line)
            print()
        else:
            print("\nJust talk naturally for 20 seconds.")
            print("Say whatever comes to mind — describe your")
            print("surroundings, what you had for lunch, anything.\n")

        input("Press Enter when ready to record...")

        p = pyaudio.PyAudio()
        stream = p.open(
            format=FORMAT, channels=CHANNELS, rate=RATE,
            input=True, frames_per_buffer=CHUNK
        )
        num_reads = int(RATE / CHUNK * RECORD_SECONDS)
        print("RECORDING...")
        frames = []
        for i in range(num_reads):
            frames.append(stream.read(CHUNK, exception_on_overflow=False))
            # Progress indicator every 5 seconds
            elapsed = (i + 1) * CHUNK / RATE
            if elapsed % 5 < CHUNK / RATE:
                remaining = RECORD_SECONDS - elapsed
                if remaining > 0:
                    print(f"  {elapsed:.0f}s recorded, {remaining:.0f}s remaining...")
        print("Recording complete!")
        stream.stop_stream()
        stream.close()
        p.terminate()

        # Validate audio isn't silence
        audio_data = np.frombuffer(b''.join(frames), dtype=np.int16).astype(np.float32)
        rms = np.sqrt(np.mean(audio_data ** 2))
        peak = np.max(np.abs(audio_data))
        print(f"  Audio level: RMS={rms:.0f}, peak={peak:.0f}")

        if rms < 50 or peak < 200:
            print("  Recording appears to be silence! Check your microphone.")
            print("  Retrying this sample...")
            continue

        return frames


def save_audio(frames, path):
    """Save audio frames to WAV file."""
    wf = wave.open(str(path), 'wb')
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(pyaudio.PyAudio().get_sample_size(FORMAT))
    wf.setframerate(RATE)
    wf.writeframes(b''.join(frames))
    wf.close()


def extract_embedding(audio_path):
    """Extract speaker embedding from audio file."""
    signal = classifier.load_audio(str(audio_path))
    with torch.no_grad():
        embedding = classifier.encode_batch(signal)
    embedding_list = embedding.squeeze().cpu().numpy().tolist()
    return embedding_list


def compute_self_consistency(embeddings):
    """Compute average pairwise cosine distance between embeddings."""
    n = len(embeddings)
    if n < 2:
        return 0.0
    distances = []
    for i in range(n):
        for j in range(i + 1, n):
            e1, e2 = np.array(embeddings[i]), np.array(embeddings[j])
            sim = np.dot(e1, e2) / (np.linalg.norm(e1) * np.linalg.norm(e2))
            distances.append(1 - sim)
    return float(np.mean(distances))


def enroll(name):
    """Enroll a speaker by recording samples and extracting embeddings."""
    print("="*60)
    print(f"  Speaker Enrollment: {name}")
    print("="*60)
    print(f"\n  Samples:    {NUM_SAMPLES} recordings")
    print(f"  Duration:   {RECORD_SECONDS} seconds each")
    print(f"  Total:      ~{NUM_SAMPLES * RECORD_SECONDS // 60} minutes of audio")
    print(f"\n  Each sample has a different reading passage to capture")
    print(f"  your natural vocal range. Speak at a comfortable volume")
    print(f"  and distance from the microphone.\n")

    # Show audio device info
    p = pyaudio.PyAudio()
    try:
        dev = p.get_default_input_device_info()
        print(f"  Microphone: {dev['name']}")
        print(f"  Rate:       {int(dev['defaultSampleRate'])} Hz\n")
    except Exception:
        print("  Microphone: (could not detect default device)\n")
    finally:
        p.terminate()

    input("Press Enter to begin enrollment...")

    speaker_dir = PROFILES_DIR / name
    speaker_dir.mkdir(exist_ok=True)

    samples, embeddings = [], []
    passages = READING_PASSAGES[:NUM_SAMPLES]

    for i, passage in enumerate(passages):
        frames = record_sample(i + 1, passage)
        audio_path = speaker_dir / f"sample-{i+1}.wav"
        save_audio(frames, audio_path)

        print(f"  Extracting embedding...")
        embedding = extract_embedding(audio_path)
        print(f"  Embedding: {len(embedding)} dimensions")

        samples.append(str(audio_path))
        embeddings.append(embedding)

        # Show running consistency after 2+ samples
        if len(embeddings) >= 2:
            consistency = compute_self_consistency(embeddings)
            print(f"  Self-consistency: {consistency:.3f} "
                  f"(lower = more consistent, target < 0.20)")

    # L2-normalize all embeddings before saving
    for i, emb in enumerate(embeddings):
        arr = np.array(emb)
        norm = np.linalg.norm(arr)
        if norm > 0:
            embeddings[i] = (arr / norm).tolist()

    # Final stats
    avg_dist = compute_self_consistency(embeddings)
    # Set threshold at 3x the self-consistency, clamped between 0.20 and 0.50
    threshold = max(0.20, min(0.50, avg_dist * 3))

    profile = {
        "name": name,
        "enrolledAt": datetime.utcnow().isoformat() + "Z",
        "numSamples": NUM_SAMPLES,
        "recordSeconds": RECORD_SECONDS,
        "embeddingDimensions": len(embeddings[0]),
        "embeddings": embeddings,
        "threshold": round(threshold, 3),
        "selfConsistency": round(avg_dist, 4),
        "samples": samples,
    }

    profile_path = PROFILES_DIR / f"{name}.json"
    with open(profile_path, 'w') as f:
        json.dump(profile, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  Enrollment Complete!")
    print(f"{'='*60}")
    print(f"  Profile:          {profile_path}")
    print(f"  Samples:          {NUM_SAMPLES} x {RECORD_SECONDS}s = "
          f"{NUM_SAMPLES * RECORD_SECONDS}s total audio")
    print(f"  Embeddings:       {NUM_SAMPLES} x {len(embeddings[0])} dimensions")
    print(f"  Self-consistency: {avg_dist:.4f}")
    print(f"  Threshold:        {threshold:.3f} (auto-computed)")
    print()
    print("  Restart the voice listener to pick up the new profile:")
    print("    launchctl kickstart -k gui/$(id -u)/ai.openclaw.voice-listener")
    print()


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2 or sys.argv[1].startswith("-"):
        print("Usage: python enroll_speaker.py <speaker_name>")
        print("Example: python enroll_speaker.py fred")
        sys.exit(1)
    enroll(sys.argv[1].lower())
