"""
AssemblyAI Transcriber for Audio Listener

Handles the full transcription pipeline:
  1. Upload WAV to AssemblyAI
  2. Submit for transcription + speaker diarization (Universal-2)
  3. Poll for completion
  4. Convert response to internal format (compatible with sync-transcripts.py)
  5. Run local SpeechBrain speaker identification
  6. Save enriched transcript to /audio/done/

Environment Variables:
  ASSEMBLYAI_API_KEY       - AssemblyAI API key (required)
  AUDIO_RETENTION_DAYS     - Days to keep WAV files after transcription (default: 30)
  ASSEMBLYAI_MAX_SPEAKERS  - Max speakers for diarization (default: 6)
  MIN_TRANSCRIBE_SECONDS   - Skip transcription for audio shorter than this (default: 10)
"""

import os
import json
import time
import wave
import logging
import threading
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

log = logging.getLogger("audio-listener.assemblyai")

# --- Configuration -----------------------------------------------------------

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"
ASSEMBLYAI_MAX_SPEAKERS = int(os.getenv("ASSEMBLYAI_MAX_SPEAKERS", "6"))
AUDIO_RETENTION_DAYS = int(os.getenv("AUDIO_RETENTION_DAYS", "30"))
MIN_TRANSCRIBE_SECONDS = float(os.getenv("MIN_TRANSCRIBE_SECONDS", "10"))

# Cost per hour: $0.15 base + $0.02 diarization
COST_PER_HOUR = 0.17

# Polling configuration
POLL_INTERVAL = 5  # seconds between status checks
POLL_TIMEOUT = 1800  # 30 minutes max wait

# Retry configuration
MAX_RETRIES = 3
RETRY_BASE_DELAY = 5  # seconds, doubles each retry


class AssemblyAITranscriber:
    """Manages the AssemblyAI upload -> poll -> speaker ID -> save pipeline."""

    def __init__(self, done_dir, inbox_dir, listener_state,
                 voice_command_callback=None):
        self.done_dir = Path(done_dir)
        self.inbox_dir = Path(inbox_dir)
        self.listener_state = listener_state
        self.voice_command_callback = voice_command_callback

        # Active jobs: transcript_id -> {file, submitted_at, status}
        self._jobs = {}
        self._jobs_lock = threading.Lock()

        # Persistent cost tracking
        self._cost_file = self.done_dir / ".assemblyai-cost.json"
        self._load_cost()

        self.done_dir.mkdir(parents=True, exist_ok=True)

        # Start background thread for retrying failed speaker identification
        self._start_speaker_id_retry_thread()

    def _load_cost(self):
        """Load persisted cost data from disk."""
        try:
            if self._cost_file.exists():
                data = json.loads(self._cost_file.read_text(encoding="utf-8"))
                self.listener_state["assemblyai_cost_usd"] = data.get("total_cost_usd", 0.0)
                self.listener_state["assemblyai_hours_transcribed"] = data.get("total_hours", 0.0)
                log.info(f"Loaded cost history: ${data.get('total_cost_usd', 0):.2f} ({data.get('total_hours', 0):.1f} hours)")
        except Exception as e:
            log.warning(f"Failed to load cost history: {e}")

    def _save_cost(self):
        """Persist cost data to disk."""
        try:
            data = {
                "total_cost_usd": self.listener_state.get("assemblyai_cost_usd", 0.0),
                "total_hours": self.listener_state.get("assemblyai_hours_transcribed", 0.0),
                "last_updated": datetime.now(timezone.utc).isoformat(),
            }
            self._cost_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as e:
            log.warning(f"Failed to save cost data: {e}")

    def _api_request(self, method, path, data=None, binary_data=None,
                     content_type="application/json"):
        """Make an authenticated request to AssemblyAI API with retry."""
        url = f"{ASSEMBLYAI_BASE_URL}{path}"
        headers = {"Authorization": ASSEMBLYAI_API_KEY}

        if binary_data is not None:
            body = binary_data
            headers["Content-Type"] = "application/octet-stream"
        elif data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            body = None

        for attempt in range(MAX_RETRIES):
            try:
                req = urllib.request.Request(url, data=body, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=120) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                error_body = e.read().decode("utf-8", errors="replace")
                if e.code == 429 or e.code >= 500:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning(f"AssemblyAI HTTP {e.code} (attempt {attempt + 1}/{MAX_RETRIES}), retrying in {delay}s: {error_body}")
                    time.sleep(delay)
                    continue
                log.error(f"AssemblyAI HTTP {e.code}: {error_body}")
                raise
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    log.warning(f"AssemblyAI request failed (attempt {attempt + 1}/{MAX_RETRIES}), retrying in {delay}s: {e}")
                    time.sleep(delay)
                    continue
                raise

    def _upload_audio(self, wav_path):
        """Upload a WAV file to AssemblyAI.

        Returns the upload_url for use in transcription submission.
        """
        file_size = wav_path.stat().st_size
        log.info(f"Uploading {wav_path.name} ({file_size / 1024 / 1024:.1f}MB) to AssemblyAI...")

        with open(wav_path, "rb") as f:
            audio_data = f.read()

        result = self._api_request("POST", "/upload", binary_data=audio_data)
        upload_url = result.get("upload_url")
        log.info(f"Upload complete: {wav_path.name}")
        return upload_url

    def _submit_transcription(self, upload_url):
        """Submit an uploaded audio file for transcription with diarization.

        Returns the transcript_id for polling.
        """
        config = {
            "audio_url": upload_url,
            "speech_models": ["universal-2"],
            "speaker_labels": True,
            "speakers_expected": None,  # let AssemblyAI auto-detect
            "language_detection": True,
        }

        result = self._api_request("POST", "/transcript", data=config)
        transcript_id = result.get("id")
        log.info(f"Transcription submitted: {transcript_id}")
        return transcript_id

    def _poll_transcript(self, transcript_id):
        """Poll for transcription completion.

        Returns the full transcript response when complete.
        Raises RuntimeError on error or timeout.
        """
        start_time = time.time()

        while time.time() - start_time < POLL_TIMEOUT:
            result = self._api_request("GET", f"/transcript/{transcript_id}")
            status = result.get("status")

            if status == "completed":
                log.info(f"Transcription completed: {transcript_id}")
                return result
            elif status == "error":
                error_msg = result.get("error", "Unknown error")
                raise RuntimeError(f"Transcription failed: {error_msg}")

            # Still processing
            time.sleep(POLL_INTERVAL)

        raise RuntimeError(f"Transcription timed out after {POLL_TIMEOUT}s: {transcript_id}")

    def _convert_response(self, response, wav_filename):
        """Convert AssemblyAI response to internal transcript format.

        Maps AssemblyAI's utterances/words structure to the segment-based
        format that sync-transcripts.py and the dashboard expect.
        """
        audio_duration = response.get("audio_duration", 0)

        # Map speaker labels: AssemblyAI uses "A", "B", "C" -> "SPEAKER_00", "SPEAKER_01"
        speaker_map = {}
        speaker_counter = 0

        segments = []
        utterances = response.get("utterances") or []

        for utt in utterances:
            aai_speaker = utt.get("speaker", "A")
            if aai_speaker not in speaker_map:
                speaker_map[aai_speaker] = f"SPEAKER_{speaker_counter:02d}"
                speaker_counter += 1

            seg = {
                "start": utt.get("start", 0) / 1000.0,  # ms -> seconds
                "end": utt.get("end", 0) / 1000.0,
                "text": utt.get("text", ""),
                "speaker": speaker_map[aai_speaker],
                "confidence": utt.get("confidence", 0),
                "words": [],
            }

            # Include word-level details
            for word in (utt.get("words") or []):
                seg["words"].append({
                    "text": word.get("text", ""),
                    "start": word.get("start", 0) / 1000.0,
                    "end": word.get("end", 0) / 1000.0,
                    "confidence": word.get("confidence", 0),
                    "speaker": speaker_map.get(word.get("speaker", aai_speaker), speaker_map[aai_speaker]),
                })

            segments.append(seg)

        # Build cost estimate
        hours = audio_duration / 3600.0
        cost_usd = round(hours * COST_PER_HOUR, 4)

        transcript = {
            "file": wav_filename,
            "language": response.get("language_code", "en"),
            "segments": segments,
            "diarization": True,
            "model": "assemblyai-universal-2",
            "num_speakers": len(speaker_map),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "pipeline_status": "transcribed",
            "assemblyai": {
                "transcript_id": response.get("id", ""),
                "audio_duration": audio_duration,
                "confidence": response.get("confidence", 0),
                "cost_usd": cost_usd,
                "language_code": response.get("language_code", ""),
            },
        }

        return transcript

    def _get_wav_duration(self, wav_path):
        """Get duration of a WAV file in seconds."""
        try:
            with wave.open(str(wav_path), 'rb') as wf:
                return wf.getnframes() / wf.getframerate()
        except Exception as e:
            log.warning(f"Could not read WAV duration for {wav_path.name}: {e}")
            return None

    def submit_and_process(self, wav_path):
        """Full pipeline: upload -> transcribe -> speaker ID -> save.

        This is the main entry point, called from a daemon thread after
        each audio segment is saved.
        """
        wav_path = Path(wav_path)
        filename = wav_path.name

        if not ASSEMBLYAI_API_KEY:
            log.error("ASSEMBLYAI_API_KEY not set — cannot transcribe")
            self.listener_state["assemblyai_failed"] = self.listener_state.get("assemblyai_failed", 0) + 1
            return

        # Check audio duration before submitting to AssemblyAI (cost gate)
        duration = self._get_wav_duration(wav_path)
        if duration is not None and duration < MIN_TRANSCRIBE_SECONDS:
            log.info(f"Skipping transcription for {filename}: {duration:.1f}s < {MIN_TRANSCRIBE_SECONDS}s minimum")
            self.listener_state["assemblyai_skipped_short"] = self.listener_state.get("assemblyai_skipped_short", 0) + 1
            # Save a minimal transcript so sync-transcripts.py knows to skip it
            skip_transcript = {
                "file": filename,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "pipeline_status": "skipped_too_short",
                "duration": round(duration, 2),
                "segments": [],
            }
            self._save_transcript(skip_transcript, filename)
            # Still attempt speaker embedding extraction for clips >= 1s
            # (useful for building unknown speaker profiles)
            if duration >= 1.0:
                try:
                    from speaker_verify import identify_all_speakers
                    identify_all_speakers(str(wav_path), skip_transcript)
                except Exception:
                    pass  # Best-effort for short clips
            return

        # Track job
        self.listener_state["assemblyai_submitted"] = self.listener_state.get("assemblyai_submitted", 0) + 1
        self.listener_state["assemblyai_pending"] = self.listener_state.get("assemblyai_pending", 0) + 1

        transcript_id = None
        try:
            # Step 1: Upload audio
            upload_url = self._upload_audio(wav_path)

            # Step 2: Submit for transcription
            transcript_id = self._submit_transcription(upload_url)

            with self._jobs_lock:
                self._jobs[transcript_id] = {
                    "file": filename,
                    "submitted_at": datetime.now(timezone.utc).isoformat(),
                    "status": "processing",
                }

            # Step 3: Poll for completion
            response = self._poll_transcript(transcript_id)

            # Step 4: Convert to internal format
            transcript = self._convert_response(response, filename)

            # Step 5: Run local speaker identification
            transcript = self._run_speaker_identification(wav_path, transcript)

            # Step 6: Save enriched transcript
            self._save_transcript(transcript, filename)

            # Step 7: Run voice command detection
            if self.voice_command_callback and transcript.get("segments"):
                self.voice_command_callback(transcript["segments"], wav_path)

            # Step 8: Update cost tracking
            aai_meta = transcript.get("assemblyai", {})
            cost = aai_meta.get("cost_usd", 0)
            hours = aai_meta.get("audio_duration", 0) / 3600.0
            self.listener_state["assemblyai_cost_usd"] = self.listener_state.get("assemblyai_cost_usd", 0) + cost
            self.listener_state["assemblyai_hours_transcribed"] = self.listener_state.get("assemblyai_hours_transcribed", 0) + hours
            self._save_cost()

            # Update state
            self.listener_state["assemblyai_completed"] = self.listener_state.get("assemblyai_completed", 0) + 1
            self.listener_state["last_transcript_completed"] = datetime.now(timezone.utc).isoformat()

            with self._jobs_lock:
                self._jobs[transcript_id]["status"] = "completed"

            log.info(f"Pipeline complete: {filename} -> {transcript_id} (${cost:.4f})")

        except Exception as e:
            log.error(f"Pipeline failed for {filename}: {e}")
            self.listener_state["assemblyai_failed"] = self.listener_state.get("assemblyai_failed", 0) + 1
            # Clean up stale job entry on error so it doesn't stay stuck forever
            if transcript_id:
                with self._jobs_lock:
                    if transcript_id in self._jobs:
                        self._jobs[transcript_id]["status"] = "failed"
                        self._jobs[transcript_id]["error"] = str(e)
        finally:
            self.listener_state["assemblyai_pending"] = max(0, self.listener_state.get("assemblyai_pending", 0) - 1)

    def _run_speaker_identification(self, wav_path, transcript):
        """Run local SpeechBrain speaker identification on transcript segments.

        Maps AssemblyAI's generic SPEAKER_00/01 labels to enrolled speaker names.
        Tracks unknown speakers for candidate review.
        Sets pipeline_status to reflect the outcome.
        """
        try:
            from speaker_verify import identify_all_speakers

            transcript = identify_all_speakers(str(wav_path), transcript)
            # identify_all_speakers now sets pipeline_status explicitly:
            #   "complete"              - identification ran successfully
            #   "complete_no_speaker_id" - SPEAKER_ID_ENABLED=false
            #   "speaker_id_failed"     - encoder unavailable
            # Only fallback to "complete" if it left status as "transcribed"
            # (shouldn't happen, but guards against future code paths)
            if transcript.get("pipeline_status") == "transcribed":
                transcript["pipeline_status"] = "complete"
            log.info(f"Speaker identification done for {wav_path.name} "
                     f"(status={transcript.get('pipeline_status')})")
        except ImportError:
            log.warning("speaker_verify.identify_all_speakers not available — skipping speaker ID")
            transcript["pipeline_status"] = "complete_no_speaker_id"
            transcript["speaker_id_skipped"] = True
        except Exception as e:
            log.error(f"Speaker identification failed for {wav_path.name}: {e}")
            transcript["pipeline_status"] = "speaker_id_failed"
            transcript["speaker_id_error"] = str(e)

        return transcript

    def _save_transcript(self, transcript, wav_filename):
        """Save enriched transcript to /audio/done/ as JSON.

        Uses atomic write (tmp + rename) to prevent sync-transcripts.py
        from reading a partially-written file.
        """
        stem = Path(wav_filename).stem
        out_path = self.done_dir / f"{stem}.json"
        tmp_path = self.done_dir / f".tmp_{stem}.json"

        tmp_path.write_text(
            json.dumps(transcript, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp_path.rename(out_path)
        log.info(f"Saved transcript: {out_path.name}")

    def _start_speaker_id_retry_thread(self):
        """Start background thread that retries failed speaker identification."""
        retry_interval = int(os.getenv("SPEAKER_ID_RETRY_INTERVAL", "600"))

        def _retry_loop():
            # Initial delay: let the container finish starting up
            time.sleep(60)
            cycle = 0
            while True:
                try:
                    self.retry_failed_speaker_id()
                except Exception as e:
                    log.error(f"Speaker ID retry loop error: {e}")

                # Prune stale unknown speaker clusters every ~6 hours
                cycle += 1
                if cycle % 36 == 0:  # 36 * 600s = 6 hours
                    try:
                        from speaker_verify import _get_tracker
                        _get_tracker().prune()
                    except Exception as e:
                        log.error(f"Unknown speaker pruning error: {e}")

                time.sleep(retry_interval)

        thread = threading.Thread(target=_retry_loop, daemon=True,
                                  name="speaker-id-retry")
        thread.start()
        log.info(f"Speaker ID retry thread started (interval: {retry_interval}s)")

    def retry_failed_speaker_id(self, force_all=False):
        """Scan done/ for transcripts needing speaker ID re-run.

        Args:
            force_all: If True, also re-process 'complete' transcripts that
                       have unidentified speakers (used after new enrollment).
        """
        from speaker_verify import _load_classifier, identify_all_speakers

        # Don't bother scanning if encoder still can't load
        classifier = _load_classifier()
        if classifier is None:
            return 0

        retried = 0
        max_retries = 10

        # Get list of actively-processing files to skip
        with self._jobs_lock:
            active_files = {
                info["file"] for info in self._jobs.values()
                if info["status"] == "processing"
            }

        for transcript_path in sorted(self.done_dir.glob("*.json")):
            if transcript_path.name.startswith("."):
                continue

            try:
                data = json.loads(transcript_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue

            # Skip actively-processing files
            if data.get("file") in active_files:
                continue

            status = data.get("pipeline_status", "")
            needs_retry = status in ("speaker_id_failed", "transcribed")

            # In force_all mode, also re-process transcripts with unidentified speakers
            if force_all and status == "complete":
                si = data.get("speaker_identification", {})
                if si.get("unidentified"):
                    needs_retry = True

            if not needs_retry:
                continue

            # Check retry count
            retry_count = data.get("speaker_id_retry_count", 0)
            if retry_count >= max_retries:
                if status != "complete_no_speaker_id":
                    log.warning(f"Giving up on {transcript_path.name} after {retry_count} retries")
                    data["pipeline_status"] = "complete_no_speaker_id"
                    data["speaker_id_error"] = "max_retries_exceeded"
                    tmp = transcript_path.with_name(f".tmp_{transcript_path.name}")
                    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
                    tmp.rename(transcript_path)
                continue

            # Find the corresponding audio file
            audio_file = data.get("file", "")
            audio_path = self.inbox_dir / audio_file if audio_file else None
            if not audio_path or not audio_path.exists():
                continue

            log.info(f"Retrying speaker ID: {transcript_path.name} "
                     f"(was: {status}, attempt {retry_count + 1}/{max_retries})")
            try:
                data["speaker_id_retry_count"] = retry_count + 1
                data = identify_all_speakers(str(audio_path), data)
                # identify_all_speakers sets pipeline_status on success/failure
                if data.get("pipeline_status") == "transcribed":
                    data["pipeline_status"] = "complete"

                # Atomic write
                tmp = transcript_path.with_name(f".tmp_{transcript_path.name}")
                tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.rename(transcript_path)

                # Remove .synced marker to trigger re-sync to curator
                marker = transcript_path.with_name(transcript_path.name + ".synced")
                if marker.exists():
                    marker.unlink()

                retried += 1
                log.info(f"Retry succeeded: {transcript_path.name} "
                         f"(status={data.get('pipeline_status')})")
            except Exception as e:
                log.error(f"Retry failed for {transcript_path.name}: {e}")

        if retried:
            log.info(f"Speaker ID retry: {retried} transcript(s) re-processed")
        return retried

    def cleanup_old_audio(self):
        """Delete WAV files older than AUDIO_RETENTION_DAYS.

        Only removes files that have been successfully transcribed
        (i.e., have a corresponding JSON in /audio/done/).
        """
        if AUDIO_RETENTION_DAYS <= 0:
            return

        cutoff = time.time() - (AUDIO_RETENTION_DAYS * 86400)
        cleaned = 0

        for wav in self.inbox_dir.glob("recording_*.wav"):
            if wav.stat().st_mtime > cutoff:
                continue

            # Only clean up if transcript exists
            transcript = self.done_dir / (wav.stem + ".json")
            if not transcript.exists():
                continue

            try:
                wav.unlink()
                # Also remove the .processed marker if it exists
                marker = wav.with_suffix(wav.suffix + ".processed")
                if marker.exists():
                    marker.unlink()
                cleaned += 1
            except OSError as e:
                log.warning(f"Failed to clean up {wav.name}: {e}")

        if cleaned:
            log.info(f"Cleaned up {cleaned} audio files older than {AUDIO_RETENTION_DAYS} days")

    def get_stats(self):
        """Return current pipeline stats for health/status endpoints."""
        with self._jobs_lock:
            active_jobs = [
                {"id": tid, **info}
                for tid, info in self._jobs.items()
                if info["status"] == "processing"
            ]

        return {
            "submitted": self.listener_state.get("assemblyai_submitted", 0),
            "completed": self.listener_state.get("assemblyai_completed", 0),
            "failed": self.listener_state.get("assemblyai_failed", 0),
            "pending": self.listener_state.get("assemblyai_pending", 0),
            "cost_usd": round(self.listener_state.get("assemblyai_cost_usd", 0), 4),
            "hours_transcribed": round(self.listener_state.get("assemblyai_hours_transcribed", 0), 2),
            "last_completed": self.listener_state.get("last_transcript_completed"),
            "active_jobs": active_jobs[:5],  # Show up to 5 active jobs
        }
