#!/usr/bin/env python3
"""Convert WhisperX transcript JSON to dashboard-compatible curator format.

Usage:
    python3 sync-transcripts-convert.py <source.json> <curator_voice_dir>

Saves to: <curator_voice_dir>/YYYY/MM/DD/HH-MM-SS[-diarized].json
"""
import json
import sys
from datetime import datetime
from pathlib import Path


def convert(src_path: str, curator_dir: str) -> str | None:
    with open(src_path) as f:
        data = json.load(f)

    segments = data.get("segments", [])
    if not segments:
        return None

    # Extract timestamp from JSON or filename
    ts_str = data.get("timestamp", "")
    ts = None
    if ts_str:
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except ValueError:
            pass

    if ts is None:
        fname = Path(src_path).stem.replace(".boosted", "")
        try:
            parts = fname.split("_")
            date_str = parts[1]
            time_str = parts[2] if len(parts) > 2 else "000000"
            ts = datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
        except (IndexError, ValueError):
            ts = datetime.utcnow()

    # Build full transcript text
    full_text = " ".join(seg.get("text", "").strip() for seg in segments).strip()
    if not full_text:
        return None

    # Duration = max end time
    duration = max((seg.get("end", 0) for seg in segments), default=0)

    # Speakers and utterances
    has_diarization = data.get("diarization", False)
    speakers_map: dict = {}
    utterances_list = []

    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue

        speaker_id = seg.get("speaker", "unknown")
        speaker_name = seg.get("speaker_name", None)

        if speaker_id not in speakers_map:
            speakers_map[speaker_id] = {
                "id": speaker_id,
                "name": speaker_name,
                "utterances": [],
            }
        elif speaker_name and not speakers_map[speaker_id]["name"]:
            speakers_map[speaker_id]["name"] = speaker_name

        speakers_map[speaker_id]["utterances"].append(
            {"text": text, "start": seg.get("start", 0), "end": seg.get("end", 0)}
        )
        utterances_list.append(
            {
                "speaker": speaker_name or speaker_id,
                "text": text,
                "start": seg.get("start", 0),
                "end": seg.get("end", 0),
            }
        )

    result = {
        "timestamp": ts.isoformat() + "Z",
        "duration": round(duration),
        "transcript": full_text,
        "audioPath": data.get("file", ""),
        "speakers": list(speakers_map.values()),
        "numSpeakers": len(speakers_map),
        "utterances": utterances_list,
        "source": "voice-passive",
        "model": data.get("model", "unknown"),
        "diarization": has_diarization,
    }

    # Save to curator directory: YYYY/MM/DD/HH-MM-SS.json
    date_dir = Path(curator_dir) / ts.strftime("%Y/%m/%d")
    date_dir.mkdir(parents=True, exist_ok=True)

    suffix = "-diarized" if has_diarization and "boosted" in Path(src_path).name else ""
    out_file = date_dir / f"{ts.strftime('%H-%M-%S')}{suffix}.json"

    counter = 1
    while out_file.exists():
        out_file = date_dir / f"{ts.strftime('%H-%M-%S')}{suffix}-{counter}.json"
        counter += 1

    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)

    return str(out_file)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <source.json> <curator_voice_dir>", file=sys.stderr)
        sys.exit(1)

    out = convert(sys.argv[1], sys.argv[2])
    if out:
        print(f"Saved: {out}")
