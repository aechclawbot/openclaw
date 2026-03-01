# Oasis Voice Pipeline: End-to-End Audit & Refactoring Instructions

## Objective

Perform a comprehensive discovery, audit, and refactor of the backend voice pipeline within the Oasis codebase. The ultimate goal is to establish a clean, unified back-end process for file handling and data routing from ingestion to final knowledge extraction, without breaking any existing dashboard functionalities.

## Step 1: Codebase Discovery & Audit

Before making any changes, explore the codebase to map the current state of the voice pipeline. Please identify and analyze:

- **Ingestion Points:** How and where the system currently handles incoming audio from the active Microphone and the Google Drive Watch Folder.
- **Storage & File Handling:** Where temporary files are currently written, copied, or stored during the transcription and diarization processes. Identify any redundant storage, orphaned files, or conflicting temp directories.
- **Data Flow & State Management:** How an audio job's state is tracked as it moves to AssemblyAI, returns with a transcript, goes through speaker identification, and is finally stored.
- **The Curator Handoff:** How and where transcripts are currently passed to "The Curator" for knowledge ingestion.

## Step 2: Propose a Refactoring Plan

Based on your discovery, outline a proposed refactoring plan and present it for approval before executing. The plan MUST adhere to the following architectural goals:

1. **Unified Processing Funnel:** All audio sources (Mic, Watch Folder, future inputs) should normalize into a single, standardized processing queue/format before being sent to AssemblyAI.
2. **Zero Redundancy:** Eliminate unnecessary file duplication. Define a single, secure ephemeral lifecycle for audio files (e.g., pulled to a temp location, processed, and strictly deleted upon AssemblyAI success). The original files in the Google Drive watch folder must remain untouched. There should be a final folder where live audio files >10s are saved for playback in dashboard.
3. **Dashboard Integrity:** The current UI (Transcripts, Speakers, Pipeline visualization) must remain perfectly functional. Ensure database schemas or API payloads required by the frontend are maintained or safely migrated.
4. **THE CURATOR RULE (Critical):** The logic governing the handoff to The Curator must be absolute. **Only fully diarized transcripts (where every speaker is identified and enrolled) may be pushed to The Curator.** If a transcript contains _any_ unknown speakers, it must be held in a pending state for human review and ONLY pushed to The Curator once manually resolved in the dashboard.

## Step 3: Execution

Once the proposed plan is approved, implement the refactoring step-by-step.

- Add robust error handling to ensure failed AssemblyAI jobs don't leave orphaned files in the temp directory.
- Ensure the tracking ledger for the Google Drive watch folder operates independently of the temp-
