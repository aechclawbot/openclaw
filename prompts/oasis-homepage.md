# Role and Objective

You are an expert frontend engineer and UI/UX designer. Your objective is to completely overhaul the Home Page (`/home` route) of the OASIS multi-agent dashboard.

The current home page is too static, functioning like a directory of agents and a raw log feed. We are shifting this to an **Action-Driven Command Center**. The new UI must prioritize immediate interactions with the primary OASIS agent, surface only actionable alerts, and provide a highly glanceable daily briefing without requiring the user to click into sub-modules.

# Layout Architecture (CSS Grid / Flexbox)

Implement a modern, responsive, two-column asymmetric layout for desktop (stacking gracefully on mobile):

- **Left Column (Primary Focus - 60-65% width):** Dedicated entirely to direct interaction and immediate actions.
- **Right Column (Context & Briefing - 35-40% width):** Dedicated to glanceable system health, business pipelines, and household daily plans.

---

# Component UI/UX Specifications

## 1. Direct OASIS Chat Interface (Left Column - Top)

This replaces the concept of clicking into the `/chat` route for the primary agent. It should feel like a built-in terminal or direct comms line.

- **UI Design:** A clean, card-based chat interface. It should not take up the entire vertical height but should be prominent.
- **Behavior:** \* Display the last 3-4 messages from the active session for context.
  - The input field must be permanently sticky at the bottom of this component.
  - Pressing `Enter` should immediately dispatch the prompt to the OASIS agent.
  - Ensure loading states (e.g., a pulsing indicator or typing skeleton) are visible while OASIS processes the request.
- **Empty State:** If there is no active session today, display a faint, welcoming placeholder from OASIS (e.g., "Gateway connected. What are we tackling today?").

## 2. Actionable Activity & Alerts (Left Column - Bottom)

Replace the current raw "Activity Feed" with a heavily filtered "Action Center" or "Inbox."

- **Data Filtering:** Do NOT show standard routing or system logs. ONLY surface items that require human review or awareness:
  - Failing Cron jobs (e.g., "Nolan failing Clearlancer scan").
  - Completed high-value agent tasks requiring review (e.g., "Anorak completed Morning News Brief - Review ready").
  - New leads or deals identified in the pipeline.
- **UI Design:** A list component where each item has a distinct visual priority (e.g., Red left-border for errors, Blue for review).
- **UX/Interactivity:** Every item _must_ have a clear Call to Action (CTA) button next to it. For example, a failing cron should have a "View Logs" or "Retry" button. A completed brief should have a "Read" button that opens a modal or links directly to the Knowledge base.

## 3. The Daily Briefing (Right Column)

This section curates data from the broader system to give a snapshot of the current day. Use compact, highly legible card components.

### A. System Health (Top Right)

- **UI Design:** A very compact, horizontal flex row.
- **Data:** Gateway status (Connected/Green dot), overall system uptime, and a simplified CPU/Memory sparkline or percentage indicator (pulling from Docker/Analytics data).

### B. Household Snapshot (Middle Right)

- **Data:** Pull today's data from the Household module.
- **UI Design:** A clean card highlighting "Today's Plan."
  - Show today's Meal Plan (e.g., pulling Anorak's generated recipe/plan for the family).
  - Include a small pill/badge if today is flagged as "Date Night."
- **Empty State:** If no meal is planned, display a subtle "No meals planned for today" with a quick-link button saying "Ask Anorak to plan."

### C. Business & Pipeline Overview (Bottom Right)

- **Data:** Pull top-level metrics from the Business module.
- **UI Design:** A split-metric card or compact list.
  - Display the current aggregate `Treasury Balance`.
  - Display a compact counter of active items in the Site Pipeline (e.g., "2 Demos Built", "1 Pitched") and active Arch Deals.
  - Keep it read-only for at-a-glance awareness, relying on the Actionable Alerts section to prompt specific deal reviews.

---

# Execution & Refactoring Steps

1.  **Analyze Data Hooks:** Review how data is currently fetched in the `/chat`, `/business`, `/household`, and `/operations` routes.
2.  **State Management:** Import and utilize these existing hooks into the new `/home` layout. Ensure that data fetching is optimized and doesn't cause excessive re-renders.
3.  **Component Extraction:** If necessary, break down the newly designed sections into smaller, reusable React components (e.g., `<QuickChat />`, `<ActionableAlertList />`, `<DailyBriefCard />`) within a `components/home` directory to keep the main page file clean.
4.  **Graceful Degradation:** Ensure all new widgets have proper skeleton loaders for their loading states and elegant fallback text for null/empty data states.
5.  **Strict Typing & Linting:** Adhere strictly to the project's existing TypeScript interfaces and UI component library (e.g., Tailwind classes, existing Card/Button components). Run `npm run lint` or equivalent after refactoring.
