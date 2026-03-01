# OASIS Dashboard Tools Page - Process Flow Overhaul

**Context & Goal:** Spawn the necessary agent roles to overhaul the process flow on the OASIS dashboard "Tools" page. The goal is to create a robust, interactive pipeline for task generation, AI-driven planning, user approval, scheduled execution, and automated post-execution routines.

## Phase 1: Layout & Navigation Updates

- **Tab Restructuring:** Extract the "Run Ops Check" action from its current location inside the Tasks view and promote it to a top-level tab. The new tab order should be: `Tasks` | `Ops Check` | `QA Audit` | `Security Audit`.
- **Default Filtering:** Update the `STATUS` filter logic on the Tasks tab so that "Completed" tasks are hidden by default on initial load. They should only appear if the user explicitly toggles the "Completed" or "All" status filters.

## Phase 2: Audit Integration & Task Generation

- **Unify Audit Outputs:** Verify and enforce that the Ops Check, QA Audit, and Security Audit routines all reliably map their findings into the unified Tasks list.
- **Skill Integration:** Ensure the QA Audit and Security Audit are fully integrated into the existing `/skills` execution framework that was established for the Ops Check. All three should generate well-formatted pending tasks with appropriate priority and context tags.

## Phase 3: Backend & Data Model Updates

Update the backend Task data model/schema to support the new workflow and scheduling capabilities. Add the following fields:

- `execution_plan` (to store Claude's generated plan)
- `execution_report` (to store the final output/logs after a run)
- `approval_status` (e.g., _pending_plan_, _pending_approval_, _approved_, _rejected_)
- `scheduled_time` (timestamp to store scheduled execution or planning times)
- `run_post_op` (boolean to flag if the `/oasis-op` command should run automatically upon successful execution)

## Phase 4: The Planning & Execution Workflow (UI & Logic)

- **The "Plan" Action:** For tasks in the Pending state, replace the immediate "Run" button with a "Generate Plan" button. Include a "Schedule Plan" option (date/time picker) to allow the planning process to run at a later, specified time.
- **AI Planning Phase:** When "Generate Plan" is clicked (or the scheduled time is reached), trigger Claude to run the planning process in the background with full permissions. Implement a visual loading state (e.g., a spinner or "Planning..." badge) on the task card so the user knows it's working.
- **Review & Approve:** Once the plan is generated, transition the task to a _Planning_ or _Review_ state. Provide a UI element (e.g., an expandable section or a modal) to view and edit the generated plan.
- **Approval Options:** Include an "Approve & Run Now" button, an "Approve & Schedule Execution" button (with date/time picker), and a checkbox option labeled "Run `/oasis-op` after execution".
- **Execution Phase:** When an approved plan is executed (either immediately or at its scheduled time), ensure the backend process runs with the necessary full permissions. Transition the status to _Executing_.
- **Post-Execution Trigger:** Upon successful completion of the execution, check the `run_post_op` flag. If true, automatically execute the `/oasis-op` command.
- **Reporting:** Upon completion (success or failure), append the detailed execution report to the task view in the dashboard so the user can review exactly what was done, including the output of the `/oasis-op` run if it was triggered.

## Phase 5: Task Remediation & Re-runs

- **Re-run Planning:** Add a "Re-plan" button for tasks, allowing the user to discard the current plan and prompt Claude to generate a new one from scratch.
- **Re-run Failures:** For tasks that end up in the _Failed_ state, add a "Retry" or "Re-run" button that executes the approved plan again. Ensure the execution report appends the new logs rather than completely overwriting the old failure logs, or clearly separates the attempts.

## Phase 6: Validation

Run a full end-to-end test of the pipeline to verify all new features:

1.  Trigger an audit -> Generate a task.
2.  Schedule the plan generation -> Verify it generates at the scheduled time.
3.  Edit the plan -> Approve & Schedule Execution.
4.  Select the option to run `/oasis-op` after execution.
5.  Wait for the scheduled execution -> Verify the execution report appears, the status updates correctly, and the `/oasis-op` routine runs and logs successfully.
