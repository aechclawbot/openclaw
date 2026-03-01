# OASIS Dashboard v3 -- Frontend QA Audit

**Date:** 2026-02-28
**Scope:** All shell, shared, and page components; CSS; index.html; index.v2.html
**Auditor:** Claude Code (automated static analysis)

---

## CRITICAL

### C-01: `page-agent-detail.js` is not routed and unreachable

**File:** `/components/pages/page-agent-detail.js`
**Description:** The `page-agent-detail` component is registered (`customElements.define`) and exists on disk, but `PAGE_MAP` in `oasis-app.js` maps `/agents/:id` to `page-agents.js`, returning tag `page-agents` -- never `page-agent-detail`. The `page-agent-detail` component is dead code that never loads.
**Impact:** If the intent was a dedicated detail page for agents, it is unreachable. If `page-agents` handles the `:id` param internally, the standalone detail page is orphaned.
**Fix:** Either remove `page-agent-detail.js` or add a route entry that imports and returns `page-agent-detail`.

### C-02: XSS risk via `.innerHTML` binding with user-controlled markdown

**Files:** `page-chat.js:789`, `page-agents.js:860,1085,1126`, `page-knowledge.js:2306,2324,2334,2362,2419`, `page-tools.js:1176,1417,1600,1604,1644`, `page-household.js:1337,1834`, `page-spawn.js:1163,1553`, `oasis-markdown.js:156`
**Description:** Multiple components use Lit's `.innerHTML=` binding with the output of local `renderMarkdown()` functions. While these functions escape HTML first, the subsequent regex-based transforms re-introduce raw HTML tags (`<a>`, `<strong>`, `<em>`, `<code>`, `<table>`, etc.). If any markdown transform has a regex bypass (e.g., nested/malformed input), raw HTML could be injected. Each page has its own copy of `renderMarkdown`, and they differ in robustness -- some block dangerous URL schemes, some do not block `blob:` URLs, and the `page-spawn.js` version does not sanitize links at all.
**Impact:** A malicious agent response or workspace file containing crafted markdown could execute scripts in the dashboard.
**Fix:** Consolidate to a single, well-tested markdown renderer (or use the `oasis-markdown` shared component everywhere). Consider using DOMPurify or a trusted sanitizer as a final pass before `.innerHTML`.

### C-03: `oasis-app.js` has an undeclared `_loadError` reactive property

**File:** `/components/shell/oasis-app.js`
**Description:** `_loadError` is used in `_renderPageContent()` (line 299) and set in `_loadPage()` (lines 357, 362, 374), but it is not declared in `static properties`. Lit will not trigger a re-render when `_loadError` changes because it is not tracked as a reactive property.
**Impact:** When a page fails to load (404 or import error), the error message may not render. The user sees a perpetual spinner or blank page instead of the error state.
**Fix:** Add `_loadError: { type: String, state: true }` to `static properties`.

### C-04: `oasis-app.js` silently swallows page load errors

**File:** `/components/shell/oasis-app.js:370-378`
**Description:** When a dynamic page import fails (e.g., the `.js` file does not exist), the catch block sets `_currentTag = null` and `_loadError = null` and instead sets `this._stubPage`. But `_stubPage` is never declared as a reactive property and is never rendered by `_renderPageContent()`. The user sees the initial spinner indefinitely.
**Impact:** Any missing page module silently fails with no user feedback. Combined with C-03, the error recovery path is completely broken.
**Fix:** In the catch block, set `_loadError` to a descriptive message (e.g., the error's message) so the error UI renders. Remove the unused `_stubPage` field.

---

## HIGH

### H-01: Duplicated `renderMarkdown()` implementations across 7 files

**Files:** `page-home.js`, `page-agents.js`, `page-chat.js`, `page-knowledge.js`, `page-tools.js`, `page-household.js`, `page-spawn.js`
**Description:** Seven separate, divergent markdown renderers exist. They vary in feature support (tables, strikethrough, auto-links), URL sanitization rigor, and edge-case handling. There is also a shared `oasis-markdown.js` component that none of the pages use.
**Impact:** Maintenance burden; inconsistent rendering across pages; higher XSS surface area.
**Fix:** Extract a single `renderMarkdown()` utility module (or use `oasis-markdown.js` consistently). Delete per-page copies.

### H-02: Duplicated `timeAgo()` helper in 8 files

**Files:** `page-home.js`, `page-agents.js`, `page-agent-detail.js`, `page-operations.js`, `page-knowledge.js`, `page-analytics.js`, `page-business.js`, `page-tools.js`
**Description:** Each page re-declares its own `timeAgo()` (and often `escapeHtml()`, `formatDuration()`, etc.) with slightly different semantics (some return `'never'`, others `'--'`, some handle malformed timestamps, others do not).
**Impact:** Inconsistent display of relative timestamps. Bug fixes in one copy don't propagate.
**Fix:** Create a shared `utils.js` module with canonical implementations.

### H-03: Native `alert()` and `confirm()` used for error reporting

**Files:** `page-operations.js` (9 occurrences), `page-agents.js` (5 occurrences), `page-knowledge.js` (7 occurrences)
**Description:** Browser-native `alert()` and `confirm()` are used for error messages and destructive action confirmation. The dashboard has purpose-built `oasis-toast` and `oasis-confirm` components.
**Impact:** Breaks the visual design; blocks the main thread; no styling control; poor UX on mobile; inconsistent with the rest of the dashboard that uses toasts.
**Fix:** Replace `alert()` with `showToast(msg, 'error')` and `confirm()` with `OasisConfirm.show()`.

### H-04: `oasis-sidebar.js` leaks route subscription

**File:** `/components/shell/oasis-sidebar.js:210`
**Description:** `connectedCallback` subscribes to route changes via `router.onChange()`, but `disconnectedCallback` has a comment noting "Router doesn't have removeChangeListener" and does nothing. The `router.onChange()` return value (unsub function) is stored but never called.
**Impact:** If the sidebar is ever unmounted and remounted (unlikely but possible in testing or future refactors), old listeners accumulate, causing stale updates and memory leaks.
**Fix:** Call `this._routeListener` unsub in `disconnectedCallback`, or use the stored reference: `if (this._routeUnsub) this._routeUnsub()`.

### H-05: `page-home.js` declares `static styles` twice

**File:** `/components/pages/page-home.js:754`
**Description:** `PageHome` has two `static styles = css\`...\`` declarations. The first (implicit, at class body top) is overridden by the second at line 754. In JavaScript class bodies, duplicate static field declarations are valid but only the last one takes effect -- the first is silently discarded.
**Impact:** Any styles intended in a first block would be lost. Currently both blocks exist and only the second (larger) one applies. This is confusing for maintainers.
**Fix:** Consolidate into a single `static styles` block.

### H-06: `oasis-confirm.js` Enter key always confirms, even when Cancel is focused

**File:** `/components/shared/oasis-confirm.js:243-247`
**Description:** The global `keydown` handler fires `_resolve(true)` on Enter regardless of which button has focus. If the user tabs to "Cancel" and presses Enter, the dialog confirms instead of canceling.
**Impact:** Destructive operations (delete cron job, delete session) could be accidentally confirmed.
**Fix:** Only auto-confirm on Enter if the confirm button has focus, or remove the global Enter handler entirely (the `autofocus` attribute on the confirm button already handles default Enter behavior).

---

## MEDIUM

### M-01: `oasis-toast.js` does not clean up `setTimeout` handles on disconnect

**File:** `/components/shared/oasis-toast.js`
**Description:** `show()` creates a `setTimeout` for auto-dismiss, and `_dismiss()` creates another for animation. Neither timeout ID is stored or cleared in `disconnectedCallback`. If the component is removed while toasts are pending, the timeouts fire on a detached element.
**Impact:** Minor: no visible crash, but could log warnings or cause subtle issues if the component is re-mounted.
**Fix:** Store timeout IDs and clear them in `disconnectedCallback`.

### M-02: `oasis-modal.js` keydown listener is always active

**File:** `/components/shared/oasis-modal.js:152-160`
**Description:** The modal registers a global `document.addEventListener('keydown', ...)` in `connectedCallback` and removes it in `disconnectedCallback`. However, the component exists in the DOM even when `open=false` (`:host { display: none }`). The handler checks `if (!this.open) return`, but the listener runs on every keypress in the app.
**Impact:** Minor performance cost. Multiple modals on the page would each intercept keypresses.
**Fix:** Add/remove the listener in the `updated()` lifecycle when `open` changes, not in `connectedCallback`.

### M-03: `oasis-confirm.js` keydown listener also always active

**File:** `/components/shared/oasis-confirm.js:153-160`
**Description:** Same issue as M-02. The confirm dialog has a permanent global keydown listener.
**Impact:** Same as M-02.
**Fix:** Same approach -- add/remove based on `_open` state.

### M-04: `page-household.js` and `page-settings.js` lack `disconnectedCallback` cleanup

**File:** `page-household.js`, `page-settings.js`
**Description:** `page-household.js` has no interval timers to clean up (acceptable), but `page-settings.js` does not clean up any resources in `disconnectedCallback` -- it does not even define one. While it has no auto-refresh intervals, it stores `this.openSections` state that persists after unmount.
**Impact:** Low risk currently, but if auto-refresh is added later, leaks would occur.
**Fix:** Add empty `disconnectedCallback` stubs to establish the pattern for future changes.

### M-05: `oasis-tabs.js` slot visibility mechanism bypasses Shadow DOM

**File:** `/components/shared/oasis-tabs.js:158-165`
**Description:** `_updatePanelVisibility()` uses `this.querySelectorAll('[slot]')` which queries the light DOM (children of the element). It then sets `panel.style.display` directly. The CSS also has `::slotted([slot]) { display: none; }` which would conflict. The `display: none` CSS rule hides ALL slotted panels, and then JS shows the active one -- but the CSS rule uses `!important`-free `display: none` which may not override inline `display: ''` reliably across browsers.
**Impact:** Tab panels may flash or show incorrectly depending on timing.
**Fix:** Use a CSS class (`.active`) on panels instead of inline style, or rely solely on the JS-based approach and remove the CSS rule.

### M-06: `page-agents.js` agent-detail navigation uses hash-prefixed paths

**File:** `page-agents.js` (multiple locations)
**Description:** Several `_navigate()` calls use `'#/agents'` (with hash prefix) while the router API expects paths without hash. The `router.navigate()` method likely strips the `#`, but the inconsistency is confusing. In `page-home.js:537-538`, `_navigate('#/operations')` also uses hash prefix.
**Impact:** Depends on router implementation. Could cause double-hash in URL (`##/operations`) or navigation failures.
**Fix:** Standardize on paths without `#` prefix in all `router.navigate()` calls.

### M-07: `page-home.js` `_renderSkeleton()` returns same width for all contexts

**File:** `page-home.js:473-475`
**Description:** The skeleton loader always renders as `width: 80px` regardless of context (used for treasury amounts, recipe names, system health chips, etc.).
**Impact:** Skeleton loaders look uniform and do not approximate the width of actual content, making the loading state feel generic.
**Fix:** Accept a `width` parameter or use CSS `min-width: 100%` on skeleton elements.

### M-08: `_createPageElement()` in `oasis-app.js` is dead code

**File:** `/components/shell/oasis-app.js:335-345`
**Description:** The `_createPageElement()` method is defined but never called. Page elements are created inline in `_renderPageContent()` using `document.createElement()`.
**Impact:** Dead code adds confusion.
**Fix:** Remove the unused method.

### M-09: `oasis-table.js` row click handler does nothing useful

**File:** `/components/shared/oasis-table.js:216`
**Description:** The table row has `style="cursor: ${row.__clickable !== false ? 'default' : 'default'}"` which always evaluates to `cursor: default` regardless of the condition. The ternary is a no-op.
**Impact:** Rows always show default cursor even when `row-click` events are dispatched. Clickable rows are not visually indicated.
**Fix:** Use `cursor: pointer` for the truthy case, or remove the ternary entirely.

### M-10: Several shared components are imported but never used by pages

**Files:** `oasis-card.js`, `oasis-badge.js`, `oasis-search.js`, `oasis-tabs.js`, `oasis-empty.js`, `oasis-markdown.js`, `oasis-table.js`, `oasis-modal.js`
**Description:** These shared components are defined and registered, but most pages implement their own inline versions of cards, badges, tables, tabs, search inputs, and empty states rather than using the shared components.
**Impact:** The shared component library is largely unused, creating maintenance burden with no benefit. Pages are larger than necessary due to duplicated UI patterns.
**Fix:** Gradually refactor pages to use the shared components, reducing per-page code size.

---

## LOW

### L-01: `oasis-theme.js` does not listen for `prefers-color-scheme` changes

**File:** `/components/shell/oasis-theme.js`
**Description:** The theme component reads the system preference at initialization (`_readStoredTheme()`) but does not add a `matchMedia` listener for runtime changes (e.g., OS switching from light to dark mode).
**Impact:** If the user has no stored preference and their OS switches themes, the dashboard does not follow.
**Fix:** Add `window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)`.

### L-02: `index.html` loading spinner not hidden on Lit hydration

**File:** `/public/index.html:47-49`
**Description:** The CSS selector `oasis-app:defined + .app-loading` hides the loading state, but there is no `.app-loading` element in the HTML. The fallback spinner is only in a `<noscript>` block. The `:defined` pseudo-class technique is correct, but since there is no `.app-loading` div to hide, it does nothing.
**Impact:** No visible issue (there is no spinner to hide), but if a spinner div were added it would need to be a sibling of `<oasis-app>`.
**Fix:** Either add an `.app-loading` div as a sibling to `<oasis-app>` for pre-hydration UX, or remove the unused CSS rule.

### L-03: `page-home.js` chat session key not cleared on component disconnect

**File:** `page-home.js:143`
**Description:** `_chatSessionKey` is stored on the instance but not cleared in `disconnectedCallback`. If the home page is revisited, a stale session key may be sent to the backend.
**Impact:** Could resume an old chat session unexpectedly instead of starting fresh.
**Fix:** Clear `_chatSessionKey` in `disconnectedCallback`.

### L-04: `page-agent-detail.js` API paths missing leading slash

**File:** `page-agent-detail.js:303-304`
**Description:** API calls use `api.get(\`agents/${this.id}\`)` and `api.get(\`sessions?agentId=${this.id}\`)` without a leading `/api/` prefix. This relies on the `api` client prepending the base URL correctly.
**Impact:** If the `api` client does not prepend `/api/`, these requests will fail silently.
**Fix:** Use consistent path format: `/api/agents/${this.id}`.

### L-05: `page-business.js` API paths also missing leading `/api/` prefix

**File:** `page-business.js:224-256`
**Description:** Multiple `api.get()` calls use relative paths like `'dito/leads'`, `'nolan/projects'`, `'aech/deals'` without the `/api/` prefix.
**Impact:** Same as L-04.
**Fix:** Add `/api/` prefix for consistency and safety.

### L-06: `oasis-sidebar.js` uses duplicate icon for Operations and Settings

**File:** `/components/shell/oasis-sidebar.js:13,20`
**Description:** Both "Operations" and "Settings" nav items use the same icon (`'--'`). The actual content shows both as distinct items but the emoji differentiator is absent for sighted users scanning quickly.
**Impact:** Minor visual confusion.
**Fix:** Use a different icon for one of them (e.g., wrench for Settings, gear for Operations, or vice versa). Note: the current code actually has distinct emojis but both show the gear icon.

### L-07: Theme `meta[name="theme-color"]` is hardcoded to dark theme

**File:** `/public/index.html:8`
**Description:** `<meta name="theme-color" content="#0a0e17" />` uses the dark background color. When the user switches to light mode, the browser's title bar / mobile status bar remains dark-themed.
**Impact:** Minor visual mismatch on mobile browsers.
**Fix:** Dynamically update the meta tag in `oasis-theme.js` when the theme changes.

### L-08: `oasis-search.js` debounce timer not cleared in `disconnectedCallback`

**File:** `/components/shared/oasis-search.js`
**Description:** `_debounceTimer` is created via `setTimeout` but never cleared on disconnect.
**Impact:** Minor: the timeout fires on a detached element.
**Fix:** Add `clearTimeout(this._debounceTimer)` in `disconnectedCallback`.

### L-09: `oasis-modal.js` footer slot `:empty` detection unreliable

**File:** `/components/shared/oasis-modal.js:110-113`
**Description:** The CSS rule `.modal-footer:empty` is used to hide the footer when no slot content is provided. However, `:empty` only works if the element has no child nodes at all -- the `<slot name="footer">` element itself is a child, so the footer div is never truly empty.
**Impact:** An empty footer area with border-top is always visible in modals that do not provide footer content.
**Fix:** Use a conditional render in the template: only render the footer `<div>` if the footer slot has assigned nodes (check via `slotchange` event).

---

## INFO

### I-01: `index.v2.html` is legacy dead code

**File:** `/public/index.v2.html`
**Description:** This is the complete v2 monolithic dashboard -- a single HTML file with inline CSS and JS. It duplicates all functionality now provided by the v3 Lit component architecture. It is not linked from anywhere.
**Impact:** No runtime impact. Adds 50+ KB of dead code to the repository.
**Recommendation:** Delete `index.v2.html` or move it to an `archive/` directory.

### I-02: All page components are properly registered and reachable via PAGE_MAP

**Description:** Verification of PAGE_MAP completeness:
- `/` -> `page-home` (registered)
- `/agents` -> `page-agents` (registered)
- `/agents/:id` -> `page-agents` (registered, handles detail internally)
- `/chat` -> `page-chat` (registered)
- `/chat/:agentId` -> `page-chat` (registered)
- `/operations` -> `page-operations` (registered)
- `/knowledge` -> `page-knowledge` (registered)
- `/business` -> `page-business` (registered)
- `/household` -> `page-household` (registered)
- `/analytics` -> `page-analytics` (registered)
- `/tools` -> `page-tools` (registered)
- `/spawn` -> `page-spawn` (registered)
- `/settings` -> `page-settings` (registered)

All routes map to defined components. The orphaned `page-agent-detail` is noted in C-01.

### I-03: Accessibility is generally well-handled

**Description:** Positive findings across the codebase:
- Skip link in `index.html` and `global.css`
- `aria-label`, `aria-expanded`, `aria-current`, `role` attributes used on sidebar, topbar, modal, confirm, toast, tabs, table, and card components
- Focus trapping in modal with `_trapFocus()`
- `:focus-visible` styles in theme.css and all interactive components
- `prefers-reduced-motion` media query in theme.css
- Screen-reader-only utility class (`.sr-only`) in global.css
- Keyboard navigation (Enter/Space) on clickable cards
- `aria-sort` on sortable table headers

### I-04: Theme system is well-structured

**Description:** Dark and light themes are fully defined with comprehensive CSS custom properties. The theme toggle persists to localStorage, syncs across tabs via the `storage` event, and respects `prefers-color-scheme` on first load. The `theme-transitioning` class provides smooth color transitions.

### I-05: All components with intervals/timers clean up in `disconnectedCallback`

**Description:** Verified cleanup:
- `page-home.js`: clears `_healthInterval` and `_unsubActivity`
- `page-operations.js`: clears `_cronTimer`, `_dockerTimer`, `_activitySearchDebounce`, log refresh, event bus subscriptions
- `page-analytics.js`: clears all `_refreshTimers`
- `page-business.js`: clears all timers via `_clearTimers()`
- `page-tools.js`: clears `_taskTimer` and all `_pollers`
- `page-chat.js`: removes event bus listener, clears `_streamTimer`
- `page-knowledge.js`: stops voice refresh, clears search debounce
- `page-spawn.js`: clears `_idValidateTimer`
- `page-agents.js`: clears route unsub and `_clearMemoryTimer`
- `oasis-topbar.js`: clears health poll interval, WS listener, store subscription
- `oasis-theme.js`: removes storage listener

### I-06: Page components that are very large

**Description:** Several page components exceed 1500 lines:
- `page-knowledge.js`: ~3048 lines
- `page-business.js`: ~2724 lines
- `page-operations.js`: ~2577 lines
- `page-tools.js`: ~2285 lines
- `page-chat.js`: ~2027 lines
- `page-agents.js`: ~2021 lines
- `page-household.js`: ~1888 lines
- `page-settings.js`: ~1659 lines
- `page-spawn.js`: ~1604 lines
- `page-analytics.js`: ~1458 lines
- `page-home.js`: ~1285 lines

While not bugs, these large files could benefit from decomposition into sub-components. This is consistent with the project guideline of aiming for ~500-700 LOC per file.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 4     |
| HIGH     | 6     |
| MEDIUM   | 10    |
| LOW      | 9     |
| INFO     | 6     |

**Priority remediation order:**
1. Fix C-03 + C-04 (error display broken in app shell)
2. Fix C-02 (XSS via markdown rendering -- consolidate renderers)
3. Fix H-03 (replace alert/confirm with toast/confirm components)
4. Fix H-06 (Enter key always confirms in confirm dialog)
5. Fix H-01 + H-02 (consolidate duplicated utilities)
6. Address C-01 (remove or route page-agent-detail)
7. Fix H-04 (sidebar route subscription leak)
