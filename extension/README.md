# Aethlara Chrome Extension

The hands of the Aethlara autopilot. The server finds jobs and scores them; you approve the ones worth applying to; the extension fills and submits those applications **in your own browser**, then reports the outcome back to Aethlara.

## What it does

- **Side panel**: click the toolbar icon to open it next to any tab.
  - **Autopilot**: agent status (on/off, next and last run), counts (new leads, ready for the extension, need you, submitted today), *Run agent now*, the **Apply automatically** switch, *Apply now*, the application being worked on with live step-by-step progress, the queue (open / retry / mark submitted / answer in the dashboard) and recent results.
  - **Review**: approve or dismiss new leads (match score, summary, pros and gaps, "via *source*" link to the posting).
  - **This page**: on a job posting, *Send to agent* (optionally approve right away) and see the match score; on an application form, *Fill this form* with an approved application (stops before submitting). The saved-job autofill and the classic "extract this job to your tracker" flows are here too.
- **Extension autopilot**: while *Apply automatically* is on, the service worker checks the queue every 10 minutes (5–60, in Settings) and works up to 3 applications per check, strictly one at a time, in an inactive background tab. *Apply now* runs a check immediately, even when the switch is off.
- **Connect once**: the dashboard handshake gives the extension a revocable device credential, so it stays connected across browser restarts until you sign out or disconnect it from the dashboard.

## How an application is worked

1. `POST /agent/applications/claim` leases the next ready application and returns its packet (apply URL, cover letter, file paths, whether to auto-submit).
2. The apply URL opens in a new inactive tab. The content script waits up to 20 s for the form; ATS adapters handle **Greenhouse** (embed `job_app` forms, react-select dropdowns, emailed security codes), **Lever** (`/apply` forms, resume parsing, location picker) and **Ashby** (the SPA's Application tab, Yes/No buttons, EEO survey); a generic adapter handles everything else, including one hop to an "Apply" link or an embedded ATS iframe.
3. The scanner describes every question (text, selects, radio and checkbox groups, single checkboxes, custom comboboxes, date pickers, file inputs, rich text) with its label, required flag, options, section and help text, skipping hidden, disabled and honeypot inputs. The fields go to `POST /agent/applications/:id/fill` (≤ 150 per call) and the answers are applied the way a person would: native setters plus input/change/blur events, clicks for choices, type-then-pick for dropdowns.
4. Files first: the background downloads the tailored resume (and cover letter) and the content script attaches them with `DataTransfer`, so ATS resume parsers cannot overwrite the answers afterwards. When there is no cover-letter upload, the cover letter is pasted into a cover-letter text box.
5. Multi-step forms are advanced with *Next* (up to 6 steps). Required fields that are still empty stop the run as **needs input**: questions only you can answer are sent to the dashboard (`missing_answers`), anything else becomes `review`.
6. With auto-submit on, the real submit button is pressed (never "save draft") and the outcome is watched: a confirmation → **submitted** (tab closed); validation errors → one corrective pass, then `review`; an emailed security code → polled from the agent inbox (`GET /agent/inbox/verifications`) for up to 2 minutes and entered; a CAPTCHA → `captcha`; a sign-in wall → `login_required`.
7. Every claim gets exactly one result (`submitted`, `needs_input`, `failed` or `released`), including on timeouts (4 minutes, +3 while waiting for a security code) and closed tabs. Tabs that need you stay open, a Chrome notification says so, and if you submit them yourself the extension notices the confirmation and reports the application as submitted.

The service worker persists its state in `chrome.storage.session` before every step that can navigate the page, and results go through an outbox, so a service-worker restart resumes the application (or hands the claim back) instead of leaving it hanging.

## Build

```bash
cd extension
npm install
npm run build      # side panel + service worker + content script into dist/
npm run typecheck
```

Load `dist/` as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked). Requires Chrome 116+.

The build produces three self-contained bundles (the content script cannot use ES module imports): `sidepanel.html` + `assets/`, `background/index.js` and `content/index.js`.

## Configuration

Copy `.env.example` to `.env` and rebuild:

```env
VITE_API_BASE_URL=https://api.example.com/api/v1   # its origin is added to host_permissions at build time
VITE_DASHBOARD_URL=https://app.example.com         # "Connect" opens <dashboard>/settings#extension
VITE_EXTENSION_TOKEN_PARAM=ext_token
```

For a local server: `VITE_API_BASE_URL=http://localhost:18080/api/v1 npm run build`.

## How authentication works

1. In the side panel click **Open dashboard to connect**, then **Connect extension** in Settings → Extension.
2. The dashboard opens `/extension-handshake?ext_token=…`. The content script on that page passes the single-use token to the service worker, which only accepts it from the configured dashboard origin (any `localhost` port is accepted only by builds whose dashboard is itself on `localhost`), exchanges it at `POST /auth/extension-token/exchange` (sending a device name such as "Chrome on macOS") and closes the tab.
3. The **device token** is kept in `chrome.storage.local`; the 15-minute **access token** lives in `chrome.storage.session` (memory only, not readable by content scripts).
4. Access tokens are refreshed about a minute before they expire, and once after a 401, through `POST /auth/extension/refresh`. The device token rotates on every refresh. Refreshes are single-flight within a context and serialised across the side panel and the service worker with the Web Locks API; on `DEVICE_TOKEN_ROTATED` the stored token is re-read and the refresh retried once; on `DEVICE_REVOKED` everything is cleared and the panel shows the sign-in screen.
5. **Sign out** disconnects this device on the server and forgets all tokens.

Tokens are never logged, never sent to content scripts and never attached to anything but the API.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Device credential and settings (`local`), access token and runner state (`session`, cleared when the browser closes) |
| `alarms` | The autopilot schedule, plus a watchdog and per-application deadline that survive service-worker restarts |
| `tabs` | Open applications in background tabs, read the active tab's URL for *This page*, close finished tabs |
| `scripting` | Inject the content script into a tab that was open before the extension was installed or updated |
| `activeTab` | Lets that injection work on the tab where you clicked the toolbar icon, without broad host access |
| `sidePanel` | The extension UI |
| `notifications` | "X needs you" when an application stops for a CAPTCHA, a question or a review |
| Host permission for the API only | The service worker and panel call the Aethlara API. No `<all_urls>` host permission |
| Content script on all pages | Needed to fill forms on any job site and to relay the handshake. It never calls the API and never sees tokens; everything network-related goes through the service worker, which only serves the tab it is working in |

## Known limitations

- **Cross-origin iframes**: forms inside a frame from another site cannot be read or filled. Known ATS embeds (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee) are opened directly instead; others end as `unsupported_form`.
- **Account flows**: sites that require signing in or creating an account (Workday, Taleo, iCIMS and similar) end as `login_required`. The extension never fills passwords.
- **CAPTCHAs** are never solved: visible reCAPTCHA / hCaptcha / Turnstile challenges stop the run as `captcha`, with the form filled and the tab left open. Invisible bot checks that reject synthetic clicks end as `review`.
- **Custom widgets**: unusual date pickers, rich-text editors or search-as-you-type fields can fail to fill; the run then stops for review instead of submitting.
- **Closed shadow DOM** is not scanned (open shadow roots are).
- The saved-job autofill (pre-autopilot flow) does not upload files.
