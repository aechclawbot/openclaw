# Oasis Voice Pipeline & Knowledge Dashboard Enhancements

## Context

We are upgrading the "Knowledge" section of the Oasis dashboard. The system currently ingests audio via an active room microphone, processes it through AssemblyAI, handles speaker identification, and syncs the output.

We need to add a new ingestion source (a synced Google Drive watch folder) with a specific non-destructive workflow, dramatically improve the UX/UI of the Transcripts and Speakers tabs to streamline how unknown speakers are labeled, and introduce manual pause controls for our ingestion streams.

## Phase 1: Backend - Watch Folder Integration & State Management

Add a backend service/worker to monitor a specific directory for pre-recorded audio files, and implement state controls for both ingestion methods.

- **Target Directory:** `/Users/oasis/Google Drive/My Drive/The Oasis - Personal AI Agent Framework/00_The_Library/Audio Recordings`
- **Workflow Constraints:**
  - **No Moving Files:** Do NOT move or delete the original files from the Google Drive folder.
  - **On-Demand Processing:** The system must copy the target file into a local, non-synced `temp` directory to force the download and ensure the file is fully available for processing.
  - **Cleanup:** Once successfully processed by the pipeline (transcription/speaker ID), delete the file from the local `temp` directory.
  - **Tracking Ledger:** Implement a persistent log file (e.g., `processed_audio_log.json` or a local SQLite table) that records the filenames or file hashes of successfully processed audio. The watcher must check this before processing to prevent duplicates.
- **Ingestion State Control (API):** Create API endpoints to toggle the `active`/`paused` state of both the Audio Listener (microphone) and the Watch Folder. If paused, the watcher should gracefully finish its current file but ignore any new files until resumed.

## Phase 2: UI - Dashboard & Pipeline Visualization

Update the "Voice Pipeline" tab to reflect the new dual-input architecture and state controls.

- **Pipeline Status Graphic:** Update the visual flow to show two parallel starting nodes: `Microphone` and `Google Drive Watch Folder`, both converging into the `Audio Listener` or `Ingestion Queue` node.
- **Audio Listener Card Updates:** Add a prominent "Pause/Resume" toggle or button to temporarily suspend microphone ingestion.
- **Watch Folder Status Card:** Add a new card under the main pipeline graphic specifically for the Watch Folder displaying:
  - Folder Path (truncated for UI).
  - Files detected vs. files processed (reading from the tracking ledger).
  - Current processing/download status.
  - A "Pause/Resume" toggle or button to temporarily stop pulling new files from Google Drive.

## Phase 3: UI - Transcripts View Improvements

The current Transcripts view needs to allow for rapid, context-driven corrections.

- **Inline Speaker Labeling:** Make the speaker tags (e.g., `SPEAKER_00`) clickable dropdowns. If a speaker is unknown or misidentified, a user should be able to click the tag directly on the transcript and select an enrolled speaker (e.g., `fred`, `monty`) to reassign it immediately.
- **Inline Text Editing:** Allow users to click on the transcript text to inline-edit it for transcription errors.
- **Audio Playback Context:** Ensure the playback functionality highlights or indicates the specific segment of audio tied to the transcript block, rather than just playing the entire file from the beginning.

## Phase 4: UI - Speaker Profiles View Improvements

Streamline how new profiles are created and how candidates are managed.

- **Create New Speaker via Upload:** On the "Speakers" tab, add a prominent button/option to "Create New Speaker Profile". This should open a modal allowing the user to type a new name and directly upload a fresh, clean audio file to establish the baseline voice signature threshold.
- **Candidate Audio Previews:** Add a small "Play" button directly inside the "Unidentified Candidates" cards. Users need to hear the audio sample associated with that cluster before they can "Approve" or "Reject" it.
- **Merge Candidates:** Allow the user to select multiple unidentified candidates and merge them into a single new or existing profile, as the system will occasionally split one person into multiple candidates.
