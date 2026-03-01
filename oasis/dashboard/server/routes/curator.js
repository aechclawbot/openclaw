/**
 * OASIS Dashboard v3 - Curator Routes
 * Knowledge base search, file read/write, AI chat, file tree.
 */

import { Router } from "express";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join, resolve } from "path";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// GET /stats — curator library statistics
router.get("/stats", async (req, res) => {
  try {
    const curatorDir = join(CONFIG_DIR, "workspace-curator");
    const libraryDir = join(curatorDir, "library");
    const transcriptsDir = join(curatorDir, "transcripts");
    const profilesDir = join(curatorDir, "profiles");

    let libraryFiles = 0;
    let librarySize = 0;
    let transcriptFiles = 0;
    let profileFiles = 0;

    async function countFiles(dir) {
      let count = 0;
      let size = 0;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            const sub = await countFiles(fullPath);
            count += sub.count;
            size += sub.size;
          } else if (entry.isFile()) {
            count++;
            const s = await stat(fullPath).catch(() => null);
            if (s) {size += s.size;}
          }
        }
      } catch {}
      return { count, size };
    }

    if (existsSync(libraryDir)) {
      const result = await countFiles(libraryDir);
      libraryFiles = result.count;
      librarySize = result.size;
    }
    if (existsSync(transcriptsDir)) {
      const result = await countFiles(transcriptsDir);
      transcriptFiles = result.count;
    }
    if (existsSync(profilesDir)) {
      const result = await countFiles(profilesDir);
      profileFiles = result.count;
    }

    res.json({
      library: { files: libraryFiles, sizeBytes: librarySize },
      transcripts: { files: transcriptFiles },
      profiles: { files: profileFiles },
      totalFiles: libraryFiles + transcriptFiles + profileFiles,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /search — search knowledge base
router.get("/search", (req, res) => {
  const query = (req.query.q || "").toLowerCase().trim();
  if (!query) {return res.json({ results: [] });}

  try {
    const curatorDir = join(CONFIG_DIR, "workspace-curator");
    const results = [];
    let fileCount = 0;
    const FILE_LIMIT = 5000;

    function searchDir(dir, relPath = "") {
      if (!existsSync(dir)) {return;}
      if (fileCount >= FILE_LIMIT) {return;}
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (fileCount >= FILE_LIMIT) {return;}
        if (entry.name.startsWith(".")) {continue;}
        const fullPath = join(dir, entry.name);
        const rel = relPath ? `${relPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          searchDir(fullPath, rel);
        } else if (/\.(md|txt|json)$/i.test(entry.name)) {
          fileCount++;
          try {
            const content = readFileSync(fullPath, "utf-8");
            if (content.toLowerCase().includes(query)) {
              const lines = content.split("\n");
              const matches = [];
              lines.forEach((line, i) => {
                if (line.toLowerCase().includes(query)) {
                  matches.push({ line: i + 1, text: line.trim().substring(0, 200) });
                }
              });
              results.push({ file: rel, matches: matches.slice(0, 5), totalMatches: matches.length });
            }
          } catch {}
        }
      }
    }

    searchDir(join(curatorDir, "library"), "library");
    searchDir(join(curatorDir, "transcripts"), "transcripts");
    searchDir(join(curatorDir, "profiles"), "profiles");
    searchDir(join(curatorDir, "logs"), "logs");

    res.json({ results: results.slice(0, 30), query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /file — read a curator document
router.get("/file", (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {return res.status(400).json({ error: "path required" });}

  const curatorDir = resolve(join(CONFIG_DIR, "workspace-curator"));
  // Try the path as-is first (relative to curator dir), then try under library/
  let fullPath = resolve(join(curatorDir, filePath));

  if (!fullPath.startsWith(curatorDir + "/")) {
    return res.status(403).json({ error: "Access denied" });
  }

  // If the file doesn't exist at the direct path, try under library/
  // (the tree endpoint returns paths relative to library/, so this is the common case)
  if (!existsSync(fullPath)) {
    const libraryPath = resolve(join(curatorDir, "library", filePath));
    if (libraryPath.startsWith(curatorDir + "/") && existsSync(libraryPath)) {
      fullPath = libraryPath;
    }
  }

  try {
    if (!existsSync(fullPath)) {return res.status(404).json({ error: "File not found" });}

    // Detect binary files by extension
    const textExts = new Set([
      "md", "txt", "json", "yaml", "yml", "csv", "html", "xml",
      "js", "py", "ts", "sh", "conf", "cfg", "env", "log", "toml",
    ]);
    const ext = (fullPath.split(".").pop() || "").toLowerCase();
    if (!textExts.has(ext)) {
      return res.json({ path: filePath, content: null, binary: true, message: "Binary file — cannot display" });
    }

    const content = readFileSync(fullPath, "utf-8");
    res.json({ path: filePath, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /file — write/update a curator document (library files only)
router.put("/file", (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) {return res.status(400).json({ error: "path required" });}
  if (content === undefined) {return res.status(400).json({ error: "content required" });}

  const curatorDir = resolve(join(CONFIG_DIR, "workspace-curator"));
  // Try direct path first, then under library/
  let fullPath = resolve(join(curatorDir, filePath));
  const libraryDir = resolve(join(curatorDir, "library"));

  // If direct path is not under library, try prepending library/
  if (!fullPath.startsWith(libraryDir + "/")) {
    fullPath = resolve(join(libraryDir, filePath));
  }

  // Only allow writes within the library directory
  if (!fullPath.startsWith(libraryDir + "/")) {
    return res.status(403).json({ error: "Only library files can be written" });
  }

  try {
    writeFileSync(fullPath, content, "utf-8");
    res.json({ ok: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tree — file tree of library directory
router.get("/tree", async (req, res) => {
  try {
    const libraryDir = join(CONFIG_DIR, "workspace-curator", "library");
    if (!existsSync(libraryDir)) {return res.json({ tree: [] });}

    async function buildTree(dir, relBase = "", depth = 0, maxDepth = 8) {
      if (depth >= maxDepth) {return [];}
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const nodes = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) {continue;}
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const children = await buildTree(join(dir, entry.name), rel, depth + 1, maxDepth);
          nodes.push({ name: entry.name, path: rel, type: "directory", children });
        } else {
          const s = await stat(join(dir, entry.name)).catch(() => null);
          nodes.push({ name: entry.name, path: rel, type: "file", size: s?.size || 0 });
        }
      }
      return nodes.toSorted((a, b) => {
        // Directories first, then files, both alphabetically
        if (a.type !== b.type) {return a.type === "directory" ? -1 : 1;}
        return a.name.localeCompare(b.name);
      });
    }

    const tree = await buildTree(libraryDir);
    res.json({ tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /chat — SSE streaming AI chat via Gemini 2.5 Flash
router.post("/chat", async (req, res) => {
  const { message, context, history } = req.body;
  if (!message) {return res.status(400).json({ error: "message required" });}
  if (!GEMINI_API_KEY) {return res.status(500).json({ error: "GEMINI_API_KEY not configured" });}

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  try {
    const systemText = [
      "You are a knowledge base assistant for the OASIS system.",
      "Answer questions based ONLY on the document content provided below.",
      "Do not fabricate information — if the answer is not in the document, say so.",
      "Be concise and helpful. Use markdown formatting.",
      "",
      "--- DOCUMENT ---",
      context || "(no document loaded)",
      "--- END DOCUMENT ---",
    ].join("\n");

    const contents = [];
    if (history?.length) {
      for (const h of history) {
        contents.push({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.text }],
        });
      }
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        signal: abortController.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: { temperature: 0.3 },
        }),
      }
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.write(`data: ${JSON.stringify({ type: "error", text: `Gemini API error ${apiRes.status}: ${errText.substring(0, 200)}` })}\n\n`);
      res.end();
      return;
    }

    let buffer = "";
    for await (const chunk of apiRes.body) {
      buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) {continue;}
        const data = line.slice(6).trim();
        if (!data) {continue;}
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {res.write(`data: ${JSON.stringify({ type: "token", text })}\n\n`);}
        } catch {}
      }
    }

    // Flush any remaining buffer
    if (buffer.startsWith("data: ")) {
      const data = buffer.slice(6).trim();
      if (data) {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {res.write(`data: ${JSON.stringify({ type: "token", text })}\n\n`);}
        } catch {}
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    try {
      res.write(`data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`);
      res.end();
    } catch {}
  }
});

// GET /insights — recently updated knowledge files + profile activity
router.get("/insights", async (req, res) => {
  try {
    const curatorDir = join(CONFIG_DIR, "workspace-curator");
    const fredDir = join(curatorDir, "library", "fred");
    const profilesDir = join(curatorDir, "profiles");

    // Get recently modified Fred library files
    const fredFiles = [];
    if (existsSync(fredDir)) {
      for (const name of readdirSync(fredDir)) {
        if (!name.endsWith(".md")) {continue;}
        try {
          const fullPath = join(fredDir, name);
          const s = await stat(fullPath);
          fredFiles.push({ name, path: `library/fred/${name}`, modified: s.mtime, size: s.size });
        } catch {}
      }
    }
    fredFiles.sort((a, b) => b.modified - a.modified);

    // Get recently modified people profiles
    const profiles = [];
    if (existsSync(profilesDir)) {
      for (const name of readdirSync(profilesDir)) {
        if (!name.endsWith(".md")) {continue;}
        try {
          const fullPath = join(profilesDir, name);
          const s = await stat(fullPath);
          // Read first few lines for summary
          const content = readFileSync(fullPath, "utf-8");
          const firstLines = content.split("\n").slice(0, 5).join(" ").slice(0, 150);
          profiles.push({
            name: name.replace(".md", "").replace(/-/g, " "),
            path: `profiles/${name}`,
            modified: s.mtime,
            preview: firstLines,
          });
        } catch {}
      }
    }
    profiles.sort((a, b) => b.modified - a.modified);

    // Get recent voice transcript count (last 7 days)
    const voiceDir = join(curatorDir, "transcripts", "voice");
    let recentTranscripts = 0;
    const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
    if (existsSync(voiceDir)) {
      const years = readdirSync(voiceDir).filter(d => /^\d{4}$/.test(d));
      for (const y of years) {
        const months = readdirSync(join(voiceDir, y)).filter(d => /^\d{2}$/.test(d));
        for (const m of months) {
          const days = readdirSync(join(voiceDir, y, m)).filter(d => /^\d{2}$/.test(d));
          for (const d of days) {
            const dayDir = join(voiceDir, y, m, d);
            try {
              const files = readdirSync(dayDir).filter(f => f.endsWith(".json") && f !== "conversations.json");
              for (const f of files) {
                try {
                  const s = await stat(join(dayDir, f));
                  if (s.mtime.getTime() > sevenDaysAgo) {recentTranscripts++;}
                } catch {}
              }
            } catch {}
          }
        }
      }
    }

    res.json({
      fredLibrary: fredFiles.slice(0, 10),
      recentProfiles: profiles.slice(0, 10),
      recentTranscriptCount: recentTranscripts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
