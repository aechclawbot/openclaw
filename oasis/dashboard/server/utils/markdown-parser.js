/**
 * OASIS Dashboard v3 - Markdown Pipeline Parser
 * Parses Dito pipeline.md (markdown table) to/from JSON.
 */

import { readFileSync, writeFileSync } from "fs";

/**
 * Parse a pipeline.md markdown table into an array of lead objects.
 * Expected format: Business Name | Type | Location | Status | Contact | Notes | Date Added | Website
 */
export function parsePipelineMd(content) {
  const lines = content.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) {return [];}

  // Skip header row (index 0) and separator row (index 1)
  return lines.slice(2).map((line, idx) => {
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    return {
      index: idx,
      name: cols[0] || "",
      type: cols[1] || "",
      location: cols[2] || "",
      status: cols[3] || "qualified",
      contact: cols[4] || "",
      notes: cols[5] || "",
      dateAdded: cols[6] || "",
      website: cols[7] || "",
    };
  });
}

/**
 * Serialize an array of lead objects back to pipeline.md format.
 */
export function writePipelineMd(filePath, leads) {
  const header =
    "Business Name | Type | Location | Status | Contact | Notes | Date Added | Website\n" +
    "---|---|---|---|---|---|---|---\n";
  const rows = leads
    .map(
      (l) =>
        `${l.name} | ${l.type} | ${l.location} | ${l.status} | ${l.contact} | ${l.notes} | ${l.dateAdded} | ${l.website || ""}`
    )
    .join("\n");
  writeFileSync(filePath, header + rows + "\n");
}

/** Read and parse a pipeline.md file. Returns [] if missing. */
export function readPipelineMd(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    return parsePipelineMd(content);
  } catch {
    return [];
  }
}
