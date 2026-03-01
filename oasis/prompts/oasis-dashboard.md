# OASIS Dashboard: Bug Fixes and UI/UX Improvements

## Context

You are tasked with fixing several critical bugs and UI/UX issues in the OASIS Dashboard web application. The exact frontend framework, styling library, and state management tools are currently unknown.

## Initial Step

Before making any code changes, thoroughly analyze the repository to identify the frontend framework (e.g., React, Vue, Svelte), the styling solution (e.g., Tailwind CSS, CSS Modules, styled-components), and how API calls and state are managed. Ensure all your fixes adhere to the project's existing architectural patterns.

---

## Task 1: Fix Raw JSON Leaking into the UI

Currently, the application is failing to parse custom API responses, resulting in raw JSON strings being rendered directly to the user interface instead of the generated AI text.

### Instance A: Agent Messaging

- **Reproduction:** Navigate to `Agents` > Select an Agent (e.g., Ogden Morrow) > Go to the `Message` tab > Type a message and hit Send.
- **Issue:** The UI renders a raw JSON string like `{"ok":true,"runId":"...","result":"..."}`.
- **Fix:** Locate the component and API call responsible for this view. Parse the JSON response, extract the actual AI message text (likely nested inside the `result` key), and render only the text.

### Instance B: Date Night Generator

- **Reproduction:** Navigate to `Household` > `Date Night` tab > Click the "Generate New Ideas for This Weekend" button.
- **Issue:** The exact same raw JSON string format is rendered in the UI below the button.
- **Fix:** Locate the click handler and API fetch for this button. Parse the response and correctly render the generated ideas.

---

## Task 2: Fix Global "Recipe not found" Error Toast

- **Reproduction:** Load the application and navigate to the `Home` or `Agents` pages.
- **Issue:** A red error toast stating "Recipe not found" appears in the bottom right corner on initial load, despite the user not interacting with any recipe-related features.
- **Fix:** Locate the background fetch responsible for recipes (likely associated with the `Household > Meal Plan` data). Handle this specific error gracefully. Either allow it to fail silently if no recipe is scheduled, or scope the error handling so it does not trigger a global toast notification on unrelated pages.

---

## Task 3: Resolve "Operation Aborted" in Knowledge Chat

- **Reproduction:** Navigate to `Knowledge` > `Library`. Open the AI Chat sidebar panel. Type a message (e.g., "tell me about this") and submit.
- **Issue:** The chat immediately returns a "This operation was aborted" error message.
- **Fix:** Investigate the specific API call executed by this sidebar component. Check for overly aggressive `AbortController` timeouts, unhandled promise rejections, or misconfigured API endpoints that are causing the request to terminate prematurely.

---

## Task 4: Improve Main Chat UI/UX (Loading States & Feedback)

- **Reproduction:** Navigate to the primary `Chat` section in the left navigation.
- **Issue 1 (Initial Load):** The page displays a plain text "Loading..." string.
- **Fix 1:** Replace this plain text with a modern skeleton loader, shimmer effect, or a loading spinner that matches the existing UI component library.
- **Issue 2 (Message Sending):** When a user types a message and hits enter, there is no immediate visual feedback.
- **Fix 2:** Implement optimistic UI updates so the user's chat bubble appears immediately after hitting send. Add a clear loading state (e.g., a "typing..." indicator or spinner in the chat feed) while waiting for the AI to respond.

---

## Task 5: Fix Data Density in Scan Summaries

- **Reproduction:** Navigate to `Business` > `Nolan Projects` (or similar project tabs). Scroll down to the "Recent Scan Summaries" section.
- **Issue:** The summaries are rendered as massive, unformatted walls of text, making the page difficult to read and navigate.
- **Fix:** Implement a text truncation component or CSS line-clamping. Limit the default view of these logs to roughly 3-5 lines. Add a "Show More / Show Less" toggle button to expand the text. If the text contains markdown, ensure a markdown parser is used so lists and bolding render correctly.

---

## Task 6: Polish Dropdown Styling

- **Reproduction:** Navigate to `Agents` > select an agent > `Info` tab. Look at the "Add fallback model..." dropdown.
- **Issue:** The `<select>` element lacks the polished styling seen on other inputs in the dashboard.
- **Fix:** Apply the project's standard form input styling (classes or styled components) to this dropdown so it matches the aesthetic of the surrounding UI.
