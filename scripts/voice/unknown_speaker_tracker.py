#!/usr/bin/env python3
"""Track and manage unknown speakers for automatic profile building"""
import json
import os
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

UNKNOWN_SPEAKERS_DIR = Path.home() / ".openclaw" / "unknown-speakers"
EMBEDDINGS_DIR = UNKNOWN_SPEAKERS_DIR / "embeddings"
AUDIO_DIR = UNKNOWN_SPEAKERS_DIR / "audio"
CANDIDATES_DIR = UNKNOWN_SPEAKERS_DIR / "candidates"

# Ensure directories exist
for d in [EMBEDDINGS_DIR, AUDIO_DIR, CANDIDATES_DIR]:
    d.mkdir(parents=True, exist_ok=True)


class UnknownSpeakerTracker:
    """Track embeddings and samples for unknown speakers"""

    def __init__(self):
        self.min_samples = 10  # Minimum samples before suggesting profile
        self.similarity_threshold = 0.3  # Cosine distance for clustering
        self.max_candidate_variance = float(os.environ.get(
            "UNKNOWN_SPEAKER_MAX_VARIANCE", "20.0"
        ))  # Reject noisy clusters

    def add_sample(self, speaker_id: str, embedding: np.ndarray,
                   audio_segment: np.ndarray, transcript: str,
                   timestamp: str) -> None:
        """Add a sample for an unknown speaker"""

        # Create speaker directory
        speaker_dir = EMBEDDINGS_DIR / speaker_id
        speaker_dir.mkdir(exist_ok=True)

        # Save embedding
        sample_id = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
        embedding_file = speaker_dir / f"{sample_id}.npy"
        np.save(embedding_file, embedding)

        # Save audio if provided
        if audio_segment is not None and len(audio_segment) > 0:
            audio_file = AUDIO_DIR / speaker_id / f"{sample_id}.npy"
            audio_file.parent.mkdir(exist_ok=True)
            np.save(audio_file, audio_segment)

        # Save metadata
        meta_file = speaker_dir / f"{sample_id}.json"
        metadata = {
            "timestamp": timestamp,
            "transcript": transcript,
            "speaker_id": speaker_id,
            "embedding_shape": embedding.shape,
            "audio_duration": len(audio_segment) / 16000 if audio_segment is not None else 0
        }
        with open(meta_file, 'w') as f:
            json.dump(metadata, f, indent=2)

        # Check if we have enough samples to build a candidate profile
        self._check_candidate_ready(speaker_id)

    def _check_candidate_ready(self, speaker_id: str) -> None:
        """Check if speaker has enough samples for profile building"""
        speaker_dir = EMBEDDINGS_DIR / speaker_id
        embedding_files = list(speaker_dir.glob("*.npy"))

        if len(embedding_files) >= self.min_samples:
            # Check if already marked as candidate
            candidate_file = CANDIDATES_DIR / f"{speaker_id}.json"
            if not candidate_file.exists():
                self._create_candidate(speaker_id, embedding_files)

    def _create_candidate(self, speaker_id: str, embedding_files: List[Path]) -> None:
        """Create a candidate profile from accumulated embeddings.

        Validates cluster quality before creating. Rejects clusters with
        high variance (likely mixed speakers) or poor self-consistency.
        """

        # Load all embeddings
        embeddings = [np.load(f) for f in embedding_files]

        # Calculate variance (how consistent the embeddings are)
        variance = np.var(embeddings, axis=0).mean()

        # Quality gate: reject noisy clusters that likely represent
        # multiple different speakers merged together
        if variance > self.max_candidate_variance:
            print(f"⚠️  Cluster {speaker_id} rejected: variance {variance:.2f} "
                  f"exceeds max {self.max_candidate_variance:.1f} (likely mixed speakers)")
            return

        # Compute self-consistency (pairwise cosine distances)
        self_consistency = self._compute_self_consistency(embeddings)
        if self_consistency is not None and self_consistency > 0.15:
            print(f"⚠️  Cluster {speaker_id} rejected: self-consistency {self_consistency:.4f} "
                  f"> 0.15 (embeddings too dissimilar for a single speaker)")
            return

        # Calculate average embedding (centroid) — L2-normalized
        avg_embedding = np.mean(embeddings, axis=0)
        norm = np.linalg.norm(avg_embedding)
        if norm > 0:
            avg_embedding = avg_embedding / norm

        # Auto-calibrate threshold from self-consistency
        threshold = 0.25  # default
        if self_consistency is not None:
            threshold = round(max(0.20, min(0.50, self_consistency * 3)), 2)

        # Load metadata
        metadata_files = [f.with_suffix('.json') for f in embedding_files]
        metadata_list = []
        for mf in metadata_files:
            if mf.exists():
                with open(mf) as f:
                    metadata_list.append(json.load(f))

        # Create candidate profile
        candidate = {
            "speaker_id": speaker_id,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "num_samples": len(embeddings),
            "avg_embedding": avg_embedding.tolist(),
            "variance": float(variance),
            "self_consistency": round(self_consistency, 4) if self_consistency is not None else None,
            "auto_threshold": threshold,
            "sample_metadata": metadata_list,
            "status": "pending_review",
            "suggested_name": None
        }

        # Save candidate
        candidate_file = CANDIDATES_DIR / f"{speaker_id}.json"
        with open(candidate_file, 'w') as f:
            json.dump(candidate, f, indent=2)

        print(f"✨ New candidate speaker profile ready: {speaker_id}")
        print(f"   Samples: {len(embeddings)}, Variance: {variance:.4f}, "
              f"Self-consistency: {self_consistency:.4f}, Threshold: {threshold}")
        print(f"   Run 'python scripts/voice/review_candidates.py' to assign names")

    @staticmethod
    def _compute_self_consistency(embeddings: List[np.ndarray]) -> Optional[float]:
        """Compute average pairwise cosine distance across embeddings."""
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

    def get_pending_candidates(self) -> List[Dict]:
        """Get all pending candidate profiles"""
        candidates = []
        for candidate_file in CANDIDATES_DIR.glob("*.json"):
            with open(candidate_file) as f:
                candidate = json.load(f)
                if candidate.get("status") == "pending_review":
                    candidates.append(candidate)
        return candidates

    def approve_candidate(self, speaker_id: str, name: str) -> Path:
        """Approve a candidate and create permanent profile.

        Uses quality metadata from the candidate (self-consistency, auto-threshold)
        to build a properly calibrated profile. The avg_embedding is stored
        L2-normalized so cosine distance matching works correctly.
        """
        candidate_file = CANDIDATES_DIR / f"{speaker_id}.json"

        if not candidate_file.exists():
            raise FileNotFoundError(f"Candidate {speaker_id} not found")

        with open(candidate_file) as f:
            candidate = json.load(f)

        # Use candidate's quality metrics if available (from improved _create_candidate)
        self_consistency = candidate.get("self_consistency")
        threshold = candidate.get("auto_threshold", 0.25)

        # If candidate was created by old code without quality metrics,
        # fall back to conservative defaults but warn
        variance = candidate.get("variance", 0)
        if variance > self.max_candidate_variance:
            print(f"⚠️  WARNING: Candidate {speaker_id} has high variance ({variance:.2f}). "
                  f"Profile may not match reliably. Consider re-enrolling with label_speaker.py.")

        # Ensure avg_embedding is L2-normalized
        avg_embedding = np.array(candidate["avg_embedding"])
        norm = np.linalg.norm(avg_embedding)
        if norm > 1.01:  # Not already normalized
            avg_embedding = avg_embedding / norm

        # Create permanent profile
        profile = {
            "name": name,
            "enrolledAt": datetime.utcnow().isoformat() + "Z",
            "enrollmentMethod": "automatic",
            "originalSpeakerId": speaker_id,
            "numSamples": candidate["num_samples"],
            "embeddingDimensions": len(candidate["avg_embedding"]),
            "embeddings": [avg_embedding.tolist()],
            "threshold": threshold,
            "selfConsistency": self_consistency,
            "metadata": {
                "variance": variance,
                "auto_enrolled_from": candidate["created_at"]
            }
        }

        # Save to voice profiles
        profiles_dir = Path.home() / ".openclaw" / "voice-profiles"
        profile_path = profiles_dir / f"{name}.json"

        with open(profile_path, 'w') as f:
            json.dump(profile, f, indent=2)

        # Mark candidate as approved
        candidate["status"] = "approved"
        candidate["approved_at"] = datetime.utcnow().isoformat() + "Z"
        candidate["assigned_name"] = name

        with open(candidate_file, 'w') as f:
            json.dump(candidate, f, indent=2)

        print(f"✅ Profile created: {name}")
        print(f"   Threshold: {threshold}, Self-consistency: {self_consistency}")
        print(f"   Saved to: {profile_path}")

        return profile_path

    def reject_candidate(self, speaker_id: str) -> None:
        """Reject a candidate profile"""
        candidate_file = CANDIDATES_DIR / f"{speaker_id}.json"

        if candidate_file.exists():
            with open(candidate_file) as f:
                candidate = json.load(f)

            candidate["status"] = "rejected"
            candidate["rejected_at"] = datetime.utcnow().isoformat() + "Z"

            with open(candidate_file, 'w') as f:
                json.dump(candidate, f, indent=2)

            print(f"❌ Candidate rejected: {speaker_id}")


if __name__ == "__main__":
    # Test the tracker
    tracker = UnknownSpeakerTracker()
    print(f"Unknown Speaker Tracker initialized")
    print(f"Minimum samples for candidate: {tracker.min_samples}")
    print(f"Pending candidates: {len(tracker.get_pending_candidates())}")
