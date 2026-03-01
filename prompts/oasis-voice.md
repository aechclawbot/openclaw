# OASIS Dashboard: Full-Stack Cleanup & Feature Enhancement

## Main Objective

Perform a full-stack cleanup and feature enhancement on the OASIS dashboard's voice pipeline and knowledge management system.

---

## Execution Tasks

### 1. Analyze the Inbox

- **Action:** Locate the backend service or queue handling the "Inbox" (currently showing 380 items).
- **Deliverable:** Document exactly what these items are (e.g., raw audio files, webhook payloads) and explain the lifecycle of how they are processed through the pipeline.
- **Output:** Write findings in a file named `pipeline_analysis.md`.

### 2. Transcript Cleanup (< 10s audio)

- **Database:** Locate the schema/ORM models for Transcripts.
- **Scripting:** Write and execute a script to delete all transcripts associated with audio files shorter than 10 seconds.
- **UI Sync:** Ensure the frontend API calls and the "Transcripts" tab UI correctly reflect this deletion and update the "Total Transcripts" count.

### 3. Candidate Cleanup

- **Logic:** Locate the logic for "Pending Candidates".
- **Cleanup:** Remove all unidentified speaker candidates that currently have 0 sample audio files attached for labeling.
- **Database/UI:** Update the database and ensure the "Pending Candidates" UI metric updates accordingly.

### 4. Re-run Speaker Identification

- **Trigger:** Locate the batch processing or pipeline trigger script.
- **Execution:** Re-run all existing, valid audio and transcript files through the `Speaker ID` step of the pipeline to identify new speaker candidates.

### 5. Enable Audio Playback in UI

- **Frontend:** Navigate to the code for the "Speakers" tab on the Knowledge dashboard.
- **Feature Implementation:** \* Implement a UI feature (e.g., an HTML5 audio player or custom playback button) to enable playing sample audio clips for each enrolled speaker profile.
  - Ensure the audio player correctly fetches the audio file URL from the backend.
