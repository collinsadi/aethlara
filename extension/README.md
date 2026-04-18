# Aethlara Chrome Extension

AI-powered job autofill and extraction for Aethlara users.

## What it does

- **Job Autofill** — Select a job from your account, click Autofill, and the extension fills every form field on the active application page using AI and your tailored resume context.
- **Job Extraction** — On any job posting page, extract full job details and see your match score before saving to your dashboard.
- **Secure Auth** — Connects to your Aethlara account via a one-time, 60-second handshake token. No passwords stored in the extension.

## How to build

```bash
cd extension
npm install
npm run build
```

Then load the `dist/` folder as an unpacked extension in Chrome (`chrome://extensions → Load unpacked`).

## How authentication works

1. Go to **Dashboard → Settings → Extension** and click **Connect Chrome Extension**.
2. A new tab opens to `/extension-handshake?ext_token=…`. The extension background script intercepts this, exchanges the single-use token for a short-lived access token, and closes the tab.
3. The access token is stored in `chrome.storage.session` (cleared when the browser closes). No refresh token is issued to the extension.
4. When the session expires (15 minutes), reconnect from the dashboard settings.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Scan form fields and inject fill actions on the current tab only, when the user clicks Autofill |
| `scripting` | Required to communicate with content scripts for scanning and filling |
| `storage` | Store the session token in `chrome.storage.session` (cleared on browser close) |
| `alarms` | Periodic no-op alarm for session state checks |

Host permissions are scoped to the Aethlara API domain only — not `<all_urls>`.

## Known limitations

- **iFrames**: Fields inside cross-origin iframes cannot be scanned or filled (browser security restriction).
- **Shadow DOM**: Partial support — accessible shadow roots are scanned but closed shadow DOMs are not.
- **File upload fields**: Always return `null` from AI — cannot be filled programmatically.
- **Session lifetime**: 15 minutes. Reconnect from the dashboard settings page when the session expires.

## Self-hosted setup

Copy `.env.example` to `.env` and update:

```env
VITE_API_BASE_URL=https://your-api-domain.com/api/v1
VITE_DASHBOARD_URL=https://your-dashboard-domain.com
```

Then rebuild: `npm run build`.
