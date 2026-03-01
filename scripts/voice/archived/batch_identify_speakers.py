#!/usr/bin/env python3
"""
Nightly Batch Speaker Identification

Scans all existing transcripts in ~/oasis-audio/done/ and re-identifies
speakers using the current voice profile set. This catches:

  1. Files diarized before speaker ID was added to the pipeline
  2. Speakers who were unknown at diarize-time but have since been enrolled
  3. Files where speaker ID failed transiently

Uses the diarizer's /speaker-stats and voice profiles directly (no
SpeechBrain needed locally — calls the diarizer container's API or
runs standalone with local SpeechBrain if available).

Usage:
  # Via Docker (calls diarizer container API):
  python scripts/voice/batch_identify_speakers.py

  # Dry run (show what would change):
  python scripts/voice/batch_identify_speakers.py --dry-run

  # Limit to recent files:
  python scripts/voice/batch_identify_speakers.py --days 7

  # Also update curator transcripts after identification:
  python scripts/voice/batch_identify_speakers.py --sync-curator
"""

import os
import sys
import json
import wave
import struct
import argparse
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("batch-identify")

# --- Paths -------------------------------------------------------------------

AUDIO_DONE_DIR = Path(os.getenv("AUDIO_DONE_DIR", Path.home() / "oasis-audio" / "done"))
AUDIO_INBOX_DIR = Path(os.getenv("AUDIO_INBOX_DIR", Path.home() / "oasis-audio" / "inbox"))
PROFILES_DIR = Path(os.getenv("VOICE_PROFILES_DIR", Path.home() / ".openclaw" / "voice-profiles"))
UNKNOWN_SPEAKERS_DIR = Path(os.getenv("UNKNOWN_SPEAKERS_DIR", Path.home() / ".openclaw" / "unknown-speakers"))
CURATOR_DIR = Path.home() / ".openclaw" / "workspace-curator" / "transcripts" / "voice"

SUPPORTED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wma", ".aac", ".mp4", ".webm"}
MIN_SEGMENT_DURATION = 1.0

# --- Lazy-loaded SpeechBrain -------------------------------------------------

_classifier = None
_classifier_load_attempted = False


def _load_audio_wav(audio_path, start=None, end=None):
    """Load a WAV file as float32 numpy array."""
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


def _load_classifier():
    """Lazy-load SpeechBrain ECAPA-TDNN."""
    global _classifier, _classifier_load_attempted
    if _classifier is not None:
        return _classifier
    if _classifier_load_attempted:
        return None
    _classifier_load_attempted = True

    try:
        import torch
        import torchaudio

        if not hasattr(torchaudio, "list_audio_backends"):
            torchaudio.list_audio_backends = lambda: ["soundfile"]

        import huggingface_hub
        for fn_name in ("hf_hub_download", "snapshot_download", "cached_download"):
            orig_fn = getattr(huggingface_hub, fn_name, None)
            if orig_fn is None:
                continue
            def _make_patched(orig):
                def patched(*args, **kwargs):
                    kwargs.pop("use_auth_token", None)
                    return orig(*args, **kwargs)
                return patched
            setattr(huggingface_hub, fn_name, _make_patched(orig_fn))

        from speechbrain.inference.speaker import EncoderClassifier

        savedir = Path("/tmp/speechbrain-ecapa")
        savedir.mkdir(parents=True, exist_ok=True)
        custom_py = savedir / "custom.py"
        if not custom_py.exists():
            custom_py.write_text("")

        log.info("Loading SpeechBrain ECAPA-TDNN...")
        _classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=str(savedir),
            run_opts={"device": "cpu"},
        )
        log.info("Speaker encoder loaded.")
        return _classifier
    except Exception as e:
        log.error(f"Failed to load speaker encoder: {e}")
        return None


def extract_embedding(audio_path, start=None, end=None):
    """Extract 192-dim embedding from audio segment."""
    classifier = _load_classifier()
    if classifier is None:
        return None
    try:
        import torch
        audio, sr = _load_audio_wav(audio_path, start, end)
        if len(audio) < sr * MIN_SEGMENT_DURATION:
            return None
        audio_tensor = torch.tensor(audio).unsqueeze(0)
        with torch.no_grad():
            embedding = classifier.encode_batch(audio_tensor)
        return embedding.squeeze().cpu().numpy()
    except Exception as e:
        log.error(f"Embedding extraction failed: {e}")
        return None


# --- Profile Loading ---------------------------------------------------------

def load_profiles() -> Dict:
    """Load all voice profiles."""
    profiles = {}
    if not PROFILES_DIR.exists():
        return profiles

    for pf in PROFILES_DIR.glob("*.json"):
        try:
            data = json.loads(pf.read_text(encoding="utf-8"))
            name = data.get("name", pf.stem)
            embeddings = data.get("embeddings", [])
            threshold = data.get("threshold", 0.5)
            if embeddings:
                profiles[name] = {
                    "embeddings": [np.array(e) for e in embeddings],
                    "threshold": threshold,
                }
        except Exception as e:
            log.error(f"Failed to load profile {pf.name}: {e}")

    return profiles


def match_speaker(embedding, profiles) -> Tuple[Optional[str], float]:
    """Match embedding against profiles."""
    best_name = None
    best_dist = float("inf")

    for name, prof in profiles.items():
        for enrolled in prof["embeddings"]:
            sim = np.dot(embedding, enrolled) / (
                np.linalg.norm(embedding) * np.linalg.norm(enrolled)
            )
            dist = 1 - sim
            if dist < best_dist:
                best_dist = dist
                best_name = name

    threshold = profiles.get(best_name, {}).get("threshold", 0.5)
    if best_dist < threshold:
        return best_name, best_dist
    return None, best_dist


# --- Audio File Finder -------------------------------------------------------

def find_audio_file(audio_filename: str) -> Optional[Path]:
    """Find original audio file for a transcript."""
    candidate = AUDIO_INBOX_DIR / audio_filename
    if candidate.exists():
        return candidate

    stem = Path(audio_filename).stem
    if ".boosted" in stem:
        stem = stem.replace(".boosted", "")

    for ext in SUPPORTED_AUDIO_EXTENSIONS:
        candidate = AUDIO_INBOX_DIR / f"{stem}{ext}"
        if candidate.exists():
            return candidate

    return None


# --- Transcript Scanner ------------------------------------------------------

def find_unidentified_transcripts(days: Optional[int] = None) -> List[Path]:
    """Find transcripts with unidentified speakers (SPEAKER_XX without speaker_name)."""
    transcripts = []

    if not AUDIO_DONE_DIR.exists():
        log.error(f"Done directory not found: {AUDIO_DONE_DIR}")
        return transcripts

    cutoff = None
    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)

    for f in sorted(AUDIO_DONE_DIR.iterdir()):
        if not f.name.endswith(".json") or ".error." in f.name:
            continue
        if f.name.startswith("."):
            continue

        # Check age filter
        if cutoff and datetime.utcfromtimestamp(f.stat().st_mtime) < cutoff:
            continue

        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue

        # Skip if not diarized
        if not data.get("diarization"):
            continue

        # Check if any speaker is still unidentified
        has_unidentified = False
        for seg in data.get("segments", []):
            spk = seg.get("speaker")
            if spk and spk.startswith("SPEAKER_") and not seg.get("speaker_name"):
                has_unidentified = True
                break

        if has_unidentified:
            transcripts.append(f)

    return transcripts


def identify_transcript(transcript_path: Path, profiles: Dict, dry_run: bool = False) -> Dict:
    """Re-identify speakers in a single transcript."""
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    segments = data.get("segments", [])

    # Find original audio
    audio_filename = data.get("file", "")
    if not audio_filename:
        return {"skipped": True, "reason": "no audio filename"}

    audio_path = find_audio_file(audio_filename)
    if not audio_path:
        return {"skipped": True, "reason": f"audio not found: {audio_filename}"}

    # Group segments by speaker
    speaker_segments: Dict[str, List[dict]] = {}
    for seg in segments:
        spk = seg.get("speaker")
        if not spk or not spk.startswith("SPEAKER_"):
            continue
        if seg.get("speaker_name"):
            continue  # Already identified
        if spk not in speaker_segments:
            speaker_segments[spk] = []
        speaker_segments[spk].append(seg)

    if not speaker_segments:
        return {"skipped": True, "reason": "no unidentified speakers"}

    identified = {}
    for spk_label, segs in speaker_segments.items():
        ranges = [(s.get("start", 0), s.get("end", 0)) for s in segs]
        total_duration = sum(e - s for s, e in ranges if e > s)
        if total_duration < MIN_SEGMENT_DURATION:
            continue

        longest = max(ranges, key=lambda r: r[1] - r[0])
        embedding = extract_embedding(str(audio_path), longest[0], longest[1])
        if embedding is None:
            continue

        name, dist = match_speaker(embedding, profiles)
        if name:
            identified[spk_label] = {"name": name, "distance": round(dist, 4)}

    if not identified:
        return {"identified": 0, "speakers_checked": len(speaker_segments)}

    if dry_run:
        return {"identified": len(identified), "matches": identified, "dry_run": True}

    # Apply identifications
    for seg in segments:
        spk = seg.get("speaker")
        if spk and spk in identified:
            seg["speaker_name"] = identified[spk]["name"]

    # Update speaker_identification metadata
    existing_id = data.get("speaker_identification", {})
    existing_identified = existing_id.get("identified", {})
    existing_identified.update({k: v["name"] for k, v in identified.items()})

    data["speaker_identification"] = {
        "identified": existing_identified,
        "unidentified": [
            spk for spk in speaker_segments if spk not in identified and spk not in existing_identified
        ],
        "profiles_checked": len(profiles),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "batch_retag": True,
    }

    # Atomic write
    tmp_path = transcript_path.with_name(f".tmp_{transcript_path.name}")
    tmp_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp_path.rename(transcript_path)

    # Remove .synced marker so sync-transcripts.py picks up the update
    synced_marker = transcript_path.with_suffix(transcript_path.suffix + ".synced")
    if synced_marker.exists():
        synced_marker.unlink()

    return {"identified": len(identified), "matches": identified}


def sync_curator_transcripts():
    """Trigger sync-transcripts.py to update curator copies."""
    sync_script = Path(__file__).parent / "sync-transcripts.py"
    if sync_script.exists():
        log.info("Triggering curator transcript sync...")
        os.system(f"python3 {sync_script} --force")
    else:
        log.warning(f"Sync script not found: {sync_script}")


# --- Main --------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Batch retroactive speaker identification for all transcripts"
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would change without modifying files")
    parser.add_argument("--days", type=int, default=None,
                        help="Only process transcripts from the last N days")
    parser.add_argument("--sync-curator", action="store_true",
                        help="Trigger curator transcript sync after identification")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Show detailed output for each file")

    args = parser.parse_args()

    # Load profiles
    profiles = load_profiles()
    if not profiles:
        log.error("No voice profiles found. Enroll speakers first.")
        sys.exit(1)
    log.info(f"Loaded {len(profiles)} voice profile(s): {', '.join(profiles.keys())}")

    # Find unidentified transcripts
    transcripts = find_unidentified_transcripts(days=args.days)
    log.info(f"Found {len(transcripts)} transcript(s) with unidentified speakers")

    if not transcripts:
        log.info("Nothing to do.")
        return

    # Process each transcript
    total_identified = 0
    total_updated = 0
    total_skipped = 0

    for tp in transcripts:
        try:
            result = identify_transcript(tp, profiles, dry_run=args.dry_run)

            if result.get("skipped"):
                total_skipped += 1
                if args.verbose:
                    log.info(f"  SKIP {tp.name}: {result['reason']}")
            elif result.get("identified", 0) > 0:
                total_updated += 1
                total_identified += result["identified"]
                matches = result.get("matches", {})
                match_str = ", ".join(f"{k}->{v['name']}" for k, v in matches.items())
                prefix = "[DRY] " if args.dry_run else ""
                log.info(f"  {prefix}{tp.name}: {match_str}")
            else:
                if args.verbose:
                    log.info(f"  NO MATCH {tp.name}: checked {result.get('speakers_checked', 0)} speakers")

        except Exception as e:
            log.error(f"  ERROR {tp.name}: {e}")

    # Summary
    action = "Would update" if args.dry_run else "Updated"
    log.info(f"\n{action} {total_updated} transcript(s), identified {total_identified} speaker(s), skipped {total_skipped}")

    # Sync curator if requested
    if args.sync_curator and not args.dry_run and total_updated > 0:
        sync_curator_transcripts()


if __name__ == "__main__":
    main()
