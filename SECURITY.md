# Security Policy

## Supported versions

Only the latest release of the extension (the version currently on the
[Chrome Web Store](https://chromewebstore.google.com/detail/Little%20AI%20Helper/iibpijacaghdcckphindbaijjgcbaoll))
and the current `main` branch receive security fixes.

## Reporting a vulnerability

Please **do not open a public issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting instead:
**[Report a vulnerability](https://github.com/ritsth/job-autofill-extension/security/advisories/new)**
(Security tab → "Report a vulnerability"). Include steps to reproduce, the
affected component (extension, or the Cloud Run proxy in `server/`), and the
impact you see.

You can expect an acknowledgment within a few days. Please give us a
reasonable window to ship a fix before any public disclosure.

## Scope notes

- The extension stores all profile/resume data locally
  (`chrome.storage.local`); there is no account system or server-side user
  data. See [PRIVACY.md](PRIVACY.md).
- The managed proxy (`server/`) holds no user data — only per-user daily
  request counters. Its threat model, hardening status, and accepted risks
  are documented in [docs/SECURITY.md](docs/SECURITY.md).
- BYO-key mode sends requests directly from your browser to Google's Gemini
  API; your key never touches any server we run.
