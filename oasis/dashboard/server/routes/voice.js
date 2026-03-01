/**
 * OASIS Dashboard v3 - Voice Routes
 * Full voice pipeline endpoints: transcripts CRUD, candidates, profiles, audio, stats, pipeline status.
 */

import { Router } from "express";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { readdir, stat, readFile, writeFile, unlink, copyFile } from "fs/promises";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import http from "http";
import multer from "multer";
import os from "os";

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";

const VOICE_TRANSCRIPTS_DIR = join(CONFIG_DIR, "workspace-curator", "transcripts", "voice");
const VOICE_PROFILES_DIR = join(CONFIG_DIR, "voice-profiles");
const UNKNOWN_SPEAKERS_DIR = join(CONFIG_DIR, "unknown-speakers");
const CANDIDATES_DIR = join(UNKNOWN_SPEAKERS_DIR, "candidates");
const AUDIO_DIR = process.env.AUDIO_DIR || process.env.AUDIO_INBOX_DIR || join(process.env.HOME || "/root", "oasis-audio", "inbox");
const AUDIO_DONE_DIR = process.env.AUDIO_DONE_DIR || join(process.env.HOME || "/root", "oasis-audio", "done");
const AUDIO_PLAYBACK_DIR = process.env.AUDIO_PLAYBACK_DIR || "/audio/playback";
const JOBS_FILE = process.env.JOBS_FILE || "/audio/jobs.json";

// Input validation patterns
const SAFE_SPEAKER_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_NAME = /^[a-zA-Z0-9 _'-]+$/;

// --- Watch Folder & Ingestion State ---
const WATCH_FOLDER_STATE = join(CONFIG_DIR, "watch-folder-state.json");
const WATCH_FOLDER_CURRENT = join(CONFIG_DIR, "watch-folder-current.json");
const WATCH_FOLDER_LEDGER = join(CONFIG_DIR, "processed_audio_log.json");
const WATCH_FOLDER_SOURCE = "/Users/oasis/Library/CloudStorage/GoogleDrive-aech.clawbot@gmail.com/.shortcut-targets-by-id/1XPKf8bAq0qbOL7AmAPspViT82YUf_h8V/The Oasis - Personal AI Agent Framework/00_The_Library/Audio Recordings";

function logActivity(type, agent, message) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message },
    });
  }
}

// Recursively find files with given extension, sorted by mtime (newest first)
async function findFiles(dir, ext, limit = 100) {
  const results = [];

  async function walk(currentDir) {
    if (results.length >= limit) {return;}
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= limit) {break;}
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(ext)) {
          const stats = await stat(fullPath);
          results.push({ path: fullPath, name: entry.name, mtime: stats.mtime });
        }
      }
    } catch {}
  }

  await walk(dir);
  return results.toSorted((a, b) => b.mtime - a.mtime);
}

async function fetchContainerJSON(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {return null;}
    return await res.json();
  } catch {
    return null;
  }
}

// GET /transcripts — paginated transcript list with optional search
router.get("/transcripts", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const query = (req.query.q || "").toLowerCase().trim();
    const files = await findFiles(VOICE_TRANSCRIPTS_DIR, ".json", 500);

    const allTranscripts = (
      await Promise.all(
        files.map(async (file) => {
          try {
            const content = await readFile(file.path, "utf-8");
            const data = JSON.parse(content);
            return {
              id: file.name.replace(".json", ""),
              timestamp: data.timestamp || file.mtime.toISOString(),
              duration: data.duration,
              numSpeakers: data.numSpeakers,
              speakers: data.speakers?.map((s) => s.name || s.id || "unknown").filter(Boolean) || [],
              preview: data.transcript?.substring(0, 200) || "",
              wordCount: (data.transcript || "").split(/\s+/).length,
              audioPath: data.audioPath || null,
              path: file.path,
              pipelineStatus: data.pipeline_status || null,
              confidence: data.confidence || null,
            };
          } catch {
            return null;
          }
        })
      )
    ).filter((t) => t !== null);

    const filtered = query
      ? allTranscripts.filter(
          (t) =>
            t.preview.toLowerCase().includes(query) ||
            t.speakers.some((s) => s && s.toLowerCase().includes(query)) ||
            t.id.toLowerCase().includes(query)
        )
      : allTranscripts;

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    res.json({ transcripts: filtered.slice(start, start + pageSize), total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /transcripts/:id — full transcript
router.get("/transcripts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
      return res.status(400).json({ error: "Invalid transcript ID format" });
    }
    const files = await findFiles(VOICE_TRANSCRIPTS_DIR, `${id}.json`, 10);
    if (files.length === 0) {return res.status(404).json({ error: "Transcript not found" });}
    const content = await readFile(files[0].path, "utf-8");
    res.json(JSON.parse(content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /transcripts/:id
router.delete("/transcripts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
      return res.status(400).json({ error: "Invalid transcript ID format" });
    }
    const files = await findFiles(VOICE_TRANSCRIPTS_DIR, `${id}.json`, 10);
    if (files.length === 0) {return res.status(404).json({ error: "Transcript not found" });}
    await unlink(files[0].path);
    logActivity("voice", null, `Deleted transcript: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /transcripts/:id/label-speaker — label a speaker via audio-listener service
router.post("/transcripts/:id/label-speaker", async (req, res) => {
  try {
    const { id } = req.params;
    const { speakerId, name } = req.body;

    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {return res.status(400).json({ error: "Invalid transcript ID format" });}
    if (!speakerId || !SAFE_SPEAKER_ID.test(speakerId)) {return res.status(400).json({ error: "Invalid speaker ID format" });}
    if (!name || !name.trim()) {return res.status(400).json({ error: "Name is required" });}
    const sanitizedName = name.trim().toLowerCase();
    if (!SAFE_NAME.test(sanitizedName)) {return res.status(400).json({ error: "Name contains invalid characters" });}

    const files = await findFiles(VOICE_TRANSCRIPTS_DIR, `${id}.json`, 10);
    if (files.length === 0) {return res.status(404).json({ error: "Transcript not found" });}

    const curatorData = JSON.parse(await readFile(files[0].path, "utf-8"));
    const audioPath = curatorData.audioPath || "";
    if (!audioPath) {return res.status(400).json({ error: "Transcript has no audio file reference" });}

    const baseName = audioPath.replace(/\.wav$/, "");
    const transcriptFile = `${baseName}.json`;

    // Delegate to audio-listener service (has SpeechBrain + R/W access)
    const result = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ transcript_file: transcriptFile, speaker_id: speakerId, name: sanitizedName });
      const req2 = http.request(
        {
          hostname: "audio-listener", port: 9001, path: "/label-speaker",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
          timeout: 60_000,
        },
        (resp) => {
          let body = "";
          resp.on("data", (d) => (body += d));
          resp.on("end", () => {
            try { resolve({ status: resp.statusCode, data: JSON.parse(body) }); }
            catch { reject(new Error(`Audio-listener returned invalid JSON: ${body}`)); }
          });
        }
      );
      req2.on("error", reject);
      req2.on("timeout", () => { req2.destroy(); reject(new Error("Audio-listener request timed out")); });
      req2.write(payload);
      req2.end();
    });

    if (result.status !== 200) {
      return res.status(result.status || 500).json(result.data);
    }

    // Update jobs.json to trigger orchestrator re-evaluation
    try {
      const jobsPath = JOBS_FILE;
      if (existsSync(jobsPath)) {
        const allJobs = JSON.parse(await readFile(jobsPath, "utf-8"));
        // Find the job for this transcript's audio file
        const audioBaseName = audioPath.replace(/\.wav$/, "");
        if (allJobs[audioBaseName]) {
          const job = allJobs[audioBaseName];
          // Remove .synced marker to trigger re-gate
          const marker = resolve(AUDIO_DONE_DIR, `${audioBaseName}.json.synced`);
          if (existsSync(marker)) {
            await unlink(marker);
          }
          // Update speaker identification from fresh transcript data
          try {
            const freshData = JSON.parse(await readFile(resolve(AUDIO_DONE_DIR, `${audioBaseName}.json`), "utf-8"));
            const si = freshData.speaker_identification || {};
            job.speakerIdentification = {
              identified: si.identified || {},
              unidentified: si.unidentified || [],
            };
            // Check if all speakers are now identified
            if (!si.unidentified || si.unidentified.length === 0) {
              job.status = "complete";
            } else {
              job.status = "pending_curator";
            }
          } catch {}
          await writeFile(jobsPath, JSON.stringify(allJobs, null, 2));
        }
      }
    } catch (jobErr) {
      // Non-fatal: orchestrator will catch up on next poll
      console.error("Failed to update jobs.json:", jobErr.message);
    }

    logActivity("voice", null, `Labeled ${speakerId} as '${sanitizedName}' in transcript ${id}`);
    res.json({
      ok: true,
      name: sanitizedName,
      speakerId,
      profileUpdated: result.data.profile_updated || false,
      embeddingsAdded: result.data.embeddings_added || 0,
      message: result.data.message || `Speaker '${sanitizedName}' labeled.`,
      curatorStatus: "re-evaluating",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /transcripts/:id/retry — re-queue audio for transcription
router.post("/transcripts/:id/retry", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {return res.status(400).json({ error: "Invalid transcript ID format" });}

    const AUDIO_INBOX = process.env.AUDIO_INBOX_DIR || join(CONFIG_DIR, "..", "..", "oasis-audio", "inbox");
    const AUDIO_DONE = process.env.AUDIO_DONE_DIR || join(CONFIG_DIR, "..", "..", "oasis-audio", "done");

    const wavName = `${id}.wav`;
    const boostedWavName = `${id}.boosted.wav`;
    const wavPath = resolve(AUDIO_DONE, wavName);
    const boostedWavPath = resolve(AUDIO_DONE, boostedWavName);

    if (!wavPath.startsWith(resolve(AUDIO_DONE) + "/") || !boostedWavPath.startsWith(resolve(AUDIO_DONE) + "/")) {
      return res.status(403).json({ error: "Access denied" });
    }

    let copied = false;
    if (existsSync(wavPath)) {
      await copyFile(wavPath, join(AUDIO_INBOX, wavName));
      const marker = join(AUDIO_INBOX, wavName + ".processed");
      if (existsSync(marker)) {await unlink(marker).catch(() => {});}
      copied = true;
    }
    if (existsSync(boostedWavPath)) {
      await copyFile(boostedWavPath, join(AUDIO_INBOX, boostedWavName));
      const marker = join(AUDIO_INBOX, boostedWavName + ".processed");
      if (existsSync(marker)) {await unlink(marker).catch(() => {});}
      copied = true;
    }

    if (!copied) {
      return res.status(404).json({ error: "No audio file found for retry." });
    }

    logActivity("voice", null, `Queued transcript for retry: ${id}`);
    res.json({ ok: true, message: "Audio queued for re-transcription" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /candidates — list pending speaker candidates
router.get("/candidates", async (req, res) => {
  try {
    if (!existsSync(CANDIDATES_DIR)) {return res.json({ candidates: [] });}

    const files = await readdir(CANDIDATES_DIR);
    let allAudioFiles = [];
    for (const dir of [AUDIO_DIR, AUDIO_DONE_DIR]) {
      if (existsSync(dir)) {
        try { allAudioFiles.push(...await readdir(dir)); } catch {}
      }
    }
    const audioWithTs = allAudioFiles
      .filter((f) => f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".m4a"))
      .map((f) => {
        const m = f.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
        return m ? { file: f, time: new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).getTime() } : null;
      })
      .filter(Boolean);

    const candidates = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (file) => {
          try {
            const content = await readFile(join(CANDIDATES_DIR, file), "utf-8");
            const data = JSON.parse(content);
            if (data.status !== "pending_review") {return null;}

            const sampleAudio = [];
            for (const meta of (data.sample_metadata || []).slice(0, 5)) {
              if (meta.audio_file) {
                sampleAudio.push(meta.audio_file);
              } else if (meta.timestamp && audioWithTs.length > 0) {
                const ts = new Date(String(meta.timestamp).replace(/([+-]\d{2}:\d{2})Z$/, "$1")).getTime();
                let closest = null, closestDiff = Infinity;
                for (const a of audioWithTs) {
                  const diff = Math.abs(a.time - ts);
                  if (diff < closestDiff) { closestDiff = diff; closest = a.file; }
                }
                sampleAudio.push(closestDiff <= 900000 ? closest : null);
              } else {
                sampleAudio.push(null);
              }
            }

            return {
              speaker_id: data.speaker_id,
              created_at: data.created_at,
              num_samples: data.num_samples,
              variance: data.variance,
              sample_transcripts: data.sample_metadata?.slice(0, 5).map((m) => m.transcript) || [],
              sample_timestamps: data.sample_metadata?.slice(0, 5).map((m) => m.timestamp) || [],
              sample_audio: sampleAudio,
            };
          } catch {
            return null;
          }
        })
    );

    res.json({ candidates: candidates.filter((c) => c !== null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /candidates/:speakerId/approve
router.post("/candidates/:speakerId/approve", async (req, res) => {
  try {
    const { speakerId } = req.params;
    const { name } = req.body;

    if (!SAFE_SPEAKER_ID.test(speakerId)) {return res.status(400).json({ error: "Invalid speaker ID format" });}
    if (!name || !name.trim()) {return res.status(400).json({ error: "Name is required" });}
    const sanitizedName = name.trim().toLowerCase();
    if (!SAFE_NAME.test(sanitizedName)) {return res.status(400).json({ error: "Name contains invalid characters" });}

    const candidatePath = resolve(CANDIDATES_DIR, `${speakerId}.json`);
    if (!candidatePath.startsWith(resolve(CANDIDATES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(candidatePath)) {return res.status(404).json({ error: `Candidate ${speakerId} not found` });}

    const candidate = JSON.parse(await readFile(candidatePath, "utf-8"));
    if (candidate.status !== "pending_review") {
      return res.status(400).json({ error: `Candidate already ${candidate.status}` });
    }

    const profile = {
      name: sanitizedName,
      enrolledAt: new Date().toISOString(),
      enrollmentMethod: "automatic",
      originalSpeakerId: speakerId,
      numSamples: candidate.num_samples || candidate.numSamples || 1,
      embeddingDimensions: (candidate.avg_embedding || []).length,
      embeddings: [candidate.avg_embedding],
      threshold: 0.25,
      metadata: { variance: candidate.variance, auto_enrolled_from: candidate.created_at },
    };

    const profilePath = resolve(VOICE_PROFILES_DIR, `${sanitizedName}.json`);
    if (!profilePath.startsWith(resolve(VOICE_PROFILES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}
    await writeFile(profilePath, JSON.stringify(profile, null, 2));

    candidate.status = "approved";
    candidate.approved_at = new Date().toISOString();
    candidate.assigned_name = sanitizedName;
    await writeFile(candidatePath, JSON.stringify(candidate, null, 2));

    // Retroactive tagging: remove .synced markers so sync script re-processes affected transcripts
    try {
      const AUDIO_DONE = process.env.AUDIO_DONE_DIR || "/audio/done";
      const doneFiles = existsSync(AUDIO_DONE) ? readdirSync(AUDIO_DONE) : [];
      let retagged = 0;
      for (const file of doneFiles) {
        if (!file.endsWith(".synced")) {continue;}
        const jsonFile = file.replace(/\.synced$/, "");
        const jsonPath = join(AUDIO_DONE, jsonFile);
        if (!existsSync(jsonPath)) {continue;}
        try {
          const data = JSON.parse(await readFile(jsonPath, "utf-8"));
          const si = data.speaker_identification || {};
          const unidentified = si.unidentified || [];
          if (unidentified.some((s) => si.stable_ids?.[s] === speakerId)) {
            await unlink(join(AUDIO_DONE, file));
            retagged++;
          }
        } catch {}
      }
      console.log(`Retroactive tagging: ${retagged} transcripts marked for re-sync`);
    } catch (retagErr) {
      console.error("Retroactive tagging failed:", retagErr);
    }

    logActivity("voice", null, `Approved speaker candidate ${speakerId} as '${sanitizedName}'`);
    res.json({ ok: true, name: sanitizedName, message: `Speaker '${sanitizedName}' profile created.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /candidates/:speakerId/reject
router.post("/candidates/:speakerId/reject", async (req, res) => {
  try {
    const { speakerId } = req.params;
    if (!SAFE_SPEAKER_ID.test(speakerId)) {return res.status(400).json({ error: "Invalid speaker ID format" });}

    const candidatePath = resolve(CANDIDATES_DIR, `${speakerId}.json`);
    if (!candidatePath.startsWith(resolve(CANDIDATES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(candidatePath)) {return res.status(404).json({ error: `Candidate ${speakerId} not found` });}

    const candidate = JSON.parse(await readFile(candidatePath, "utf-8"));
    candidate.status = "rejected";
    candidate.rejected_at = new Date().toISOString();
    await writeFile(candidatePath, JSON.stringify(candidate, null, 2));

    logActivity("voice", null, `Rejected speaker candidate ${speakerId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /candidates/:speakerId
router.delete("/candidates/:speakerId", async (req, res) => {
  try {
    const { speakerId } = req.params;
    if (!SAFE_SPEAKER_ID.test(speakerId)) {return res.status(400).json({ error: "Invalid speaker ID format" });}

    const filePath = resolve(CANDIDATES_DIR, `${speakerId}.json`);
    if (!filePath.startsWith(resolve(CANDIDATES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(filePath)) {return res.status(404).json({ error: "Candidate not found" });}
    await unlink(filePath);
    logActivity("voice", null, `Deleted candidate: ${speakerId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /profiles — enrolled voice profiles
router.get("/profiles", async (req, res) => {
  try {
    if (!existsSync(VOICE_PROFILES_DIR)) {return res.json({ profiles: [] });}

    let audioFiles = [];
    for (const dir of [AUDIO_DIR, AUDIO_DONE_DIR]) {
      if (existsSync(dir)) {
        try { audioFiles.push(...await readdir(dir)); } catch {}
      }
    }
    const audioWithTs = audioFiles
      .filter((f) => f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".m4a"))
      .map((f) => {
        const m = f.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
        return m ? { file: f, time: new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).getTime() } : null;
      })
      .filter(Boolean);

    const files = await readdir(VOICE_PROFILES_DIR);
    const profiles = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (file) => {
          try {
            const content = await readFile(join(VOICE_PROFILES_DIR, file), "utf-8");
            const data = JSON.parse(content);

            const sampleAudio = [];
            const sampleTranscripts = [];
            for (const meta of (data.sample_metadata || data.samples || []).slice(0, 5)) {
              if (meta.audio_file) {
                sampleAudio.push(meta.audio_file);
              } else if (meta.timestamp && audioWithTs.length > 0) {
                const ts = new Date(String(meta.timestamp).replace(/([+-]\d{2}:\d{2})Z$/, "$1")).getTime();
                let closest = null, closestDiff = Infinity;
                for (const a of audioWithTs) {
                  const diff = Math.abs(a.time - ts);
                  if (diff < closestDiff) { closestDiff = diff; closest = a.file; }
                }
                sampleAudio.push(closestDiff <= 900000 ? closest : null);
              } else {
                sampleAudio.push(null);
              }
              sampleTranscripts.push(meta.transcript || null);
            }

            // Count transcripts featuring this speaker
            let transcriptCount = 0;
            try {
              const tFiles = await findFiles(VOICE_TRANSCRIPTS_DIR, ".json", 500);
              for (const tf of tFiles) {
                try {
                  const tc = await readFile(tf.path, "utf-8");
                  const td = JSON.parse(tc);
                  if (td.speakers?.some((s) => s.name === data.name)) {transcriptCount++;}
                } catch {}
              }
            } catch {}

            return {
              name: data.name,
              enrolledAt: data.enrolledAt,
              enrollmentMethod: data.enrollmentMethod || "manual",
              numSamples: data.numSamples,
              threshold: data.threshold,
              sampleAudio: sampleAudio.filter(Boolean),
              sampleTranscripts: sampleTranscripts.filter(Boolean),
              transcriptCount,
            };
          } catch {
            return null;
          }
        })
    );

    res.json({ profiles: profiles.filter((p) => p !== null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /profiles/:name
router.delete("/profiles/:name", async (req, res) => {
  try {
    const name = req.params.name.toLowerCase();
    if (!SAFE_NAME.test(name)) {return res.status(400).json({ error: "Invalid profile name format" });}

    const filePath = resolve(VOICE_PROFILES_DIR, `${name}.json`);
    if (!filePath.startsWith(resolve(VOICE_PROFILES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(filePath)) {return res.status(404).json({ error: "Profile not found" });}
    await unlink(filePath);
    logActivity("voice", null, `Deleted speaker profile: ${name}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /profiles/:name — rename speaker profile
router.patch("/profiles/:name", async (req, res) => {
  try {
    const oldName = req.params.name.toLowerCase();
    const { newName } = req.body;

    if (!SAFE_NAME.test(oldName)) {return res.status(400).json({ error: "Invalid profile name format" });}
    if (!newName || !newName.trim()) {return res.status(400).json({ error: "newName is required" });}
    const sanitized = newName.trim().toLowerCase();
    if (!SAFE_NAME.test(sanitized)) {return res.status(400).json({ error: "Invalid new name format" });}

    const oldPath = resolve(VOICE_PROFILES_DIR, `${oldName}.json`);
    const newPath = resolve(VOICE_PROFILES_DIR, `${sanitized}.json`);

    if (!oldPath.startsWith(resolve(VOICE_PROFILES_DIR) + "/") || !newPath.startsWith(resolve(VOICE_PROFILES_DIR) + "/")) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!existsSync(oldPath)) {return res.status(404).json({ error: "Profile not found" });}
    if (existsSync(newPath) && oldName !== sanitized) {return res.status(409).json({ error: "Name already exists" });}

    const content = JSON.parse(readFileSync(oldPath, "utf-8"));
    content.name = sanitized;
    writeFileSync(newPath, JSON.stringify(content, null, 2));
    if (oldName !== sanitized) {await unlink(oldPath).catch(() => {});}

    logActivity("voice", null, `Renamed speaker: ${oldName} → ${sanitized}`);
    res.json({ ok: true, name: sanitized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /audio/:filename — serve audio file (playback/ → inbox/ → done/ fallback)
router.get("/audio/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename format" });
    }

    // Check playback/ first (permanent storage for processed audio)
    const playbackPath = resolve(AUDIO_PLAYBACK_DIR, filename);
    if (playbackPath.startsWith(resolve(AUDIO_PLAYBACK_DIR) + "/") && existsSync(playbackPath)) {
      return res.sendFile(playbackPath);
    }

    // Fallback to inbox/ (in-progress files)
    const inboxPath = resolve(AUDIO_DIR, filename);
    if (inboxPath.startsWith(resolve(AUDIO_DIR) + "/") && existsSync(inboxPath)) {
      return res.sendFile(inboxPath);
    }

    // Fallback to done/ (legacy)
    const donePath = resolve(AUDIO_DONE_DIR, filename);
    if (donePath.startsWith(resolve(AUDIO_DONE_DIR) + "/") && existsSync(donePath)) {
      return res.sendFile(donePath);
    }

    return res.status(404).json({ error: "Audio file not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats — voice system statistics
router.get("/stats", async (req, res) => {
  try {
    const [transcripts, profiles, candidates] = await Promise.all([
      findFiles(VOICE_TRANSCRIPTS_DIR, ".json", 1000),
      existsSync(VOICE_PROFILES_DIR) ? readdir(VOICE_PROFILES_DIR) : [],
      existsSync(CANDIDATES_DIR) ? readdir(CANDIDATES_DIR) : [],
    ]);

    let pendingCount = 0;
    if (existsSync(CANDIDATES_DIR)) {
      for (const file of candidates.filter((f) => f.endsWith(".json"))) {
        try {
          const content = await readFile(join(CANDIDATES_DIR, file), "utf-8");
          const data = JSON.parse(content);
          if (data.status === "pending_review") {pendingCount++;}
        } catch {}
      }
    }

    const speakerCount = profiles.filter((f) => f.endsWith(".json")).length;
    res.json({
      totalTranscripts: transcripts.length,
      enrolledSpeakers: speakerCount,
      knownSpeakers: speakerCount,
      pendingCandidates: pendingCount,
      oldestTranscript: transcripts.length > 0 ? transcripts[transcripts.length - 1].mtime : null,
      newestTranscript: transcripts.length > 0 ? transcripts[0].mtime : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /pipeline/status — simplified pipeline status (alias)
router.get("/pipeline/status", async (_req, res) => {
  try {
    const AUDIO_DONE = process.env.AUDIO_DONE_DIR || join(process.env.HOME || "/root", "oasis-audio/done");
    const AUDIO_INBOX = process.env.AUDIO_INBOX_DIR || join(process.env.HOME || "/root", "oasis-audio/inbox");

    const [listenerHealth, doneFiles, inboxFiles] = await Promise.all([
      fetchContainerJSON("http://audio-listener:9001/health"),
      readdir(AUDIO_DONE).catch(() => []),
      readdir(AUDIO_INBOX).catch(() => []),
    ]);

    const jsonFiles = doneFiles.filter((f) => f.endsWith(".json") && !f.includes(".json."));
    const syncedSet = new Set(doneFiles.filter((f) => f.endsWith(".synced")).map((f) => f.replace(".synced", "")));
    const inboxPending = inboxFiles.filter((f) => f.endsWith(".wav")).length;
    const pendingSync = jsonFiles.filter((f) => !syncedSet.has(f)).length;

    const listenerOnline = listenerHealth?.status === "ok" || listenerHealth?.status === "running" || !!listenerHealth?.uptime;

    res.json({
      status: listenerOnline ? "running" : "offline",
      listener: listenerOnline ? "online" : "offline",
      inboxPending,
      transcribed: jsonFiles.length,
      synced: syncedSet.size,
      pendingSync,
      assemblyai: {
        pending: listenerHealth?.assemblyai?.pending || 0,
        activeJobs: listenerHealth?.assemblyai?.active_jobs?.length || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /pipeline — aggregated audio pipeline status
// Returns data shaped for the frontend stage cards, queue grid, and status dots.
router.get("/pipeline", async (req, res) => {
  try {
    const AUDIO_DONE = process.env.AUDIO_DONE_DIR || join(process.env.HOME || "/root", "oasis-audio/done");
    const AUDIO_INBOX = process.env.AUDIO_INBOX_DIR || join(process.env.HOME || "/root", "oasis-audio/inbox");
    const SYNC_LOG = join(CONFIG_DIR, "logs/transcript-sync.log");

    const [listenerHealth, doneFiles, inboxFiles] = await Promise.all([
      fetchContainerJSON("http://audio-listener:9001/health"),
      readdir(AUDIO_DONE).catch(() => []),
      readdir(AUDIO_INBOX).catch(() => []),
    ]);

    const jsonFiles = doneFiles.filter((f) => f.endsWith(".json") && !f.includes(".json."));
    const syncedSet = new Set(doneFiles.filter((f) => f.endsWith(".synced")).map((f) => f.replace(".synced", "")));
    const inboxPending = inboxFiles.filter((f) => f.endsWith(".wav")).length;

    const totalTranscribed = jsonFiles.length;
    const totalSynced = syncedSet.size;
    const pendingSync = jsonFiles.filter((f) => !syncedSet.has(f)).length;

    const h = listenerHealth || {};
    const aai = h.assemblyai || {};
    const sid = h.speaker_id || {};
    const listenerOnline = h.status === "listening" || h.status === "running" || h.status === "ok" || h.uptime_seconds > 0;

    // Count today's done files by checking modification time
    const today = new Date().toISOString().slice(0, 10);
    let doneToday = 0;
    let lastFileMtime = null;
    for (const f of jsonFiles) {
      try {
        const s = await stat(join(AUDIO_DONE, f));
        const fileDate = s.mtime.toISOString().slice(0, 10);
        if (fileDate === today) {doneToday++;}
        if (!lastFileMtime || s.mtime > lastFileMtime) {lastFileMtime = s.mtime;}
      } catch {}
    }

    // Count today's synced files
    let syncedToday = 0;
    for (const f of doneFiles.filter((f) => f.endsWith(".synced"))) {
      try {
        const s = await stat(join(AUDIO_DONE, f));
        if (s.mtime.toISOString().slice(0, 10) === today) {syncedToday++;}
      } catch {}
    }

    // Parse last sync timestamp from sync log (last line matching "Synced:")
    let lastSyncTime = null;
    try {
      const logContent = await readFile(SYNC_LOG, "utf-8");
      const lines = logContent.trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[sync\] Synced:/);
        if (m) {
          lastSyncTime = new Date(m[1]).toISOString();
          break;
        }
      }
    } catch {}

    // Compute error rate
    const totalSubmitted = (aai.submitted || 0) + (h.assemblyai_submitted || 0);
    const totalFailed = (aai.failed || 0) + (h.assemblyai_failed || 0);
    const errorRate = totalSubmitted > 0 ? totalFailed / totalSubmitted : 0;

    res.json({
      // Stage status dots
      microphone: { status: h.recording ? "active" : (listenerOnline ? "ok" : "offline") },
      listener: {
        status: listenerOnline ? "ok" : "offline",
        containerStatus: listenerOnline ? "Running" : "Offline",
        filesProcessedToday: doneToday,
        errorRate,
        lastFile: lastFileMtime ? lastFileMtime.toISOString() : null,
        recording: h.recording || false,
        uptime: h.uptime_seconds || 0,
        segmentsSaved: h.segments_saved || 0,
        segmentsDiscarded: h.segments_discarded_silent || 0,
        quietHours: h.quiet_hours || null,
        quietHoursActive: h.quiet_hours_active || false,
      },
      transcription: {
        status: (aai.pending || 0) > 0 ? "active" : (listenerOnline ? "ok" : "offline"),
        queueDepth: aai.pending || 0,
        avgProcessingTime: null, // not tracked by health endpoint
        lastProcessed: aai.last_completed || h.last_transcript_completed || null,
        submitted: aai.submitted || 0,
        completed: aai.completed || 0,
        failed: aai.failed || 0,
        costUsd: aai.cost_usd || 0,
        hoursTranscribed: aai.hours_transcribed || 0,
        activeJobs: aai.active_jobs || [],
      },
      speakerId: {
        status: sid.encoder_loaded ? "ok" : (sid.enabled ? "warn" : "off"),
        profilesLoaded: sid.enrolled_profiles ?? 0,
        profileNames: sid.profile_names || [],
        encoderLoaded: sid.encoder_loaded || false,
        identificationRate: null, // would need historical data
        lastMatched: null, // not tracked
        unknownTracked: sid.unknown_tracked || 0,
        unknownSamples: sid.unknown_samples || 0,
        pendingCandidates: sid.pending_candidates || 0,
      },
      curatorSync: {
        status: pendingSync > 0 ? "active" : "ok",
        syncedToday,
        pending: pendingSync,
        lastSync: lastSyncTime,
        totalTranscribed,
        totalSynced,
      },
      // Queue grid data
      queue: {
        inbox: inboxPending,
        processing: aai.pending || 0,
        doneToday,
        errors: totalFailed,
      },
      // Voice commands
      commands: {
        dispatched: h.commands_dispatched || 0,
        blocked: h.commands_blocked_speaker || 0,
        lastDispatched: h.last_command_dispatched || null,
      },
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

        let filesProcessed = 0, lastProcessed = null;
        try {
          const ledger = JSON.parse(await readFile(WATCH_FOLDER_LEDGER, "utf-8"));
          filesProcessed = Object.keys(ledger).length;
          const entries = Object.values(ledger);
          if (entries.length > 0) {
            lastProcessed = entries.toSorted((a, b) =>
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
          errors: 0,
        };
      })(),
      // Job manifest counts
      jobCounts: await (async () => {
        try {
          if (!existsSync(JOBS_FILE)) {return {};}
          const jobs = JSON.parse(await readFile(JOBS_FILE, "utf-8"));
          const counts = {};
          for (const job of Object.values(jobs)) {
            counts[job.status] = (counts[job.status] || 0) + 1;
          }
          return counts;
        } catch { return {}; }
      })(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs — return job queue manifest for pipeline observability
router.get("/jobs", async (req, res) => {
  try {
    if (!existsSync(JOBS_FILE)) {
      return res.json({ jobs: {}, counts: {} });
    }
    const jobs = JSON.parse(await readFile(JOBS_FILE, "utf-8"));

    // Compute status counts
    const counts = {};
    for (const job of Object.values(jobs)) {
      counts[job.status] = (counts[job.status] || 0) + 1;
    }

    res.json({ jobs, counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /conversations — paginated conversation list
router.get("/conversations", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    // Walk VOICE_TRANSCRIPTS_DIR for YYYY/MM/DD/conversations.json files
    const allConversations = [];

    async function walkForConversations(dir) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walkForConversations(fullPath);
          } else if (entry.name === "conversations.json") {
            try {
              const content = await readFile(fullPath, "utf-8");
              const data = JSON.parse(content);
              if (data.conversations && Array.isArray(data.conversations)) {
                for (const conv of data.conversations) {
                  conv._datePath = dir;
                  allConversations.push(conv);
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    if (existsSync(VOICE_TRANSCRIPTS_DIR)) {
      await walkForConversations(VOICE_TRANSCRIPTS_DIR);
    }

    // Sort by startTime descending (newest first)
    allConversations.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const total = allConversations.length;
    const start = (page - 1) * pageSize;
    const items = allConversations.slice(start, start + pageSize).map((c) => {
      const { _datePath, ...conv } = c;
      return conv;
    });

    res.json({ conversations: items, total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /conversations/:id — merged conversation timeline
router.get("/conversations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^conv-\d{8}-\d{6}$/.test(id)) {
      return res.status(400).json({ error: "Invalid conversation ID format" });
    }

    // Find the conversation across all date directories
    let conversation = null;
    let datePath = null;

    async function findConversation(dir) {
      if (conversation) {return;}
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (conversation) {break;}
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await findConversation(fullPath);
          } else if (entry.name === "conversations.json") {
            try {
              const content = await readFile(fullPath, "utf-8");
              const data = JSON.parse(content);
              if (data.conversations) {
                const found = data.conversations.find((c) => c.id === id);
                if (found) {
                  conversation = found;
                  datePath = dir;
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    if (existsSync(VOICE_TRANSCRIPTS_DIR)) {
      await findConversation(VOICE_TRANSCRIPTS_DIR);
    }

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Load all segment transcripts and merge utterances
    const allUtterances = [];
    const allSpeakers = new Set();
    let totalDuration = 0;
    let fullText = "";

    for (const segmentName of conversation.segments || []) {
      const segPath = join(datePath, segmentName);
      try {
        const content = await readFile(segPath, "utf-8");
        const data = JSON.parse(content);

        // Collect speakers
        for (const sp of data.speakers || []) {
          allSpeakers.add(sp.name || sp.id || "unknown");
        }

        // Collect utterances with segment offset
        for (const u of data.utterances || []) {
          allUtterances.push({
            speaker: u.speaker,
            text: u.text,
            start: u.start,
            end: u.end,
            segment: segmentName,
            segmentTimestamp: data.timestamp,
          });
        }

        totalDuration += data.duration || 0;
        if (data.transcript) {
          fullText += (fullText ? " " : "") + data.transcript;
        }
      } catch {}
    }

    // Sort utterances chronologically by segment timestamp + start offset
    allUtterances.sort((a, b) => {
      const tsA = new Date(a.segmentTimestamp || 0).getTime() + (a.start || 0) * 1000;
      const tsB = new Date(b.segmentTimestamp || 0).getTime() + (b.start || 0) * 1000;
      return tsA - tsB;
    });

    res.json({
      id: conversation.id,
      startTime: conversation.startTime,
      endTime: conversation.endTime,
      duration: conversation.duration,
      speakers: [...allSpeakers],
      transcriptCount: conversation.transcriptCount,
      totalWords: conversation.totalWords,
      transcript: fullText,
      utterances: allUtterances,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /ingestion/status — combined mic + watch folder ingestion status
router.get("/ingestion/status", async (req, res) => {
  try {
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

    let filesProcessed = 0;
    try {
      const ledger = JSON.parse(await readFile(WATCH_FOLDER_LEDGER, "utf-8"));
      filesProcessed = Object.keys(ledger).length;
    } catch {}

    let filesDetected = 0;
    try {
      const entries = await readdir(WATCH_FOLDER_SOURCE);
      filesDetected = entries.filter(f => /\.(wav|mp3|m4a|ogg|flac)$/i.test(f)).length;
    } catch {}

    const health = await fetchContainerJSON("http://audio-listener:9001/health");
    const micActive = health ? (health.recording || health.status === "listening" || health.status === "running") : false;

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

// POST /ingestion/microphone/toggle — pause/resume microphone recording
router.post("/ingestion/microphone/toggle", async (req, res) => {
  try {
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

// PUT /transcripts/:id/utterance — edit utterance text inline
router.put("/transcripts/:id/utterance", async (req, res) => {
  try {
    const { id } = req.params;
    const { utteranceIndex, text } = req.body;

    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {return res.status(400).json({ error: "Invalid transcript ID format" });}
    if (utteranceIndex == null || typeof utteranceIndex !== "number" || utteranceIndex < 0) {
      return res.status(400).json({ error: "Invalid utterance index" });
    }
    if (typeof text !== "string") {return res.status(400).json({ error: "Text must be a string" });}

    const files = await findFiles(VOICE_TRANSCRIPTS_DIR, `${id}.json`, 10);
    if (files.length === 0) {return res.status(404).json({ error: "Transcript not found" });}

    const filePath = files[0].path;
    const data = JSON.parse(await readFile(filePath, "utf-8"));

    if (!data.utterances || utteranceIndex >= data.utterances.length) {
      return res.status(400).json({ error: "Utterance index out of range" });
    }

    data.utterances[utteranceIndex].text = text;
    data.transcript = data.utterances.map(u => u.text).join(" ");

    await writeFile(filePath, JSON.stringify(data, null, 2));

    logActivity("voice", null, `Edited utterance ${utteranceIndex} in transcript ${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /profiles/create — create speaker profile from uploaded audio
router.post("/profiles/create", upload.single("audio"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {return res.status(400).json({ error: "Name is required" });}
    const sanitizedName = name.trim().toLowerCase();
    if (!SAFE_NAME.test(sanitizedName)) {return res.status(400).json({ error: "Invalid name format" });}

    if (!req.file) {return res.status(400).json({ error: "Audio file is required" });}

    const profilePath = resolve(VOICE_PROFILES_DIR, `${sanitizedName}.json`);
    if (!profilePath.startsWith(resolve(VOICE_PROFILES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}
    if (existsSync(profilePath)) {return res.status(409).json({ error: "Profile already exists" });}

    // Forward audio to audio-listener for embedding extraction
    let result;
    try {
      const audioBuffer = await readFile(req.file.path);
      const payload = JSON.stringify({ name: sanitizedName, audio_base64: audioBuffer.toString("base64"), filename: req.file.originalname || "audio.wav" });
      result = await new Promise((resolve, reject) => {
        const req2 = http.request(
          { hostname: "audio-listener", port: 9001, path: "/enroll-speaker", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
            timeout: 120_000 },
          (resp) => {
            let body = "";
            resp.on("data", d => body += d);
            resp.on("end", () => {
              try { resolve({ status: resp.statusCode, data: JSON.parse(body) }); }
              catch { reject(new Error(`Invalid JSON: ${body}`)); }
            });
          }
        );
        req2.on("error", reject);
        req2.on("timeout", () => { req2.destroy(); reject(new Error("Timeout")); });
        req2.write(payload);
        req2.end();
      });

      if (result.status !== 200) {throw new Error(result.data?.error || "Enrollment failed");}
    } catch (fetchErr) {
      // Fallback: create basic profile without embeddings if container unavailable
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
      await unlink(req.file.path).catch(() => {});
      logActivity("voice", null, `Created speaker profile '${sanitizedName}' (pending embedding)`);
      return res.json({ ok: true, name: sanitizedName, needsEmbedding: true });
    }

    await unlink(req.file.path).catch(() => {});
    logActivity("voice", null, `Created speaker profile '${sanitizedName}' via audio upload`);
    res.json({ ok: true, name: sanitizedName, ...result.data });
  } catch (err) {
    if (req.file) {await unlink(req.file.path).catch(() => {});}
    res.status(500).json({ error: err.message });
  }
});

// POST /candidates/merge — merge multiple candidates into a profile
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
      if (!SAFE_SPEAKER_ID.test(id)) {return res.status(400).json({ error: `Invalid candidate ID: ${id}` });}
    }

    let targetName;
    if (target.type === "new") {
      if (!target.name || !target.name.trim()) {return res.status(400).json({ error: "Name required for new profile" });}
      targetName = target.name.trim().toLowerCase();
      if (!SAFE_NAME.test(targetName)) {return res.status(400).json({ error: "Invalid name format" });}
    } else {
      if (!target.profileName) {return res.status(400).json({ error: "profileName required for existing target" });}
      targetName = target.profileName.toLowerCase();
    }

    const embeddings = [];
    const candidateFiles = [];
    for (const candidateId of candidateIds) {
      const candidatePath = resolve(CANDIDATES_DIR, `${candidateId}.json`);
      if (!candidatePath.startsWith(resolve(CANDIDATES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}
      if (!existsSync(candidatePath)) {return res.status(404).json({ error: `Candidate ${candidateId} not found` });}

      const data = JSON.parse(await readFile(candidatePath, "utf-8"));
      if (data.avg_embedding && Array.isArray(data.avg_embedding)) {
        embeddings.push(data.avg_embedding);
      }
      candidateFiles.push({ path: candidatePath, data, id: candidateId });
    }

    if (embeddings.length === 0) {
      return res.status(400).json({ error: "No embeddings found in selected candidates" });
    }

    const dim = embeddings[0].length;
    const avgEmb = new Array(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {avgEmb[i] += emb[i];}
    }
    for (let i = 0; i < dim; i++) {avgEmb[i] /= embeddings.length;}

    const norm = Math.sqrt(avgEmb.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {avgEmb[i] /= norm;}
    }

    const profilePath = resolve(VOICE_PROFILES_DIR, `${targetName}.json`);
    if (!profilePath.startsWith(resolve(VOICE_PROFILES_DIR) + "/")) {return res.status(403).json({ error: "Access denied" });}

    if (target.type === "existing") {
      if (!existsSync(profilePath)) {return res.status(404).json({ error: `Profile '${targetName}' not found` });}
      const profile = JSON.parse(await readFile(profilePath, "utf-8"));
      if (!profile.embeddings) {profile.embeddings = [];}
      profile.embeddings.push(avgEmb);
      profile.numSamples = (profile.numSamples || 0) + embeddings.length;
      await writeFile(profilePath, JSON.stringify(profile, null, 2));
    } else {
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

    for (const { path: cPath, data } of candidateFiles) {
      data.status = "merged";
      data.merged_at = new Date().toISOString();
      data.merged_into = targetName;
      await writeFile(cPath, JSON.stringify(data, null, 2));
    }

    try {
      const doneFiles = existsSync(AUDIO_DONE_DIR) ? await readdir(AUDIO_DONE_DIR) : [];
      let retagged = 0;
      for (const file of doneFiles) {
        if (!file.endsWith(".synced")) {continue;}
        await unlink(join(AUDIO_DONE_DIR, file)).catch(() => {});
        retagged++;
      }
      if (retagged > 0) {console.log(`Removed ${retagged} .synced markers for re-identification`);}
    } catch {}

    logActivity("voice", null, `Merged ${candidateIds.length} candidates into '${targetName}'`);
    res.json({ ok: true, name: targetName, mergedCount: candidateIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
