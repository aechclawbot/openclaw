# Voice Pipeline & Knowledge Dashboard Enhancements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Google Drive watch folder ingestion, update pipeline UI for dual-input, improve transcript inline editing/labeling, and fix/enhance speaker profiles & candidates.

**Architecture:** Python watch-folder daemon (launchd) polls Google Drive, converts to WAV, feeds existing Docker pipeline. Dashboard Lit component (`page-knowledge.js`) gets UI enhancements. Express routes (`voice.js`) get new endpoints for ingestion control, utterance editing, profile creation, and candidate merging.

**Tech Stack:** Python 3 (watch-folder daemon), Lit web components (dashboard frontend), Express/Node.js (dashboard API), ffmpeg (audio conversion)

**Design doc:** `docs/plans/2026-03-01-voice-pipeline-enhancements-design.md`

---

## Task 1: Watch Folder Backend — Python Daemon

**Files:**

- Create: `scripts/voice/watch-folder.py`

**Step 1: Create the watch-folder.py script**

```python
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
    for _ in range(checks * 3):  # max attempts
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

    # Copy to temp (forces Google Drive download)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = TEMP_DIR / filename
    try:
        shutil.copy2(str(filepath), str(temp_path))
    except OSError as e:
        log.error(f"Copy failed for {filename}: {e}")
        set_current_file(None, "idle")
        return False

    # Wait for download to complete
    set_current_file(filename, "waiting")
    if not wait_for_stable_size(temp_path):
        log.error(f"File size never stabilized: {filename}")
        temp_path.unlink(missing_ok=True)
        set_current_file(None, "idle")
        return False

    # Compute hash for dedup
    file_hash = sha256_file(temp_path)

    # Check if already processed by hash
    for entry in ledger.values():
        if entry.get("hash") == file_hash:
            log.info(f"Skipping {filename} — duplicate hash (previously processed as {entry.get('source_filename', '?')})")
            temp_path.unlink(missing_ok=True)
            set_current_file(None, "idle")
            return False

    # Convert to WAV if needed
    set_current_file(filename, "converting")
    suffix = filepath.suffix.lower()
    INBOX_DIR.mkdir(parents=True, exist_ok=True)

    # Generate a unique name for the inbox file
    stem = filepath.stem.replace(" ", "_")
    wav_name = f"gdrive_{stem}.wav"
    inbox_path = INBOX_DIR / wav_name

    # Avoid collision
    counter = 1
    while inbox_path.exists():
        wav_name = f"gdrive_{stem}_{counter}.wav"
        inbox_path = INBOX_DIR / wav_name
        counter += 1

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

    # Record in ledger
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

    # Initialize state file if it doesn't exist
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
```

**Step 2: Verify the script runs without errors**

Run: `python3 scripts/voice/watch-folder.py &` (let it run for one poll cycle, then kill)
Expected: Logs showing "Watch folder daemon starting" and the source path. No errors.

**Step 3: Commit**

```bash
scripts/committer "feat: add watch folder daemon for Google Drive audio ingestion" scripts/voice/watch-folder.py
```

---

## Task 2: Watch Folder — Launchd Service

**Files:**

- Create: `~/Library/LaunchAgents/com.oasis.watch-folder.plist`

**Step 1: Create the launchd plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.oasis.watch-folder</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/oasis/openclaw/scripts/voice/watch-folder.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/oasis/.openclaw/logs/watch-folder.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/oasis/.openclaw/logs/watch-folder-error.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/oasis/openclaw</string>
</dict>
</plist>
```

**Step 2: Load and start the service**

Run: `launchctl load ~/Library/LaunchAgents/com.oasis.watch-folder.plist`
Verify: `launchctl list | grep watch-folder` — should show PID and exit status 0.
Verify logs: `tail -5 ~/.openclaw/logs/watch-folder.log` — should show startup messages.

**Step 3: Verify it does NOT process files yet (all 156 are new, we want to control this)**

The daemon will see 156 files but since the ledger is empty, it will start processing them one by one. If you want to hold off, create the state file first:

```bash
echo '{"active": false}' > ~/.openclaw/watch-folder-state.json
```

Then load the service. It will start in paused mode.

---

## Task 3: Dashboard API — Ingestion State Endpoints

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js` (append new routes)

**Step 1: Add ingestion status and toggle endpoints**

Add these routes to the end of `voice.js`, before the `export default router` line (line 964):

```javascript
// --- Ingestion State Management ---

const WATCH_FOLDER_STATE = join(CONFIG_DIR, "watch-folder-state.json");
const WATCH_FOLDER_CURRENT = join(CONFIG_DIR, "watch-folder-current.json");
const WATCH_FOLDER_LEDGER = join(CONFIG_DIR, "processed_audio_log.json");
const WATCH_FOLDER_SOURCE =
  "/Users/oasis/Library/CloudStorage/GoogleDrive-aech.clawbot@gmail.com/.shortcut-targets-by-id/1XPKf8bAq0qbOL7AmAPspViT82YUf_h8V/The Oasis - Personal AI Agent Framework/00_The_Library/Audio Recordings";

// GET /ingestion/status — combined status of both ingestion sources
router.get("/ingestion/status", async (req, res) => {
  try {
    // Watch folder state
    let watchFolderActive = true;
    try {
      const state = JSON.parse(await readFile(WATCH_FOLDER_STATE, "utf-8"));
      watchFolderActive = state.active !== false;
    } catch {}

    let currentFile = null;
    let watchStatus = "idle";
    try {
      const current = JSON.parse(await readFile(WATCH_FOLDER_CURRENT, "utf-8"));
      currentFile = current.currentFile || null;
      watchStatus = current.status || "idle";
    } catch {}

    // Ledger stats
    let filesProcessed = 0;
    try {
      const ledger = JSON.parse(await readFile(WATCH_FOLDER_LEDGER, "utf-8"));
      filesProcessed = Object.keys(ledger).length;
    } catch {}

    // Count files in source directory
    let filesDetected = 0;
    try {
      const entries = await readdir(WATCH_FOLDER_SOURCE);
      filesDetected = entries.filter((f) => /\.(wav|mp3|m4a|ogg|flac)$/i.test(f)).length;
    } catch {}

    // Microphone/listener status from health endpoint
    const health = await fetchContainerJSON("http://audio-listener:9001/health");
    const micActive = health
      ? health.recording || health.status === "listening" || health.status === "running"
      : false;

    res.json({
      microphone: { active: micActive },
      watchFolder: {
        active: watchFolderActive,
        status: watchFolderActive ? watchStatus : "paused",
        path: WATCH_FOLDER_SOURCE,
        filesDetected,
        filesProcessed,
        currentFile,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /ingestion/watch-folder/toggle — pause/resume watch folder
router.post("/ingestion/watch-folder/toggle", async (req, res) => {
  try {
    let current = { active: true };
    try {
      current = JSON.parse(await readFile(WATCH_FOLDER_STATE, "utf-8"));
    } catch {}

    const newState = { active: !current.active };
    await writeFile(WATCH_FOLDER_STATE, JSON.stringify(newState, null, 2));

    logActivity("voice", null, `Watch folder ${newState.active ? "resumed" : "paused"}`);
    res.json({ ok: true, active: newState.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /ingestion/microphone/toggle — pause/resume microphone
router.post("/ingestion/microphone/toggle", async (req, res) => {
  try {
    // Toggle via audio-listener's pause endpoint
    const result = await fetchContainerJSON("http://audio-listener:9001/toggle-recording", 5000);
    if (result) {
      logActivity("voice", null, `Microphone ${result.recording ? "resumed" : "paused"}`);
      res.json({ ok: true, active: result.recording });
    } else {
      res.status(503).json({ error: "Audio listener not responding" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Add watch folder data to the pipeline endpoint**

In the existing `GET /pipeline` route (around line 741, inside the `res.json({` response object), add a `watchFolder` key after the `commands` key:

```javascript
      // Watch folder status
      watchFolder: await (async () => {
        let active = true;
        try {
          const state = JSON.parse(await readFile(WATCH_FOLDER_STATE, "utf-8"));
          active = state.active !== false;
        } catch {}

        let currentFile = null, watchStatus = "idle";
        try {
          const current = JSON.parse(await readFile(WATCH_FOLDER_CURRENT, "utf-8"));
          currentFile = current.currentFile || null;
          watchStatus = current.status || "idle";
        } catch {}

        let filesProcessed = 0, lastProcessed = null, errors = 0;
        try {
          const ledger = JSON.parse(await readFile(WATCH_FOLDER_LEDGER, "utf-8"));
          filesProcessed = Object.keys(ledger).length;
          const entries = Object.values(ledger);
          if (entries.length > 0) {
            lastProcessed = entries.sort((a, b) =>
              new Date(b.processed_at) - new Date(a.processed_at)
            )[0].processed_at;
          }
        } catch {}

        let filesDetected = 0;
        try {
          const entries = await readdir(WATCH_FOLDER_SOURCE);
          filesDetected = entries.filter(f => /\.(wav|mp3|m4a|ogg|flac)$/i.test(f)).length;
        } catch {}

        return {
          status: !active ? "paused" : currentFile ? "processing" : "active",
          folderPath: "Google Drive/.../Audio Recordings",
          filesDetected,
          filesProcessed,
          currentFile,
          lastProcessed,
          errors,
        };
      })(),
```

**Step 3: Commit**

```bash
scripts/committer "feat: add ingestion state API endpoints and watch folder pipeline data" ~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js
```

---

## Task 4: Dashboard API — Utterance Edit Endpoint

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js`

**Step 1: Add utterance edit endpoint**

Add before the `export default router` line:

```javascript
// PUT /transcripts/:id/utterance — edit utterance text (curator copy only)
router.put("/transcripts/:id/utterance", async (req, res) => {
  try {
    const { id } = req.params;
    const { utteranceIndex, text } = req.body;

    if (!/^[a-zA-Z0-9_.-]+$/.test(id))
      return res.status(400).json({ error: "Invalid transcript ID format" });
    if (utteranceIndex == null || typeof utteranceIndex !== "number" || utteranceIndex < 0) {
      return res.status(400).json({ error: "Invalid utterance index" });
    }
    if (typeof text !== "string") return res.status(400).json({ error: "Text must be a string" });

    const files = await findFiles(VOICE_TRANSCRIPTS_DIR, `${id}.json`, 10);
    if (files.length === 0) return res.status(404).json({ error: "Transcript not found" });

    const filePath = files[0].path;
    const data = JSON.parse(await readFile(filePath, "utf-8"));

    if (!data.utterances || utteranceIndex >= data.utterances.length) {
      return res.status(400).json({ error: "Utterance index out of range" });
    }

    data.utterances[utteranceIndex].text = text;

    // Rebuild full transcript text from utterances
    data.transcript = data.utterances.map((u) => u.text).join(" ");

    await writeFile(filePath, JSON.stringify(data, null, 2));

    logActivity("voice", null, `Edited utterance ${utteranceIndex} in transcript ${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Commit**

```bash
scripts/committer "feat: add utterance text edit API endpoint" ~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js
```

---

## Task 5: Dashboard API — Speaker Profile Create & Candidate Merge Endpoints

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js`

**Step 1: Add multer import for file uploads**

At the top of `voice.js`, after the existing imports (around line 11):

```javascript
import multer from "multer";
import os from "os";

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });
```

Note: Check if `multer` is already a dependency. If not, run `npm install multer` in the dashboard directory.

**Step 2: Add profile create endpoint**

```javascript
// POST /profiles/create — create speaker profile from uploaded audio
router.post("/profiles/create", upload.single("audio"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
    const sanitizedName = name.trim().toLowerCase();
    if (!SAFE_NAME.test(sanitizedName))
      return res.status(400).json({ error: "Invalid name format" });

    if (!req.file) return res.status(400).json({ error: "Audio file is required" });

    const profilePath = resolve(VOICE_PROFILES_DIR, `${sanitizedName}.json`);
    if (!profilePath.startsWith(resolve(VOICE_PROFILES_DIR) + "/"))
      return res.status(403).json({ error: "Access denied" });
    if (existsSync(profilePath)) return res.status(409).json({ error: "Profile already exists" });

    // Forward audio to audio-listener for embedding extraction
    const FormData = (await import("undici")).FormData;
    const { Blob } = await import("buffer");
    const audioBuffer = await readFile(req.file.path);

    const formData = new FormData();
    formData.append("name", sanitizedName);
    formData.append("audio", new Blob([audioBuffer]), req.file.originalname || "audio.wav");

    let result;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const resp = await fetch("http://audio-listener:9001/enroll-speaker", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timer);
      result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Enrollment failed");
    } catch (fetchErr) {
      // Fallback: create a basic profile without embeddings if container is unavailable
      // The user can re-enroll later
      const profile = {
        name: sanitizedName,
        enrolledAt: new Date().toISOString(),
        enrollmentMethod: "manual",
        numSamples: 0,
        embeddings: [],
        threshold: 0.25,
        metadata: { created_via: "dashboard_upload", needs_embedding: true },
      };
      await writeFile(profilePath, JSON.stringify(profile, null, 2));
      logActivity("voice", null, `Created speaker profile '${sanitizedName}' (pending embedding)`);
      // Cleanup temp file
      await unlink(req.file.path).catch(() => {});
      return res.json({ ok: true, name: sanitizedName, needsEmbedding: true });
    }

    // Cleanup temp file
    await unlink(req.file.path).catch(() => {});

    logActivity("voice", null, `Created speaker profile '${sanitizedName}' via audio upload`);
    res.json({ ok: true, name: sanitizedName, ...result });
  } catch (err) {
    if (req.file) await unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});
```

**Step 3: Add candidate merge endpoint**

```javascript
// POST /candidates/merge — merge multiple candidates into one profile
router.post("/candidates/merge", async (req, res) => {
  try {
    const { candidateIds, target } = req.body;

    if (!Array.isArray(candidateIds) || candidateIds.length < 2) {
      return res.status(400).json({ error: "At least 2 candidate IDs required" });
    }
    if (!target || !["new", "existing"].includes(target.type)) {
      return res.status(400).json({ error: "Target must specify type: 'new' or 'existing'" });
    }

    for (const id of candidateIds) {
      if (!SAFE_SPEAKER_ID.test(id))
        return res.status(400).json({ error: `Invalid candidate ID: ${id}` });
    }

    let targetName;
    if (target.type === "new") {
      if (!target.name || !target.name.trim())
        return res.status(400).json({ error: "Name required for new profile" });
      targetName = target.name.trim().toLowerCase();
      if (!SAFE_NAME.test(targetName))
        return res.status(400).json({ error: "Invalid name format" });
    } else {
      if (!target.profileName)
        return res.status(400).json({ error: "profileName required for existing target" });
      targetName = target.profileName.toLowerCase();
    }

    // Load all candidate embeddings
    const embeddings = [];
    const candidateFiles = [];
    for (const candidateId of candidateIds) {
      const path = resolve(CANDIDATES_DIR, `${candidateId}.json`);
      if (!path.startsWith(resolve(CANDIDATES_DIR) + "/"))
        return res.status(403).json({ error: "Access denied" });
      if (!existsSync(path))
        return res.status(404).json({ error: `Candidate ${candidateId} not found` });

      const data = JSON.parse(await readFile(path, "utf-8"));
      if (data.avg_embedding && Array.isArray(data.avg_embedding)) {
        embeddings.push(data.avg_embedding);
      }
      candidateFiles.push({ path, data, id: candidateId });
    }

    if (embeddings.length === 0) {
      return res.status(400).json({ error: "No embeddings found in selected candidates" });
    }

    // Average the embeddings (L2-normalized)
    const dim = embeddings[0].length;
    const avgEmb = new Array(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) avgEmb[i] += emb[i];
    }
    for (let i = 0; i < dim; i++) avgEmb[i] /= embeddings.length;

    // L2 normalize
    const norm = Math.sqrt(avgEmb.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) avgEmb[i] /= norm;
    }

    const profilePath = resolve(VOICE_PROFILES_DIR, `${targetName}.json`);
    if (!profilePath.startsWith(resolve(VOICE_PROFILES_DIR) + "/"))
      return res.status(403).json({ error: "Access denied" });

    if (target.type === "existing") {
      // Merge into existing profile — add embedding
      if (!existsSync(profilePath))
        return res.status(404).json({ error: `Profile '${targetName}' not found` });
      const profile = JSON.parse(await readFile(profilePath, "utf-8"));
      if (!profile.embeddings) profile.embeddings = [];
      profile.embeddings.push(avgEmb);
      profile.numSamples = (profile.numSamples || 0) + embeddings.length;
      await writeFile(profilePath, JSON.stringify(profile, null, 2));
    } else {
      // Create new profile
      const profile = {
        name: targetName,
        enrolledAt: new Date().toISOString(),
        enrollmentMethod: "merged",
        numSamples: embeddings.length,
        embeddingDimensions: dim,
        embeddings: [avgEmb],
        threshold: 0.25,
        metadata: { merged_from: candidateIds },
      };
      await writeFile(profilePath, JSON.stringify(profile, null, 2));
    }

    // Mark candidates as merged
    for (const { path: cPath, data, id } of candidateFiles) {
      data.status = "merged";
      data.merged_at = new Date().toISOString();
      data.merged_into = targetName;
      await writeFile(cPath, JSON.stringify(data, null, 2));
    }

    // Trigger re-identification by removing .synced markers for affected transcripts
    try {
      const doneFiles = existsSync(AUDIO_DONE_DIR) ? await readdir(AUDIO_DONE_DIR) : [];
      let retagged = 0;
      for (const file of doneFiles) {
        if (!file.endsWith(".synced")) continue;
        await unlink(join(AUDIO_DONE_DIR, file)).catch(() => {});
        retagged++;
      }
      if (retagged > 0) log.info?.(`Removed ${retagged} .synced markers for re-identification`);
    } catch {}

    logActivity("voice", null, `Merged ${candidateIds.length} candidates into '${targetName}'`);
    res.json({ ok: true, name: targetName, mergedCount: candidateIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Step 4: Check if multer is already installed in the dashboard**

Run: `ls ~/.openclaw/workspace-oasis/dashboard/node_modules/multer 2>/dev/null && echo "installed" || echo "not installed"`

If not installed:
Run: `cd ~/.openclaw/workspace-oasis/dashboard && npm install multer`

**Step 5: Commit**

```bash
scripts/committer "feat: add profile create and candidate merge API endpoints" ~/.openclaw/workspace-oasis/dashboard/server/routes/voice.js
```

---

## Task 6: Frontend — Pipeline UI (Dual-Input + Pause Controls)

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Add ingestion state property**

In the `static get properties()` block (around line 250), add:

```javascript
_ingestionStatus: { type: Object },
```

Initialize in the constructor or `connectedCallback`:

```javascript
this._ingestionStatus = { microphone: { active: false }, watchFolder: { active: false } };
```

**Step 2: Add ingestion status fetch**

Add a method to load ingestion status, called from the pipeline refresh interval:

```javascript
async _loadIngestionStatus() {
  try {
    this._ingestionStatus = await api.get('/api/voice/ingestion/status');
  } catch {}
}
```

Call `this._loadIngestionStatus()` alongside `_loadPipelineData()` in the 5-second refresh interval.

**Step 3: Replace the pipeline flow graphic (lines ~2497-2511)**

Replace the single linear `pipeline-stages` div with a dual-input converging layout:

```javascript
<!-- Pipeline flow -->
<div class="pipeline-flow">
  <div class="pipeline-flow-title">Pipeline Status</div>
  <div class="pipeline-dual-input">
    <div class="pipeline-input-sources">
      <div class="pipeline-source">
        <div class="pipeline-stage">
          <div class="pipeline-stage-icon">
            🎤
            <span class="stage-dot ${this._ingestionStatus?.microphone?.active ? 'ok' : 'warn'}"></span>
          </div>
          <div class="pipeline-stage-name">Microphone</div>
        </div>
        <button class="toggle-btn ${this._ingestionStatus?.microphone?.active ? 'active' : 'paused'}"
                @click=${() => this._toggleIngestion('microphone')}>
          ${this._ingestionStatus?.microphone?.active ? 'Active' : 'Paused'}
        </button>
      </div>
      <div class="pipeline-source">
        <div class="pipeline-stage">
          <div class="pipeline-stage-icon">
            📁
            <span class="stage-dot ${this._ingestionStatus?.watchFolder?.active ? 'ok' : 'warn'}"></span>
          </div>
          <div class="pipeline-stage-name">Watch Folder</div>
        </div>
        <button class="toggle-btn ${this._ingestionStatus?.watchFolder?.active ? 'active' : 'paused'}"
                @click=${() => this._toggleIngestion('watch-folder')}>
          ${this._ingestionStatus?.watchFolder?.active ? 'Active' : 'Paused'}
        </button>
      </div>
    </div>
    <div class="pipeline-arrow">→</div>
    ${['listener', 'transcription', 'speakerId', 'curatorSync'].map((key, idx) => {
      const stage = { listener: { icon: '📡', name: 'Audio Listener' }, transcription: { icon: '🗣️', name: 'AssemblyAI' }, speakerId: { icon: '👤', name: 'Speaker ID' }, curatorSync: { icon: '📚', name: 'Curator Sync' } }[key];
      return html`
        ${idx > 0 ? html`<div class="pipeline-arrow">→</div>` : ''}
        <div class="pipeline-stage">
          <div class="pipeline-stage-icon">
            ${stage.icon}
            <span class="stage-dot ${this._stageStatus(key)}"></span>
          </div>
          <div class="pipeline-stage-name">${stage.name}</div>
        </div>
      `;
    })}
  </div>
</div>
```

**Step 4: Add toggle method**

```javascript
async _toggleIngestion(source) {
  try {
    await api.post(`/api/voice/ingestion/${source}/toggle`);
    await this._loadIngestionStatus();
  } catch (e) {
    console.error('Toggle failed:', e);
  }
}
```

**Step 5: Add Watch Folder status card**

After the existing stage detail cards grid (around line 2575), add:

```javascript
<!-- Watch Folder Status -->
${p.watchFolder ? html`
  <div class="watch-folder-card">
    <div class="card-title">📁 Watch Folder</div>
    <div class="detail-grid-2">
      <div><span class="detail-label">Path</span><span class="detail-value" title="${this._ingestionStatus?.watchFolder?.path || ''}">${p.watchFolder.folderPath || '—'}</span></div>
      <div><span class="detail-label">Status</span><span class="detail-value status-${p.watchFolder.status}">${p.watchFolder.status}</span></div>
      <div><span class="detail-label">Files Detected</span><span class="detail-value">${p.watchFolder.filesDetected ?? '—'}</span></div>
      <div><span class="detail-label">Files Processed</span><span class="detail-value">${p.watchFolder.filesProcessed ?? '—'}</span></div>
      <div><span class="detail-label">Current File</span><span class="detail-value">${p.watchFolder.currentFile || 'None'}</span></div>
      <div><span class="detail-label">Last Processed</span><span class="detail-value">${p.watchFolder.lastProcessed ? timeAgo(p.watchFolder.lastProcessed) : '—'}</span></div>
    </div>
  </div>
` : ''}
```

**Step 6: Add CSS for dual-input layout and toggle buttons**

In the `static get styles()` CSS block, add:

```css
.pipeline-dual-input {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-card);
  border-radius: 10px;
  overflow-x: auto;
}
.pipeline-input-sources {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pipeline-source {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toggle-btn {
  font-size: 10px;
  padding: 2px 10px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-weight: 600;
}
.toggle-btn.active {
  background: var(--green);
  color: #000;
}
.toggle-btn.paused {
  background: var(--yellow);
  color: #000;
}
.watch-folder-card {
  background: var(--bg-card);
  border-radius: 10px;
  padding: 16px;
  margin-top: 12px;
}
.watch-folder-card .card-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.status-active {
  color: var(--green);
}
.status-paused {
  color: var(--yellow);
}
.status-processing {
  color: var(--accent);
}
.status-error {
  color: var(--red);
}
```

**Step 7: Commit**

```bash
scripts/committer "feat: update pipeline UI with dual-input layout and pause controls" ~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js
```

---

## Task 7: Frontend — Inline Speaker Labeling (Auto-Save)

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Replace `_onUtteranceSpeakerChange` to auto-save (line ~1976)**

Replace the existing method:

```javascript
// Old:
_onUtteranceSpeakerChange(speakerId, e) {
  this._transcriptLabelSpeaker = { ...this._transcriptLabelSpeaker, [speakerId]: e.target.value };
}
```

With:

```javascript
async _onUtteranceSpeakerChange(speakerId, e) {
  const name = e.target.value;
  // Optimistic UI update
  this._transcriptLabelSpeaker = { ...this._transcriptLabelSpeaker, [speakerId]: name };
  this.requestUpdate();

  if (!this._transcriptDetail || !name) return;

  try {
    await api.post(`/api/voice/transcripts/${this._transcriptDetail.id}/label-speaker`, {
      speakerId,
      name,
    });
    this._showToast(`Labeled ${speakerId} as "${name}"`);
  } catch (err) {
    this._showToast(`Label failed: ${err.message}`, 'error');
  }
}
```

**Step 2: Remove the "Save Labels" button from the modal footer (line ~2863)**

Replace the modal footer:

```javascript
// Old:
<div class="modal-footer">
  <button class="btn btn-green" @click=${this._saveTranscriptLabels.bind(this)}>Save Labels</button>
  <button class="btn" style="margin-left:auto" @click=${this._closeTranscriptDetail.bind(this)}>Close</button>
</div>
```

With:

```javascript
<div class="modal-footer">
  <button class="btn" style="margin-left:auto" @click=${this._closeTranscriptDetail.bind(this)}>Close</button>
</div>
```

**Step 3: Add a simple toast notification system**

Add property: `_toast: { type: Object }` in properties.

Add method:

```javascript
_showToast(message, type = 'success') {
  this._toast = { message, type };
  this.requestUpdate();
  setTimeout(() => { this._toast = null; this.requestUpdate(); }, 3000);
}
```

Add to the `render()` method (at the end, before closing template tag):

```javascript
${this._toast ? html`
  <div class="toast toast-${this._toast.type}">${this._toast.message}</div>
` : ''}
```

Add CSS:

```css
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  z-index: 10000;
  animation: toast-in 0.3s ease;
}
.toast-success {
  background: var(--green);
  color: #000;
}
.toast-error {
  background: var(--red);
  color: #fff;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Step 4: Commit**

```bash
scripts/committer "feat: auto-save speaker labels on dropdown change with toast notifications" ~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js
```

---

## Task 8: Frontend — Inline Text Editing

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Add editing state property**

Add to properties: `_editingUtterance: { type: Number }` (index of utterance being edited, or -1).

Initialize: `this._editingUtterance = -1;`

**Step 2: Replace utterance text rendering (line ~2853)**

Replace the utterance text div:

```javascript
// Old:
<div class="utterance-text">${u.text || ""}</div>
```

With:

```javascript
<div class="utterance-text ${this._editingUtterance === idx ? 'editing' : ''}"
     @click=${(e) => { e.stopPropagation(); this._startEditUtterance(idx); }}>
  ${this._editingUtterance === idx ? html`
    <textarea class="utterance-edit-input"
              .value=${u.text || ''}
              @blur=${(e) => this._saveUtteranceEdit(idx, e.target.value)}
              @keydown=${(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this._saveUtteranceEdit(idx, e.target.value); }
                if (e.key === 'Escape') { e.preventDefault(); this._editingUtterance = -1; this.requestUpdate(); }
              }}
              @click=${(e) => e.stopPropagation()}></textarea>
  ` : html`
    <span class="editable-text">${u.text || ''}</span>
  `}
</div>
```

**Step 3: Add edit methods**

```javascript
_startEditUtterance(idx) {
  this._editingUtterance = idx;
  this.requestUpdate();
  // Focus textarea after render
  requestAnimationFrame(() => {
    const textarea = this.shadowRoot?.querySelector('.utterance-edit-input');
    if (textarea) {
      textarea.focus();
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  });
}

async _saveUtteranceEdit(idx, newText) {
  this._editingUtterance = -1;
  if (!this._transcriptDetail) return;

  const oldText = this._transcriptDetail.utterances[idx]?.text;
  if (newText === oldText) { this.requestUpdate(); return; }

  // Optimistic update
  this._transcriptDetail.utterances[idx].text = newText;
  this.requestUpdate();

  try {
    await api.put(`/api/voice/transcripts/${this._transcriptDetail.id}/utterance`, {
      utteranceIndex: idx,
      text: newText,
    });
    this._showToast('Text saved');
  } catch (err) {
    // Revert
    this._transcriptDetail.utterances[idx].text = oldText;
    this.requestUpdate();
    this._showToast(`Save failed: ${err.message}`, 'error');
  }
}
```

**Step 4: Add CSS**

```css
.utterance-text {
  cursor: text;
  position: relative;
  flex: 1;
}
.utterance-text:hover .editable-text {
  border-left: 2px solid var(--text-muted);
  padding-left: 6px;
}
.utterance-text.editing {
  border-left: 2px solid var(--accent);
  padding-left: 4px;
}
.utterance-edit-input {
  width: 100%;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 4px 6px;
  font-family: inherit;
  font-size: inherit;
  resize: vertical;
  min-height: 24px;
}
.editable-text {
  display: inline;
}
```

**Step 5: Commit**

```bash
scripts/committer "feat: add inline utterance text editing in transcript modal" ~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js
```

---

## Task 9: Frontend — Audio Playback Enhancements

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Improve active utterance styling (line ~2835)**

Update the `utterance-row` class for the active state. Change the existing `active-utterance` class in the CSS from a background change to a left border:

```css
/* Replace existing active-utterance styling with: */
.utterance-row.active-utterance {
  border-left: 3px solid var(--accent);
  padding-left: 9px;
  background: var(--accent) 08;
}
```

**Step 2: Add playback position indicator on the speaker timeline**

In the speaker timeline section (line ~2803), add a position marker:

After the timeline `<div>` close, add:

```javascript
<div
  class="timeline-position"
  style="left:${((this._transcriptCurrentTime || 0) / totalDur * 100).toFixed(2)}%"
></div>
```

Wrap the timeline in a `position: relative` container and add CSS:

```css
.speaker-timeline {
  position: relative;
}
.timeline-position {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
  transition: left 0.2s linear;
  pointer-events: none;
}
```

Add a property `_transcriptCurrentTime: { type: Number }` and update it in the existing `_onTranscriptAudioTimeUpdate`:

```javascript
this._transcriptCurrentTime = audio.currentTime;
```

**Step 3: Commit**

```bash
scripts/committer "feat: improve audio playback indicators in transcript modal" ~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js
```

---

## Task 10: Frontend — Speaker Profile Bug Fixes

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Fix profile card `p.id` → `p.name` (lines ~2901, 2981, 2986)**

In `_renderProfileCard` (line 2901):

```javascript
// Old:
const isRenaming = this._renameTarget === p.id;
```

Change to:

```javascript
const isRenaming = this._renameTarget === p.name;
```

In the profile actions (line 2981):

```javascript
// Old:
<button class="btn btn-sm" @click=${() => this._startRename(p.id, p.name)}>Rename</button>
```

Change to:

```javascript
<button class="btn btn-sm" @click=${() => this._startRename(p.name, p.name)}>Rename</button>
```

In line 2986:

```javascript
// Old:
<button class="btn btn-sm btn-red" @click=${() => this._confirmDeleteProfile(p.id, p.name)}>Delete</button>
```

Change to:

```javascript
<button class="btn btn-sm btn-red" @click=${() => this._confirmDeleteProfile(p.name, p.name)}>Delete</button>
```

**Step 2: Fix candidate card field mismatches (lines ~2993-3008)**

In `_renderCandidateCard` (line 2992):

```javascript
// Old:
const isApproving = this._approveTarget === c.id;
```

Change to:

```javascript
const isApproving = this._approveTarget === c.speaker_id;
```

Line 2998:

```javascript
// Old:
<span class="candidate-id">${c.id}</span>
<span class="candidate-samples">${c.sampleCount ?? 0} samples</span>
```

Change to:

```javascript
<span class="candidate-id">${c.speaker_id}</span>
<span class="candidate-samples">${c.num_samples ?? 0} samples</span>
```

Lines 3001-3008 — replace the broken audio/utterance display:

```javascript
// Old:
${c.audioUrl ? html`...` : ''}
${c.utteranceCount != null ? html`...` : ''}
```

Change to:

```javascript
${(c.sample_audio && c.sample_audio.some(Boolean)) ? html`
  <div class="candidate-samples-list">
    ${c.sample_audio.filter(Boolean).slice(0, 3).map((filename, i) => html`
      <div class="sample-item">
        <audio src="/api/voice/audio/${filename}" controls preload="none" style="width:100%;height:28px"></audio>
        ${c.sample_transcripts && c.sample_transcripts[i] ? html`
          <div class="sample-transcript" style="font-size:10px;color:var(--text-dim);margin-top:2px">${c.sample_transcripts[i].slice(0, 100)}</div>
        ` : ''}
      </div>
    `)}
  </div>
` : ''}
```

Lines 3013, 3014, 3019, 3020, 3021 — fix all `c.id` references to `c.speaker_id`:

```javascript
// Approve input @keydown:
@keydown=${e => { if (e.key === 'Enter') this._saveApprove(c.speaker_id); ...
// Enroll button:
<button class="btn btn-sm btn-green" @click=${() => this._saveApprove(c.speaker_id)}>Enroll</button>
// Approve button:
<button class="btn btn-sm btn-green" @click=${() => this._startApprove(c.speaker_id)}>Approve</button>
// Reject button:
<button class="btn btn-sm btn-yellow" @click=${() => this._rejectCandidate(c.speaker_id)}>Reject</button>
// Delete button:
<button class="btn btn-sm btn-red" @click=${() => this._confirmDeleteCandidate(c.speaker_id)}>Delete</button>
```

**Step 3: Commit**

```bash
scripts/committer "fix: correct field mismatches in profile and candidate cards" ~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js
```

---

## Task 11: Frontend — Create Speaker Profile Modal

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Add state properties**

```javascript
_showCreateProfile: { type: Boolean },
_createProfileName: { type: String },
_createProfileFile: { type: Object },
_createProfileLoading: { type: Boolean },
```

Initialize:

```javascript
this._showCreateProfile = false;
this._createProfileName = "";
this._createProfileFile = null;
this._createProfileLoading = false;
```

**Step 2: Add "Create Speaker Profile" button to `_renderSpeakers`**

After the "Speaker Profiles" section-title (line ~2877), add:

```javascript
<div style="display:flex;justify-content:space-between;align-items:center">
  <div class="section-title">Speaker Profiles</div>
  <button class="btn btn-accent btn-sm" @click=${() => { this._showCreateProfile = true; }}>+ Create Profile</button>
</div>
```

Remove the standalone `<div class="section-title">Speaker Profiles</div>`.

**Step 3: Add the create profile modal**

Add a method `_renderCreateProfileModal()`:

```javascript
_renderCreateProfileModal() {
  return html`
    <div class="modal-overlay" @click=${e => { if (e.target === e.currentTarget) this._showCreateProfile = false; }}>
      <div class="modal-box" style="max-width:440px">
        <div class="modal-header">
          <span class="modal-title">Create Speaker Profile</span>
          <button class="btn btn-sm" @click=${() => this._showCreateProfile = false}>✕</button>
        </div>
        <div class="modal-body" style="padding:16px">
          <div style="margin-bottom:12px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Speaker Name</label>
            <input type="text" placeholder="e.g. fred, courtney"
                   .value=${this._createProfileName}
                   @input=${e => this._createProfileName = e.target.value}
                   style="width:100%;padding:8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px" />
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Voice Sample Audio</label>
            <div class="upload-zone"
                 @dragover=${e => e.preventDefault()}
                 @drop=${e => { e.preventDefault(); this._createProfileFile = e.dataTransfer.files[0]; this.requestUpdate(); }}>
              ${this._createProfileFile ? html`
                <div>Selected: ${this._createProfileFile.name}</div>
              ` : html`
                <div style="color:var(--text-dim)">Drag & drop audio file or</div>
              `}
              <input type="file" accept=".wav,.mp3,.m4a" style="display:none" id="profile-audio-input"
                     @change=${e => { this._createProfileFile = e.target.files[0]; this.requestUpdate(); }} />
              <button class="btn btn-sm" @click=${() => this.shadowRoot.querySelector('#profile-audio-input').click()}>Browse</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          ${this._createProfileLoading ? html`<div class="spinner" style="width:16px;height:16px"></div>` : ''}
          <button class="btn btn-green"
                  ?disabled=${!this._createProfileName.trim() || !this._createProfileFile || this._createProfileLoading}
                  @click=${this._submitCreateProfile.bind(this)}>
            Create Profile
          </button>
          <button class="btn" @click=${() => this._showCreateProfile = false}>Cancel</button>
        </div>
      </div>
    </div>
  `;
}
```

**Step 4: Add submit method**

```javascript
async _submitCreateProfile() {
  if (!this._createProfileName.trim() || !this._createProfileFile) return;
  this._createProfileLoading = true;
  try {
    const formData = new FormData();
    formData.append('name', this._createProfileName.trim());
    formData.append('audio', this._createProfileFile);

    const resp = await fetch('/api/voice/profiles/create', { method: 'POST', body: formData });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Failed');

    this._showToast(`Profile '${this._createProfileName.trim()}' created`);
    this._showCreateProfile = false;
    this._createProfileName = '';
    this._createProfileFile = null;
    this._loadProfiles();
  } catch (err) {
    this._showToast(`Create failed: ${err.message}`, 'error');
  } finally {
    this._createProfileLoading = false;
  }
}
```

**Step 5: Render the modal conditionally in the main render method**

After the confirm dialog rendering:

```javascript
${this._showCreateProfile ? this._renderCreateProfileModal() : ''}
```

**Step 6: Add CSS for upload zone**

```css
.upload-zone {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  cursor: pointer;
}
.upload-zone:hover {
  border-color: var(--accent);
}
```

**Step 7: Commit**

```bash
scripts/committer "feat: add create speaker profile modal with audio upload" ~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js
```

---

## Task 12: Frontend — Merge Candidates

**Files:**

- Modify: `~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js`

**Step 1: Add merge state properties**

```javascript
_selectedCandidates: { type: Array },
_showMergeModal: { type: Boolean },
_mergeTarget: { type: Object },  // { type: 'new'|'existing', name: '', profileName: '' }
_mergeLoading: { type: Boolean },
```

Initialize:

```javascript
this._selectedCandidates = [];
this._showMergeModal = false;
this._mergeTarget = { type: "new", name: "" };
this._mergeLoading = false;
```

**Step 2: Add checkbox to candidate cards**

At the top of `_renderCandidateCard(c)`, add a checkbox:

```javascript
<div class="candidate-card">
  <label class="candidate-checkbox" @click=${e => e.stopPropagation()}>
    <input type="checkbox"
           ?checked=${this._selectedCandidates.includes(c.speaker_id)}
           @change=${e => this._toggleCandidateSelection(c.speaker_id, e.target.checked)} />
  </label>
  <!-- ...rest of card -->
```

**Step 3: Add "Merge Selected" button in candidates section header**

In `_renderSpeakers`, update the Candidates section:

```javascript
<div style="display:flex;justify-content:space-between;align-items:center">
  <div class="section-title">Unidentified Candidates</div>$
  {this._selectedCandidates.length >= 2
    ? html`
        <button class="btn btn-accent btn-sm" @click=${() => (this._showMergeModal = true)}>
          Merge Selected (${this._selectedCandidates.length})
        </button>
      `
    : ""}
</div>
```

**Step 4: Add selection toggle method**

```javascript
_toggleCandidateSelection(speakerId, checked) {
  if (checked) {
    this._selectedCandidates = [...this._selectedCandidates, speakerId];
  } else {
    this._selectedCandidates = this._selectedCandidates.filter(id => id !== speakerId);
  }
}
```

**Step 5: Add merge modal**

```javascript
_renderMergeModal() {
  return html`
    <div class="modal-overlay" @click=${e => { if (e.target === e.currentTarget) this._showMergeModal = false; }}>
      <div class="modal-box" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title">Merge ${this._selectedCandidates.length} Candidates</span>
          <button class="btn btn-sm" @click=${() => this._showMergeModal = false}>✕</button>
        </div>
        <div class="modal-body" style="padding:16px">
          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
              <input type="radio" name="merge-type" value="new"
                     ?checked=${this._mergeTarget.type === 'new'}
                     @change=${() => this._mergeTarget = { ...this._mergeTarget, type: 'new' }} />
              Create new profile
            </label>
            ${this._mergeTarget.type === 'new' ? html`
              <input type="text" placeholder="Speaker name..."
                     .value=${this._mergeTarget.name || ''}
                     @input=${e => this._mergeTarget = { ...this._mergeTarget, name: e.target.value }}
                     style="width:100%;padding:8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px;margin-left:24px" />
            ` : ''}
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
              <input type="radio" name="merge-type" value="existing"
                     ?checked=${this._mergeTarget.type === 'existing'}
                     @change=${() => this._mergeTarget = { ...this._mergeTarget, type: 'existing' }} />
              Merge into existing profile
            </label>
            ${this._mergeTarget.type === 'existing' ? html`
              <select @change=${e => this._mergeTarget = { ...this._mergeTarget, profileName: e.target.value }}
                      style="width:100%;padding:8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px;margin-left:24px">
                <option value="">Select profile...</option>
                ${this._profiles.map(p => html`<option value="${p.name}">${p.name}</option>`)}
              </select>
            ` : ''}
          </div>
        </div>
        <div class="modal-footer">
          ${this._mergeLoading ? html`<div class="spinner" style="width:16px;height:16px"></div>` : ''}
          <button class="btn btn-green"
                  ?disabled=${this._mergeLoading || (this._mergeTarget.type === 'new' && !this._mergeTarget.name?.trim()) || (this._mergeTarget.type === 'existing' && !this._mergeTarget.profileName)}
                  @click=${this._submitMerge.bind(this)}>
            Merge
          </button>
          <button class="btn" @click=${() => this._showMergeModal = false}>Cancel</button>
        </div>
      </div>
    </div>
  `;
}
```

**Step 6: Add merge submit method**

```javascript
async _submitMerge() {
  this._mergeLoading = true;
  try {
    const body = {
      candidateIds: this._selectedCandidates,
      target: this._mergeTarget.type === 'new'
        ? { type: 'new', name: this._mergeTarget.name.trim() }
        : { type: 'existing', profileName: this._mergeTarget.profileName },
    };
    await api.post('/api/voice/candidates/merge', body);
    this._showToast(`Merged ${this._selectedCandidates.length} candidates`);
    this._showMergeModal = false;
    this._selectedCandidates = [];
    this._mergeTarget = { type: 'new', name: '' };
    this._loadCandidates();
    this._loadProfiles();
  } catch (err) {
    this._showToast(`Merge failed: ${err.message}`, 'error');
  } finally {
    this._mergeLoading = false;
  }
}
```

**Step 7: Render merge modal conditionally**

```javascript
${this._showMergeModal ? this._renderMergeModal() : ''}
```

**Step 8: Add CSS for candidate checkbox**

```css
.candidate-checkbox {
  position: absolute;
  top: 8px;
  right: 8px;
}
.candidate-card {
  position: relative;
}
```

**Step 9: Commit**

```bash
scripts/committer "feat: add candidate merge functionality with modal" ~/.openclaw/workspace-oasis/dashboard/public/components/pages/page-knowledge.js
```

---

## Task 13: Restart Dashboard & End-to-End Verification

**Step 1: Restart the dashboard container**

Run: `docker compose restart oasis-dashboard`
Verify: `docker compose logs --tail 20 oasis-dashboard` — check for no startup errors.

**Step 2: Verify API endpoints**

Run:

```bash
# Ingestion status
curl -s http://localhost:3000/api/voice/ingestion/status | python3 -m json.tool

# Pipeline (should include watchFolder key)
curl -s http://localhost:3000/api/voice/pipeline | python3 -m json.tool | grep -A 10 watchFolder
```

**Step 3: Test in browser**

Navigate to `http://192.168.4.186:3000/#/knowledge` and check:

1. Voice Pipeline tab: dual-input layout, toggle buttons, watch folder card
2. Transcripts tab: open a transcript, verify inline speaker dropdown auto-saves, click text to edit
3. Speakers tab: "Create Profile" button, candidate cards show `speaker_id` and audio players, merge checkbox

**Step 4: Final commit (if any fixes needed)**

```bash
scripts/committer "fix: address issues found during end-to-end verification" <affected-files>
```
