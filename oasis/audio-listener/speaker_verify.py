"""
Speaker Verification & Identification for Audio Listener

Two roles:
  1. **Verification** (voice command gate): Only enrolled speakers can
     issue voice commands to agents. Uses SpeechBrain ECAPA-TDNN.
  2. **Identification** (post-transcription): Maps AssemblyAI's generic
     speaker labels (SPEAKER_00, SPEAKER_01) to enrolled names. Tracks
     unknown speakers via UnknownSpeakerTracker for candidate review.

Voice profiles are JSON files with pre-computed 192-dim embeddings
(same format as scripts/voice/enroll_speaker.py produces).

NOTE: Audio is loaded manually via the wave module to avoid
torchaudio backend compatibility issues (torchaudio 2.10 removed
list_audio_backends which SpeechBrain 1.0.3 depends on).
"""

import os
import json
import wave
import struct
import hashlib
import logging
import threading
import time as _time
import numpy as np
from pathlib import Path
from datetime import datetime

log = logging.getLogger("audio-listener.speaker-verify")

PROFILES_DIR = os.getenv("VOICE_PROFILES_DIR", "/voice-profiles")
UNKNOWN_SPEAKERS_DIR = os.getenv("UNKNOWN_SPEAKERS_DIR", "/unknown-speakers")
VERIFY_SPEAKER = os.getenv("VERIFY_SPEAKER", "true").lower() == "true"
SPEAKER_ID_ENABLED = os.getenv("SPEAKER_ID_ENABLED", "true").lower() == "true"
MIN_SEGMENT_DURATION = 1.0  # Minimum seconds of audio to extract an embedding

# Lazy-loaded globals
_classifier = None
_classifier_last_attempt = 0
_classifier_retry_interval = int(os.getenv("SPEAKER_ENCODER_RETRY_SECONDS", "300"))
_classifier_lock = threading.Lock()
_profiles = {}
_profiles_mtime = {}  # Track file modification times for hot-reloading
_loaded = False


def _load_audio_wav(audio_path, start=None, end=None):
    """Load a WAV file as a float32 numpy array, optionally slicing by time.

    Returns audio normalized to [-1, 1] at the file's native sample rate.
    """
    with wave.open(str(audio_path), "rb") as wf:
        sr = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        n_frames = wf.getnframes()

        # Calculate frame offsets for time slicing
        start_frame = int((start or 0) * sr)
        end_frame = int(end * sr) if end else n_frames
        start_frame = max(0, min(start_frame, n_frames))
        end_frame = max(start_frame, min(end_frame, n_frames))

        wf.setpos(start_frame)
        raw = wf.readframes(end_frame - start_frame)

    # Convert to float32
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

    # Convert to mono if stereo
    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1)

    return audio, sr


def _load_classifier():
    """Lazy-load the SpeechBrain ECAPA-TDNN classifier (heavy import).

    Patches torchaudio compatibility if needed before importing SpeechBrain.
    Retries periodically if loading fails (every _classifier_retry_interval seconds).
    """
    global _classifier, _classifier_last_attempt

    if _classifier is not None:
        return _classifier

    now = _time.time()
    if _classifier_last_attempt > 0 and (now - _classifier_last_attempt) < _classifier_retry_interval:
        return None  # Too soon since last failure, skip

    with _classifier_lock:
        # Double-check after acquiring lock
        if _classifier is not None:
            return _classifier
        if _classifier_last_attempt > 0 and (_time.time() - _classifier_last_attempt) < _classifier_retry_interval:
            return None

        _classifier_last_attempt = _time.time()

        try:
            import torch
            import torchaudio

            # Patch missing torchaudio.list_audio_backends for SpeechBrain compat
            if not hasattr(torchaudio, "list_audio_backends"):
                torchaudio.list_audio_backends = lambda: ["soundfile"]
                log.info("Patched torchaudio.list_audio_backends for SpeechBrain compat")

            # Patch huggingface_hub: SpeechBrain passes deprecated 'use_auth_token'
            # which was removed in huggingface_hub >= 1.0
            import huggingface_hub
            for _fn_name in ("hf_hub_download", "snapshot_download", "cached_download"):
                _orig_fn = getattr(huggingface_hub, _fn_name, None)
                if _orig_fn is None:
                    continue
                def _make_patched(orig):
                    def patched(*args, **kwargs):
                        kwargs.pop("use_auth_token", None)
                        return orig(*args, **kwargs)
                    return patched
                setattr(huggingface_hub, _fn_name, _make_patched(_orig_fn))
            log.info("Patched huggingface_hub for SpeechBrain compat (stripped use_auth_token)")

            from speechbrain.inference.speaker import EncoderClassifier

            # Pre-create savedir with empty custom.py to prevent SpeechBrain
            # from trying to fetch it (doesn't exist in model repo -> 404).
            _savedir = Path("/tmp/speechbrain-ecapa")
            _savedir.mkdir(parents=True, exist_ok=True)
            _custom_py = _savedir / "custom.py"
            if not _custom_py.exists():
                _custom_py.write_text("")

            log.info("Loading SpeechBrain ECAPA-TDNN speaker encoder...")
            _classifier = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=str(_savedir),
                run_opts={"device": "cpu"},
            )
            _classifier_last_attempt = 0  # Reset on success
            log.info("Speaker encoder loaded successfully.")
            return _classifier
        except Exception as e:
            log.error(f"Failed to load speaker encoder (will retry in {_classifier_retry_interval}s): {e}")
            return None


def _load_profiles(force_reload=False):
    """Load all speaker profiles from the profiles directory.

    Supports hot-reloading: re-reads profiles when files change on disk.
    """
    global _profiles, _loaded, _profiles_mtime

    profiles_dir = Path(PROFILES_DIR)
    if not profiles_dir.exists():
        log.warning(f"Voice profiles directory not found: {PROFILES_DIR}")
        _loaded = True
        return _profiles

    # Check for file changes (hot-reload)
    current_files = {}
    for pf in profiles_dir.glob("*.json"):
        current_files[pf.name] = pf.stat().st_mtime

    if _loaded and not force_reload and current_files == _profiles_mtime:
        return _profiles

    # Reload all profiles
    _profiles = {}
    _profiles_mtime = current_files

    for profile_file in profiles_dir.glob("*.json"):
        try:
            data = json.loads(profile_file.read_text(encoding="utf-8"))
            name = data.get("name", profile_file.stem)
            embeddings = data.get("embeddings", [])
            threshold = data.get("threshold", 0.5)

            if not embeddings:
                log.warning(f"Profile {name}: no embeddings, skipping")
                continue

            # Validate and auto-normalize embeddings
            np_embeddings = [np.array(e) for e in embeddings]
            for i, emb in enumerate(np_embeddings):
                norm = float(np.linalg.norm(emb))
                if norm < 0.9 or norm > 1.1:
                    log.warning(f"Profile '{name}': embedding {i} has norm {norm:.2f}, auto-normalizing")
                    np_embeddings[i] = emb / norm

            _profiles[name] = {
                "embeddings": np_embeddings,
                "threshold": threshold,
            }
            log.info(
                f"Loaded voice profile: {name} "
                f"({len(embeddings)} embeddings, threshold={threshold})"
            )
        except Exception as e:
            log.error(f"Failed to load profile {profile_file.name}: {e}")

    _loaded = True
    if not _profiles:
        log.warning("No speaker profiles loaded -- all commands will be BLOCKED")
    else:
        log.info(f"Speaker verification ready: {len(_profiles)} profile(s) loaded")
    return _profiles


def extract_embedding(audio_path, start=None, end=None):
    """Extract a 192-dim speaker embedding from an audio file (or segment).

    Args:
        audio_path: Path to the WAV file.
        start: Start time in seconds (None = beginning).
        end: End time in seconds (None = end of file).

    Returns:
        numpy array of shape (192,) or None on failure.
    """
    classifier = _load_classifier()
    if classifier is None:
        return None

    try:
        import torch

        audio, sr = _load_audio_wav(audio_path, start, end)

        if len(audio) < sr:  # Less than 1 second
            return None

        audio_tensor = torch.tensor(audio).unsqueeze(0)
        with torch.no_grad():
            embedding = classifier.encode_batch(audio_tensor)
        return embedding.squeeze().cpu().numpy()
    except Exception as e:
        log.error(f"Embedding extraction failed: {e}")
        return None


def extract_multi_segment_embedding(audio_path, ranges, max_segments=3,
                                     min_duration=1.0):
    """Extract embeddings from multiple segments and return the averaged result.

    Uses the top N longest segments (minimum `min_duration` seconds each),
    extracts an embedding from each, and returns the L2-normalized mean.
    Falls back to a single embedding if only one segment qualifies.

    Args:
        audio_path: Path to the WAV file.
        ranges: List of (start, end) time tuples in seconds.
        max_segments: Maximum number of segments to use (default 3).
        min_duration: Minimum segment duration in seconds (default 1.0).

    Returns:
        numpy array of shape (192,) or None on failure.
    """
    # Filter to segments with sufficient duration
    valid = [(s, e) for s, e in ranges if (e - s) >= min_duration]
    if not valid:
        return None

    # Sort by duration descending, take top N
    valid.sort(key=lambda r: r[1] - r[0], reverse=True)
    candidates = valid[:max_segments]

    embeddings = []
    for start, end in candidates:
        emb = extract_embedding(audio_path, start, end)
        if emb is not None:
            embeddings.append(emb)

    if not embeddings:
        return None

    if len(embeddings) == 1:
        return embeddings[0]

    # Average the embeddings and L2-normalize for consistent cosine distance
    avg = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg = avg / norm
    return avg


def match_speaker(embedding):
    """Match an embedding against enrolled profiles.

    Returns:
        (speaker_name, distance) if matched, (None, best_distance) if no match.
    """
    profiles = _load_profiles()
    if not profiles:
        return None, float("inf")

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


def verify_speaker_from_file(audio_path, segments=None):
    """Verify the speaker of an audio file against enrolled profiles.

    If segments with start/end times are provided, extracts embeddings
    per-speaker (grouped by diarization label). Otherwise uses the
    whole file as a single speaker.

    Args:
        audio_path: Path to the WAV file.
        segments: List of transcript segment dicts with optional 'speaker',
                  'start', 'end' fields.

    Returns:
        set of verified speaker names found in the audio.
        Empty set means no enrolled speakers detected.
    """
    if not VERIFY_SPEAKER:
        # Verification disabled -- allow all
        return {"*"}

    profiles = _load_profiles()
    if not profiles:
        log.warning("No profiles loaded -- blocking all voice commands")
        return set()

    classifier = _load_classifier()
    if classifier is None:
        log.error("Speaker encoder unavailable -- blocking all voice commands")
        return set()

    verified = set()

    # If we have diarized segments, group by speaker label and verify each
    if segments:
        speaker_segments = {}
        for seg in segments:
            spk = seg.get("speaker", "SPEAKER_00")
            if spk not in speaker_segments:
                speaker_segments[spk] = []
            speaker_segments[spk].append(seg)

        for spk_label, segs in speaker_segments.items():
            # Collect time ranges for this speaker
            ranges = [(s.get("start", 0), s.get("end", 0)) for s in segs]
            total_duration = sum(e - s for s, e in ranges)
            if total_duration < 1.0:
                continue

            # Use multiple segments for more robust embedding quality
            embedding = extract_multi_segment_embedding(
                audio_path, ranges, max_segments=3
            )
            if embedding is None:
                continue

            name, dist = match_speaker(embedding)
            if name:
                log.info(
                    f"Speaker verified: {spk_label} -> {name} (dist={dist:.3f})"
                )
                verified.add(name)
                # Tag the segments with the verified name
                for seg in segs:
                    seg["speaker_name"] = name
            else:
                log.info(
                    f"Speaker NOT verified: {spk_label} (best dist={dist:.3f})"
                )
    else:
        # No diarization -- verify the whole file as one speaker
        embedding = extract_embedding(audio_path)
        if embedding is not None:
            name, dist = match_speaker(embedding)
            if name:
                log.info(f"Speaker verified (whole file): {name} (dist={dist:.3f})")
                verified.add(name)
            else:
                log.info(f"Speaker NOT verified (whole file, best dist={dist:.3f})")

    return verified


def is_verification_enabled():
    """Check if speaker verification is enabled and properly configured."""
    if not VERIFY_SPEAKER:
        return False
    profiles = _load_profiles()
    return len(profiles) > 0


# --- Profile Utilities (shared with label_speaker.py and app.py) -------------

def deduplicate_embeddings(embeddings, threshold=0.05):
    """Remove near-duplicate embeddings (cosine distance < threshold).

    Args:
        embeddings: List of numpy arrays (192-dim each).
        threshold: Cosine distance below which two embeddings are duplicates.

    Returns:
        Deduplicated list of numpy arrays.
    """
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
        log.info(f"Deduplicated: {len(embeddings)} -> {len(unique)} embeddings")
    return unique


def compute_self_consistency(embeddings):
    """Compute average pairwise cosine distance across embeddings.

    Lower values mean the embeddings are more self-consistent (same voice).

    Args:
        embeddings: List of numpy arrays (192-dim each). Needs >= 2.

    Returns:
        Float mean distance, or None if fewer than 2 embeddings.
    """
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


def auto_threshold(consistency):
    """Compute a speaker match threshold from self-consistency.

    Uses 3x the self-consistency, clamped to [0.20, 0.50].

    Args:
        consistency: Self-consistency value from compute_self_consistency().

    Returns:
        Float threshold value.
    """
    if consistency is None:
        return 0.35  # Default when not enough samples
    return round(max(0.20, min(0.50, consistency * 3)), 2)


# --- Unknown Speaker Tracking ------------------------------------------------

class UnknownSpeakerTracker:
    """Track embeddings for unknown speakers to build candidate profiles.

    Accumulates samples in /unknown-speakers/embeddings/{speaker_id}/
    and creates candidate profiles in /unknown-speakers/candidates/
    once 10+ samples are collected.
    """

    def __init__(self):
        self.min_samples = 10
        self.base_dir = Path(UNKNOWN_SPEAKERS_DIR)
        self.embeddings_dir = self.base_dir / "embeddings"
        self.candidates_dir = self.base_dir / "candidates"

        self.embeddings_dir.mkdir(parents=True, exist_ok=True)
        self.candidates_dir.mkdir(parents=True, exist_ok=True)

    def add_sample(self, speaker_id, embedding, transcript="",
                   source_file="", timestamp=""):
        """Add an embedding sample for an unknown speaker."""
        speaker_dir = self.embeddings_dir / speaker_id
        speaker_dir.mkdir(exist_ok=True)

        sample_id = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")

        np.save(speaker_dir / f"{sample_id}.npy", embedding)

        meta = {
            "timestamp": timestamp or datetime.utcnow().isoformat() + "Z",
            "transcript": transcript,
            "source_file": source_file,
            "speaker_id": speaker_id,
        }
        (speaker_dir / f"{sample_id}.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )

        self._check_candidate(speaker_id)

    def _check_candidate(self, speaker_id):
        """Create a candidate profile once enough samples are collected.

        Validates cluster quality: rejects clusters with high variance
        or poor self-consistency (likely mixed speakers).
        """
        speaker_dir = self.embeddings_dir / speaker_id
        embedding_files = list(speaker_dir.glob("*.npy"))

        if len(embedding_files) < self.min_samples:
            return

        candidate_file = self.candidates_dir / f"{speaker_id}.json"
        if candidate_file.exists():
            return

        embeddings = [np.load(f) for f in embedding_files]
        variance = float(np.var(embeddings, axis=0).mean())

        # Quality gate: reject noisy clusters
        max_variance = float(os.getenv("UNKNOWN_SPEAKER_MAX_VARIANCE", "20.0"))
        if variance > max_variance:
            log.warning(f"Candidate {speaker_id} rejected: variance {variance:.2f} "
                        f"> max {max_variance:.1f} (likely mixed speakers)")
            return

        # Compute self-consistency (pairwise cosine distances)
        self_consistency = compute_self_consistency(embeddings)
        if self_consistency is not None and self_consistency > 0.15:
            log.warning(f"Candidate {speaker_id} rejected: self-consistency {self_consistency:.4f} "
                        f"> 0.15 (embeddings too dissimilar)")
            return

        # L2-normalize the average embedding for proper cosine matching
        avg_embedding = np.mean(embeddings, axis=0)
        norm = np.linalg.norm(avg_embedding)
        if norm > 0:
            avg_embedding = avg_embedding / norm

        # Auto-calibrate threshold
        threshold = auto_threshold(self_consistency) if self_consistency is not None else 0.25

        meta_list = []
        for ef in embedding_files:
            mf = ef.with_suffix(".json")
            if mf.exists():
                meta_list.append(json.loads(mf.read_text(encoding="utf-8")))

        candidate = {
            "speaker_id": speaker_id,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "num_samples": len(embeddings),
            "avg_embedding": avg_embedding.tolist(),
            "variance": variance,
            "self_consistency": round(self_consistency, 4) if self_consistency is not None else None,
            "auto_threshold": threshold,
            "sample_metadata": meta_list,
            "status": "pending_review",
            "suggested_name": None,
        }

        candidate_file.write_text(
            json.dumps(candidate, indent=2), encoding="utf-8"
        )
        log.info(f"New candidate speaker profile: {speaker_id} "
                 f"({len(embeddings)} samples, variance={variance:.4f}, "
                 f"consistency={self_consistency:.4f}, threshold={threshold})")

    def get_stats(self):
        """Get stats on tracked unknown speakers and candidates."""
        tracked = 0
        total_samples = 0
        pending_candidates = 0

        if self.embeddings_dir.exists():
            for speaker_dir in self.embeddings_dir.iterdir():
                if speaker_dir.is_dir():
                    tracked += 1
                    total_samples += len(list(speaker_dir.glob("*.npy")))

        if self.candidates_dir.exists():
            for cf in self.candidates_dir.glob("*.json"):
                try:
                    data = json.loads(cf.read_text(encoding="utf-8"))
                    if data.get("status") == "pending_review":
                        pending_candidates += 1
                except Exception:
                    pass

        return {
            "tracked_speakers": tracked,
            "total_samples": total_samples,
            "pending_candidates": pending_candidates,
        }

    def prune(self, min_samples=None, max_age_days=None):
        """Remove stale unknown speaker clusters.

        Deletes clusters with fewer than min_samples that haven't
        received new samples in max_age_days. Also removes empty dirs.
        """
        if min_samples is None:
            min_samples = int(os.getenv("UNKNOWN_SPEAKER_MIN_SAMPLES", "3"))
        if max_age_days is None:
            max_age_days = int(os.getenv("UNKNOWN_SPEAKER_MAX_AGE_DAYS", "30"))

        if not self.embeddings_dir.exists():
            return 0

        cutoff = datetime.utcnow().timestamp() - (max_age_days * 86400)
        pruned = 0

        for speaker_dir in list(self.embeddings_dir.iterdir()):
            if not speaker_dir.is_dir():
                continue

            npy_files = list(speaker_dir.glob("*.npy"))

            # Remove empty directories
            if not npy_files:
                try:
                    for f in speaker_dir.iterdir():
                        f.unlink()
                    speaker_dir.rmdir()
                    pruned += 1
                    log.info(f"Pruned empty cluster: {speaker_dir.name}")
                except OSError:
                    pass
                continue

            # Keep clusters with enough samples
            if len(npy_files) >= min_samples:
                continue

            # Check if cluster is stale (no new samples beyond cutoff)
            newest = max(f.stat().st_mtime for f in npy_files)
            if newest > cutoff:
                continue  # Still receiving samples

            # Stale cluster with too few samples — prune
            try:
                for f in speaker_dir.iterdir():
                    f.unlink()
                speaker_dir.rmdir()
                pruned += 1
                age_days = (datetime.utcnow().timestamp() - newest) / 86400
                log.info(f"Pruned stale cluster: {speaker_dir.name} "
                         f"({len(npy_files)} samples, {age_days:.0f}d old)")
            except OSError as e:
                log.warning(f"Failed to prune {speaker_dir.name}: {e}")

        if pruned:
            log.info(f"Pruned {pruned} stale unknown speaker clusters")
        return pruned


# Singleton tracker
_tracker = None

def _get_tracker():
    global _tracker
    if _tracker is None:
        _tracker = UnknownSpeakerTracker()
    return _tracker


def _find_unknown_cluster(embedding, tracker, threshold=0.20):
    """Find an existing unknown speaker cluster that matches this embedding.

    Prevents the same unidentified person from getting different tracker IDs
    across different audio files.
    """
    if not tracker.embeddings_dir.exists():
        return None

    best_id = None
    best_dist = float("inf")

    for speaker_dir in tracker.embeddings_dir.iterdir():
        if not speaker_dir.is_dir():
            continue

        npy_files = sorted(speaker_dir.glob("*.npy"),
                           key=lambda f: f.stat().st_mtime, reverse=True)[:5]
        if not npy_files:
            continue

        cluster_embeddings = [np.load(f) for f in npy_files]
        avg = np.mean(cluster_embeddings, axis=0)

        sim = np.dot(embedding, avg) / (
            np.linalg.norm(embedding) * np.linalg.norm(avg)
        )
        dist = 1 - sim

        if dist < best_dist:
            best_dist = dist
            best_id = speaker_dir.name

    if best_dist < threshold:
        return best_id
    return None


# --- Full Speaker Identification (post-transcription) -----------------------

def identify_all_speakers(audio_path, transcript_data):
    """Identify speakers in a diarized transcript.

    For each SPEAKER_XX label in the transcript:
    1. Find that speaker's segments (start/end times)
    2. Extract ECAPA-TDNN embedding from the longest segment
    3. Match against enrolled voice profiles
    4. If matched: write speaker_name into transcript segments
    5. If unmatched: track via UnknownSpeakerTracker

    Args:
        audio_path: Path to the original audio file.
        transcript_data: Dict with 'segments' from AssemblyAI (converted format).

    Returns:
        Updated transcript_data with speaker_name fields and
        speaker_identification metadata.
    """
    if not SPEAKER_ID_ENABLED:
        log.info("Speaker identification disabled (SPEAKER_ID_ENABLED=false)")
        transcript_data["pipeline_status"] = "complete_no_speaker_id"
        transcript_data["speaker_id_skipped"] = True
        return transcript_data

    classifier = _load_classifier()
    if classifier is None:
        log.warning("Speaker encoder not available — skipping identification")
        transcript_data["pipeline_status"] = "speaker_id_failed"
        transcript_data["speaker_id_error"] = "encoder_not_available"
        return transcript_data

    segments = transcript_data.get("segments", [])
    if not segments:
        return transcript_data

    # Group segments by speaker label
    speaker_segments = {}
    for seg in segments:
        spk = seg.get("speaker")
        if not spk:
            continue
        if spk not in speaker_segments:
            speaker_segments[spk] = []
        speaker_segments[spk].append(seg)

    if not speaker_segments:
        log.info("No speaker labels found in transcript — skipping identification")
        return transcript_data

    profiles = _load_profiles()
    tracker = _get_tracker()
    identified = {}
    audio_filename = transcript_data.get("file", os.path.basename(str(audio_path)))

    for spk_label, segs in speaker_segments.items():
        ranges = [(s.get("start", 0), s.get("end", 0)) for s in segs]
        total_duration = sum(e - s for s, e in ranges if e > s)

        if total_duration < MIN_SEGMENT_DURATION:
            log.debug(f"{spk_label}: only {total_duration:.1f}s of audio, skipping")
            continue

        # Use multiple segments for more robust embedding quality
        embedding = extract_multi_segment_embedding(
            audio_path, ranges, max_segments=3
        )
        if embedding is None:
            log.debug(f"{spk_label}: embedding extraction failed")
            continue

        name, dist = match_speaker(embedding)
        if name:
            log.info(f"Identified: {spk_label} -> {name} (distance={dist:.3f})")
            identified[spk_label] = {
                "name": name,
                "distance": round(dist, 4),
                "method": "multi-segment-avg",
            }
        else:
            # Log the best match distance for threshold tuning diagnostics
            # Find which profile was closest and its threshold
            closest_profile = None
            closest_threshold = 0.5
            closest_dist = float("inf")
            for pname, prof in profiles.items():
                for enrolled in prof["embeddings"]:
                    sim = np.dot(embedding, enrolled) / (
                        np.linalg.norm(embedding) * np.linalg.norm(enrolled)
                    )
                    d = 1 - sim
                    if d < closest_dist:
                        closest_dist = d
                        closest_profile = pname
                        closest_threshold = prof.get("threshold", 0.5)
            log.info(f"No match for {spk_label}: closest_profile={closest_profile}, "
                     f"distance={closest_dist:.4f}, threshold={closest_threshold}, "
                     f"gap={closest_dist - closest_threshold:+.4f}, "
                     f"duration={total_duration:.1f}s")

            # Track as unknown — use clustering to maintain stable IDs
            file_hash = int(hashlib.sha256(audio_filename.encode()).hexdigest()[:8], 16) % 100000
            stable_id = f"unknown_{spk_label}_{file_hash:05d}"

            cluster_id = _find_unknown_cluster(embedding, tracker)
            if cluster_id:
                stable_id = cluster_id

            spk_text = " ".join(
                s.get("text", "").strip() for s in segs if s.get("text")
            )

            tracker.add_sample(
                speaker_id=stable_id,
                embedding=embedding,
                transcript=spk_text[:500],
                source_file=audio_filename,
                timestamp=datetime.utcnow().isoformat() + "Z",
            )
            log.info(f"Tracked unknown: {spk_label} -> {stable_id} (best dist={dist:.3f})")

    # Apply identified names to all segments
    if identified:
        for seg in segments:
            spk = seg.get("speaker")
            if spk and spk in identified:
                seg["speaker_name"] = identified[spk]["name"]

    transcript_data["speaker_identification"] = {
        "identified": dict(identified),
        "unidentified": [
            spk for spk in speaker_segments if spk not in identified
        ],
        "profiles_checked": len(profiles),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    # Mark pipeline complete — identification ran successfully
    transcript_data["pipeline_status"] = "complete"

    return transcript_data


def get_identification_stats():
    """Get stats for the speaker identification system (for API/dashboard)."""
    profiles = _load_profiles()
    tracker = _get_tracker()
    tracker_stats = tracker.get_stats()

    stats = {
        "enabled": SPEAKER_ID_ENABLED,
        "encoder_loaded": _classifier is not None,
        "enrolled_profiles": len(profiles),
        "profile_names": list(profiles.keys()),
        "unknown_tracked": tracker_stats["tracked_speakers"],
        "unknown_samples": tracker_stats["total_samples"],
        "pending_candidates": tracker_stats["pending_candidates"],
    }

    # Include encoder retry info when not loaded
    if _classifier is None and _classifier_last_attempt > 0:
        secs_since = _time.time() - _classifier_last_attempt
        stats["encoder_last_attempt_secs_ago"] = round(secs_since)
        stats["encoder_retry_interval"] = _classifier_retry_interval
        stats["encoder_next_retry_secs"] = max(0, round(
            _classifier_retry_interval - secs_since
        ))

    return stats
