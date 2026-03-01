#!/usr/bin/env python3
"""Fix unnormalized speaker profile embeddings.

Scans all JSON profiles in ~/.openclaw/voice-profiles/ and L2-normalizes
any embeddings whose norm deviates significantly from 1.0. Recomputes
self-consistency and threshold after normalization.

Usage:
    python fix-profile-norms.py            # fix in place
    python fix-profile-norms.py --dry-run  # preview only
"""

import json
import sys
from pathlib import Path


PROFILES_DIR = Path.home() / ".openclaw" / "voice-profiles"

# Norm tolerance: embeddings outside [0.9, 1.1] are considered unnormalized
NORM_LOW = 0.9
NORM_HIGH = 1.1


def l2_norm(vec):
    """Compute L2 norm of a vector."""
    return sum(x * x for x in vec) ** 0.5


def l2_normalize(vec):
    """L2-normalize a vector (divide each element by the norm)."""
    norm = l2_norm(vec)
    if norm == 0:
        return vec
    return [x / norm for x in vec]


def cosine_distance(a, b):
    """Cosine distance between two L2-normalized vectors: 1 - dot(a, b)."""
    dot = sum(x * y for x, y in zip(a, b))
    return 1.0 - dot


def compute_self_consistency(embeddings):
    """Mean pairwise cosine distance between all embeddings."""
    n = len(embeddings)
    if n < 2:
        return None
    distances = []
    for i in range(n):
        for j in range(i + 1, n):
            distances.append(cosine_distance(embeddings[i], embeddings[j]))
    return sum(distances) / len(distances)


def compute_threshold(self_consistency):
    """Compute threshold: max(0.20, min(0.50, 3 * self_consistency))."""
    if self_consistency is None:
        return 0.35  # default when not enough samples
    return round(max(0.20, min(0.50, 3 * self_consistency)), 2)


def fix_profile(profile_path, dry_run=False):
    """Check and fix a single profile. Returns (was_fixed, stats_dict)."""
    data = json.loads(profile_path.read_text(encoding="utf-8"))
    name = data.get("name", profile_path.stem)
    embeddings = data.get("embeddings", [])

    if not embeddings:
        return False, {"name": name, "skipped": "no embeddings"}

    # Check each embedding's norm
    norms_before = [l2_norm(emb) for emb in embeddings]
    needs_fix = any(n < NORM_LOW or n > NORM_HIGH for n in norms_before)

    stats = {
        "name": name,
        "num_embeddings": len(embeddings),
        "norms_before": [round(n, 4) for n in norms_before],
    }

    if not needs_fix:
        stats["status"] = "OK (all norms within [0.9, 1.1])"
        return False, stats

    # Normalize all embeddings (even the ones that are close to 1.0,
    # for consistency after we recompute pairwise distances)
    normalized = [l2_normalize(emb) for emb in embeddings]
    norms_after = [l2_norm(emb) for emb in normalized]

    # Recompute self-consistency on normalized embeddings
    old_consistency = data.get("metadata", {}).get("self_consistency") or data.get("selfConsistency")
    old_threshold = data.get("threshold")
    old_variance = data.get("metadata", {}).get("variance") if "metadata" in data else data.get("variance")

    new_consistency = compute_self_consistency(normalized)
    new_threshold = compute_threshold(new_consistency)

    # Recompute variance (mean of per-dimension variance)
    if len(normalized) >= 2:
        n = len(normalized)
        dim = len(normalized[0])
        new_variance = 0.0
        for d in range(dim):
            vals = [normalized[i][d] for i in range(n)]
            mean_val = sum(vals) / n
            var_val = sum((v - mean_val) ** 2 for v in vals) / n
            new_variance += var_val
        new_variance = new_variance / dim
    else:
        new_variance = 0.0

    stats.update({
        "status": "FIXED" if not dry_run else "WOULD FIX",
        "norms_after": [round(n, 4) for n in norms_after],
        "old_consistency": old_consistency,
        "new_consistency": round(new_consistency, 4) if new_consistency is not None else None,
        "old_threshold": old_threshold,
        "new_threshold": new_threshold,
        "old_variance": old_variance,
        "new_variance": round(new_variance, 6),
    })

    if not dry_run:
        # Update embeddings
        data["embeddings"] = normalized

        # Update threshold
        data["threshold"] = new_threshold

        # Update variance and self_consistency in metadata (if present)
        if "metadata" in data:
            data["metadata"]["variance"] = round(new_variance, 6)
            data["metadata"]["self_consistency"] = round(new_consistency, 4) if new_consistency is not None else None
        else:
            # Some profiles store variance at top level
            if "variance" in data:
                data["variance"] = round(new_variance, 6)

        # Also update top-level selfConsistency if present
        if "selfConsistency" in data:
            data["selfConsistency"] = round(new_consistency, 4) if new_consistency is not None else None

        # Atomic write
        tmp_path = profile_path.with_name(f".tmp_{profile_path.name}")
        tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp_path.rename(profile_path)

    return True, stats


def main():
    dry_run = "--dry-run" in sys.argv

    if not PROFILES_DIR.exists():
        print(f"Profiles directory not found: {PROFILES_DIR}")
        sys.exit(1)

    profile_files = sorted(PROFILES_DIR.glob("*.json"))
    if not profile_files:
        print(f"No profile files found in {PROFILES_DIR}")
        sys.exit(0)

    mode = "DRY RUN" if dry_run else "FIX"
    print(f"=== Speaker Profile Norm Fixer ({mode}) ===")
    print(f"Profiles dir: {PROFILES_DIR}")
    print(f"Found {len(profile_files)} profile(s)\n")

    fixed_count = 0
    ok_count = 0

    for pf in profile_files:
        was_fixed, stats = fix_profile(pf, dry_run=dry_run)

        name = stats.get("name", pf.stem)
        status = stats.get("status", "unknown")

        if "skipped" in stats:
            print(f"  {name}: SKIPPED ({stats['skipped']})")
            continue

        print(f"  {name}: {status}")
        print(f"    Embeddings: {stats['num_embeddings']}")
        print(f"    Norms before: {stats['norms_before']}")

        if was_fixed:
            fixed_count += 1
            print(f"    Norms after:  {stats['norms_after']}")
            print(f"    Consistency:  {stats['old_consistency']} -> {stats['new_consistency']}")
            print(f"    Threshold:    {stats['old_threshold']} -> {stats['new_threshold']}")
            print(f"    Variance:     {stats['old_variance']} -> {stats['new_variance']}")
        else:
            ok_count += 1

        print()

    print(f"Summary: {fixed_count} fixed, {ok_count} OK, {len(profile_files)} total")
    if dry_run and fixed_count > 0:
        print(f"\nRe-run without --dry-run to apply fixes.")


if __name__ == "__main__":
    main()
