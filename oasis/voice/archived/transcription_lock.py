"""Cross-process transcription lock.

Ensures only one transcription (Whisper + diarization + speaker matching)
runs at a time across the voice listener and audio importer. Uses an
fcntl file lock so the OS enforces mutual exclusion between processes.

Usage:
    from transcription_lock import transcription_lock

    with transcription_lock():
        # heavy ML work here — only one process at a time
        segments = transcribe(audio_path)
        speakers = diarize(audio_path)
"""
import fcntl
import time
from contextlib import contextmanager
from pathlib import Path

LOCK_FILE = Path.home() / ".openclaw" / "voice-transcription.lock"


@contextmanager
def transcription_lock(timeout=0, poll_interval=2.0):
    """Acquire an exclusive file lock for transcription work.

    Args:
        timeout: Max seconds to wait for the lock. 0 = block forever.
        poll_interval: Seconds between retry attempts when waiting.

    Raises:
        TimeoutError: If timeout > 0 and the lock isn't acquired in time.
    """
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    f = open(LOCK_FILE, "w")
    try:
        if timeout <= 0:
            # Block until available
            fcntl.flock(f, fcntl.LOCK_EX)
        else:
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError(
                            f"Could not acquire transcription lock within {timeout}s"
                        )
                    time.sleep(poll_interval)
        yield
    finally:
        fcntl.flock(f, fcntl.LOCK_UN)
        f.close()
