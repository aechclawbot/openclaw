#!/usr/bin/env python3
"""
Watch Folder Daemon — monitors Google Drive for new audio files,
copies them to the audio pipeline inbox for processing.

Runs as launchd service: com.oasis.watch-folder
"""

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

# --- Configuration ---
WATCH_DIR = Path(
    os.environ.get("WATCH_FOLDER_PATH",
    "/Users/oasis/Library/CloudStorage/GoogleDrive-aech.clawbot@gmail.com/"
    ".shortcut-targets-by-id/1XPKf8bAq0qbOL7AmAPspViT82YUf_h8V/"
    "The Oasis - Personal AI Agent Framework/00_The_Library/Audio Recordings")
)
TEMP_DIR = Path(os.path.expanduser("~/oasis-audio/temp"))
INBOX_DIR = Path(os.path.expanduser("~/oasis-audio/inbox"))
DONE_DIR = Path(os.path.expanduser("~/oasis-audio/done"))
LEDGER_PATH = Path(os.path.expanduser("~/.openclaw/processed_audio_log.json"))
STATE_PATH = Path(os.path.expanduser("~/.openclaw/watch-folder-state.json"))
CURRENT_FILE_PATH = Path(os.path.expanduser("~/.openclaw/watch-folder-current.json"))

POLL_INTERVAL = int(os.environ.get("WATCH_POLL_INTERVAL", "30"))
SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg", ".flac"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [watch-folder] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("watch-folder")


def load_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.rename(path)


def sha256_file(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def is_active():
    state = load_json(STATE_PATH, {"active": True})
    return state.get("active", True)


def set_current_file(filename=None, status="idle"):
    save_json(CURRENT_FILE_PATH, {
        "currentFile": filename,
        "status": status,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def wait_for_stable_size(filepath, checks=3, interval=2):
    """Wait for file size to stabilize (Google Drive download complete)."""
    prev_size = -1
    stable_count = 0
    for _ in range(checks * 3):
        try:
            size = filepath.stat().st_size
        except OSError:
            return False
        if size == prev_size and size > 0:
            stable_count += 1
            if stable_count >= checks:
                return True
        else:
            stable_count = 0
        prev_size = size
        time.sleep(interval)
    return False


def convert_to_wav(input_path, output_path):
    """Convert audio to 16kHz mono WAV via ffmpeg."""
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(input_path),
             "-ar", "16000", "-ac", "1", str(output_path)],
            capture_output=True, check=True, timeout=300,
        )
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        log.error(f"ffmpeg conversion failed for {input_path.name}: {e}")
        return False


def process_file(filepath, ledger):
    """Process a single audio file: copy, convert, move to inbox."""
    filename = filepath.name
    set_current_file(filename, "downloading")
    log.info(f"Processing: {filename}")

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = TEMP_DIR / filename
    try:
        shutil.copy2(str(filepath), str(temp_path))
    except OSError as e:
        log.error(f"Copy failed for {filename}: {e}")
        set_current_file(None, "idle")
        return False

    set_current_file(filename, "waiting")
    if not wait_for_stable_size(temp_path):
        log.error(f"File size never stabilized: {filename}")
        temp_path.unlink(missing_ok=True)
        set_current_file(None, "idle")
        return False

    file_hash = sha256_file(temp_path)

    for entry in ledger.values():
        if entry.get("hash") == file_hash:
            log.info(f"Skipping {filename} — duplicate hash (previously processed as {entry.get('source_filename', '?')})")
            temp_path.unlink(missing_ok=True)
            set_current_file(None, "idle")
            return False

    set_current_file(filename, "converting")
    INBOX_DIR.mkdir(parents=True, exist_ok=True)

    stem = filepath.stem.replace(" ", "_")
    wav_name = f"gdrive_{stem}.wav"
    inbox_path = INBOX_DIR / wav_name

    counter = 1
    while inbox_path.exists():
        wav_name = f"gdrive_{stem}_{counter}.wav"
        inbox_path = INBOX_DIR / wav_name
        counter += 1

    suffix = filepath.suffix.lower()
    if suffix == ".wav":
        shutil.move(str(temp_path), str(inbox_path))
    else:
        wav_temp = TEMP_DIR / wav_name
        if not convert_to_wav(temp_path, wav_temp):
            temp_path.unlink(missing_ok=True)
            set_current_file(None, "idle")
            return False
        shutil.move(str(wav_temp), str(inbox_path))
        temp_path.unlink(missing_ok=True)

    ledger[filename] = {
        "hash": file_hash,
        "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_path": str(filepath),
        "source_filename": filename,
        "inbox_filename": wav_name,
    }
    save_json(LEDGER_PATH, ledger)

    log.info(f"Queued: {filename} -> {wav_name}")
    set_current_file(None, "idle")
    return True


def scan_and_process():
    """Scan watch directory and process new files."""
    if not WATCH_DIR.exists():
        log.warning(f"Watch directory not found: {WATCH_DIR}")
        return 0

    ledger = load_json(LEDGER_PATH, {})
    processed_count = 0

    for filepath in sorted(WATCH_DIR.iterdir()):
        if not filepath.is_file():
            continue
        if filepath.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if filepath.name in ledger:
            continue
        if not is_active():
            log.info("Paused — stopping after current file")
            break

        if process_file(filepath, ledger):
            processed_count += 1

    return processed_count


def main():
    log.info(f"Watch folder daemon starting")
    log.info(f"  Source: {WATCH_DIR}")
    log.info(f"  Poll interval: {POLL_INTERVAL}s")
    set_current_file(None, "idle")

    if not STATE_PATH.exists():
        save_json(STATE_PATH, {"active": True})

    while True:
        try:
            if is_active():
                count = scan_and_process()
                if count > 0:
                    log.info(f"Processed {count} new file(s)")
            else:
                log.debug("Paused — skipping scan")
        except Exception as e:
            log.error(f"Scan error: {e}", exc_info=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
