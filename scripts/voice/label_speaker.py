#!/usr/bin/env python3
"""Label a speaker in a transcript and build/update their voice profile.

Given a transcript file, a speaker ID (e.g. SPEAKER_00), and a name,
this script:
  1. Updates the transcript JSON with speaker_name on matching segments
  2. Extracts ECAPA-TDNN embeddings from the speaker's audio segments
  3. Creates or updates the speaker's voice profile with new embeddings
  4. Re-syncs the transcript to the curator/dashboard directory

Usage:
    python3 label_speaker.py <transcript_json> <speaker_id> <name> [--profiles-dir DIR]
"""

import argparse
import json
import os
import sys
import wave
import struct
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("label-speaker")

DEFAULT_PROFILES_DIR = os.getenv(
    "VOICE_PROFILES_DIR",
    str(Path.home() / ".openclaw" / "voice-profiles"),
)
DEFAULT_AUDIO_DIR = os.getenv(
    "AUDIO_DIR",
    str(Path.home() / "oasis-audio" / "inbox"),
)
DONE_DIR = Path.home() / "oasis-audio" / "done"
CURATOR_VOICE_DIR = (
    Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"
)
MIN_SEGMENT_DURATION = 1.0  # seconds


def load_audio_wav(audio_path, start=None, end=None):
    """Load a WAV file as a float32 numpy array, optionally slicing by time."""
    import numpy as np

    with wave.open(str(audio_path), "rb") as wf:
        sr = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        n_frames = wf.getnframes()

        start_frame = int((start or 0) * sr)
        end_frame = int(end * sr) if end else n_frames
        start_frame = max(0, min(start_frame, n_frames))
        end_frame = max(start_frame, min(end_frame, n_frames))

        wf.setpos(start_frame)
        raw = wf.readframes(end_frame - start_frame)

    if sampwidth == 2:
        fmt = f"<{len(raw) // 2}h"
        samples = struct.unpack(fmt, raw)
        audio = np.array(samples, dtype=np.float32) / 32768.0
    elif sampwidth == 4:
        fmt = f"<{len(raw) // 4}i"
        samples = struct.unpack(fmt, raw)
        audio = np.array(samples, dtype=np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width: {sampwidth}")

    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1)

    return audio, sr


def extract_embedding(classifier, audio_path, start=None, end=None):
    """Extract a 192-dim speaker embedding from an audio segment."""
    import torch
    import numpy as np

    audio, sr = load_audio_wav(audio_path, start, end)

    if len(audio) < sr * MIN_SEGMENT_DURATION:
        return None

    audio_tensor = torch.tensor(audio).unsqueeze(0)
    with torch.no_grad():
        embedding = classifier.encode_batch(audio_tensor)
    return embedding.squeeze().cpu().numpy()


def load_classifier():
    """Load SpeechBrain ECAPA-TDNN classifier with compatibility patches."""
    import torchaudio

    if not hasattr(torchaudio, "list_audio_backends"):
        torchaudio.list_audio_backends = lambda: ["soundfile"]

    import huggingface_hub

    for fn_name in ("hf_hub_download", "snapshot_download", "cached_download"):
        orig_fn = getattr(huggingface_hub, fn_name, None)
        if orig_fn is None:
            continue

        def make_patched(orig):
            def patched(*args, **kwargs):
                kwargs.pop("use_auth_token", None)
                return orig(*args, **kwargs)

            return patched

        setattr(huggingface_hub, fn_name, make_patched(orig_fn))

    from speechbrain.inference.speaker import EncoderClassifier

    savedir = Path("/tmp/speechbrain-ecapa")
    savedir.mkdir(parents=True, exist_ok=True)
    custom_py = savedir / "custom.py"
    if not custom_py.exists():
        custom_py.write_text("")

    log.info("Loading SpeechBrain ECAPA-TDNN speaker encoder...")
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(savedir),
        run_opts={"device": "cpu"},
    )
    log.info("Speaker encoder loaded.")
    return classifier


def update_profile(profiles_dir, name, new_embeddings):
    """Create or update a speaker voice profile with new embeddings.

    Returns the profile data dict.
    """
    import numpy as np

    # Import shared utilities from speaker_verify
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "audio-listener"))
        from speaker_verify import (
            deduplicate_embeddings,
            compute_self_consistency,
            auto_threshold,
        )
    except ImportError:
        # Fallback to local implementations if speaker_verify not available
        deduplicate_embeddings = _deduplicate_embeddings_fallback
        compute_self_consistency = _compute_self_consistency_fallback
        auto_threshold = _auto_threshold_fallback

    profiles_path = Path(profiles_dir)
    profiles_path.mkdir(parents=True, exist_ok=True)
    profile_file = profiles_path / f"{name.lower()}.json"

    if profile_file.exists():
        profile = json.loads(profile_file.read_text(encoding="utf-8"))
        existing_embeddings = [np.array(e) for e in profile.get("embeddings", [])]
        log.info(
            f"Updating profile '{name}': {len(existing_embeddings)} existing + {len(new_embeddings)} new embeddings"
        )
    else:
        profile = {
            "name": name.lower(),
            "enrolledAt": datetime.utcnow().isoformat() + "Z",
            "enrollmentMethod": "manual-label",
            "numSamples": 0,
            "embeddingDimensions": 192,
            "embeddings": [],
            "threshold": 0.35,
            "selfConsistency": None,
        }
        existing_embeddings = []
        log.info(f"Creating new profile '{name}' from labeled audio")

    # Merge embeddings (deduplicate by cosine similarity)
    all_embeddings = existing_embeddings + new_embeddings
    merged = deduplicate_embeddings(all_embeddings, threshold=0.05)

    # Compute self-consistency and auto-calibrate threshold
    consistency = compute_self_consistency(merged)
    if consistency is not None:
        profile["selfConsistency"] = round(consistency, 4)
        profile["threshold"] = auto_threshold(consistency)

    profile["embeddings"] = [e.tolist() for e in merged]
    profile["numSamples"] = len(merged)
    profile["lastUpdated"] = datetime.utcnow().isoformat() + "Z"

    # Atomic write
    tmp = profile_file.with_name(f".tmp_{profile_file.name}")
    tmp.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    tmp.rename(profile_file)

    log.info(
        f"Profile '{name}': {len(merged)} total embeddings, threshold={profile['threshold']}"
    )
    return profile


# --- Fallback implementations (used when speaker_verify is not importable) ---

def _deduplicate_embeddings_fallback(embeddings, threshold=0.05):
    """Remove near-duplicate embeddings (cosine distance < threshold)."""
    import numpy as np

    if len(embeddings) <= 1:
        return embeddings

    unique = [embeddings[0]]
    for emb in embeddings[1:]:
        is_dup = False
        for existing in unique:
            sim = np.dot(emb, existing) / (
                np.linalg.norm(emb) * np.linalg.norm(existing)
            )
            if 1 - sim < threshold:
                is_dup = True
                break
        if not is_dup:
            unique.append(emb)

    if len(unique) < len(embeddings):
        log.info(
            f"Deduplicated: {len(embeddings)} -> {len(unique)} embeddings"
        )
    return unique


def _compute_self_consistency_fallback(embeddings):
    """Compute average pairwise cosine distance across embeddings."""
    import numpy as np

    if len(embeddings) < 2:
        return None

    dists = []
    for i in range(len(embeddings)):
        for j in range(i + 1, len(embeddings)):
            sim = np.dot(embeddings[i], embeddings[j]) / (
                np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[j])
            )
            dists.append(1 - sim)
    return float(np.mean(dists))


def _auto_threshold_fallback(consistency):
    """Compute speaker match threshold from self-consistency."""
    if consistency is None:
        return 0.35
    return round(max(0.20, min(0.50, consistency * 3)), 2)


def resync_transcript(transcript_path):
    """Remove .synced marker so sync-transcripts.py re-processes it."""
    src = Path(transcript_path)
    marker = src.with_name(src.name + ".synced")
    if marker.exists():
        marker.unlink()
        log.info(f"Removed .synced marker for re-sync: {src.name}")


def main():
    parser = argparse.ArgumentParser(
        description="Label a speaker in a transcript and build/update their voice profile"
    )
    parser.add_argument("transcript", help="Path to the WhisperX transcript JSON")
    parser.add_argument("speaker_id", help="Speaker ID to label (e.g. SPEAKER_00)")
    parser.add_argument("name", help="Name to assign to this speaker")
    parser.add_argument(
        "--profiles-dir",
        default=DEFAULT_PROFILES_DIR,
        help="Voice profiles directory",
    )
    parser.add_argument(
        "--audio-dir",
        default=DEFAULT_AUDIO_DIR,
        help="Audio files directory",
    )
    parser.add_argument(
        "--skip-profile",
        action="store_true",
        help="Only update transcript labels, don't extract embeddings",
    )
    args = parser.parse_args()

    transcript_path = Path(args.transcript)
    if not transcript_path.exists():
        # Try resolving relative to done dir
        alt = DONE_DIR / args.transcript
        if alt.exists():
            transcript_path = alt
        else:
            log.error(f"Transcript not found: {args.transcript}")
            sys.exit(1)

    # Load transcript
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    segments = data.get("segments", [])
    if not segments:
        log.error("Transcript has no segments")
        sys.exit(1)

    # Find segments for the target speaker
    speaker_segs = [s for s in segments if s.get("speaker") == args.speaker_id]
    if not speaker_segs:
        log.error(f"No segments found for speaker '{args.speaker_id}'")
        sys.exit(1)

    log.info(
        f"Found {len(speaker_segs)} segments for {args.speaker_id} in {transcript_path.name}"
    )

    # Update transcript with speaker name
    name_lower = args.name.lower()
    for seg in segments:
        if seg.get("speaker") == args.speaker_id:
            seg["speaker_name"] = name_lower

    # Update speaker_identification metadata
    if "speaker_identification" not in data:
        data["speaker_identification"] = {
            "identified": {},
            "unidentified": [],
            "profiles_checked": 0,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    data["speaker_identification"]["identified"][args.speaker_id] = {
        "name": name_lower,
        "method": "manual-label",
    }
    # Remove from unidentified list
    unid = data["speaker_identification"].get("unidentified", [])
    data["speaker_identification"]["unidentified"] = [
        s for s in unid if s != args.speaker_id
    ]
    data["speaker_identification"]["labeled_manually"] = True

    # Write updated transcript
    tmp = transcript_path.with_name(f".tmp_{transcript_path.name}")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.rename(transcript_path)
    log.info(f"Updated transcript: {args.speaker_id} -> {name_lower}")

    # Trigger re-sync to dashboard
    resync_transcript(transcript_path)

    # Extract embeddings and update profile
    if not args.skip_profile:
        audio_filename = data.get("file", "")
        if not audio_filename:
            log.warning("No audio file reference in transcript, skipping profile update")
            sys.exit(0)

        audio_path = Path(args.audio_dir) / audio_filename
        if not audio_path.exists():
            # Try done dir
            audio_path = DONE_DIR / audio_filename
        if not audio_path.exists():
            log.warning(
                f"Audio file not found: {audio_filename} — skipping profile update"
            )
            print(json.dumps({"ok": True, "labeled": True, "profile_updated": False}))
            sys.exit(0)

        classifier = load_classifier()
        new_embeddings = []

        for seg in speaker_segs:
            start = seg.get("start", 0)
            end = seg.get("end", 0)
            duration = end - start
            if duration < MIN_SEGMENT_DURATION:
                continue

            emb = extract_embedding(classifier, str(audio_path), start, end)
            if emb is not None:
                new_embeddings.append(emb)

        if new_embeddings:
            profile = update_profile(args.profiles_dir, name_lower, new_embeddings)
            log.info(
                f"Profile updated: {name_lower} now has {profile['numSamples']} embeddings"
            )
            print(
                json.dumps(
                    {
                        "ok": True,
                        "labeled": True,
                        "profile_updated": True,
                        "embeddings_added": len(new_embeddings),
                        "total_embeddings": profile["numSamples"],
                    }
                )
            )
        else:
            log.warning("No usable embeddings extracted from speaker segments")
            print(
                json.dumps({"ok": True, "labeled": True, "profile_updated": False})
            )
    else:
        print(json.dumps({"ok": True, "labeled": True, "profile_updated": False}))


if __name__ == "__main__":
    main()
