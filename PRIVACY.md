# Privacy Policy — Little AI Helper

_Last updated: September 3, 2026_

Little AI Helper ("the extension") is a Chrome extension that fills out
job applications and drafts answers and cover letters from a profile **you** enter.
This policy explains what data the extension handles and where it goes. In plain
terms: **your data stays on your machine**, and the only time anything leaves your
device is when *you* ask the AI to generate text.

## What the extension stores

All of the following is saved **locally on your computer** using Chrome's
`chrome.storage.local`. It is never sent to, or stored on, any server operated by us:

- **Profile / personal information** you enter: name, email, phone, city/state/country,
  LinkedIn, portfolio, GitHub.
- **Work history, education, and skills.**
- **Resume text and uploaded documents** (PDF/DOCX are converted to plain text on your
  device for use as AI context).
- **Preferences**, including optional, self-reported EEO/demographic answers
  (gender, ethnicity, veteran status, disability status). These are blank by default
  and entirely under your control.
- **Cover-letter template** and **saved job postings.**
- **Your Google account email**, cached after you choose to sign in (see below).
- **Your AI provider settings** — if you bring your own Gemini key, or paste an admin
  token for the managed proxy, that credential is stored locally and sent only to the
  provider you chose, in a request header, never in a URL or a log.
- **Sites you've turned the eligibility badge off on** — just the hostnames you chose
  via "Turn off on this site only" on the badge, so the setting survives a reload. This
  is a short, user-initiated list, not a browsing history: it only ever contains a site
  once you've explicitly clicked to disable the badge there, and it's never transmitted
  anywhere.
- **Extension settings** — which features are turned on (autofill scanning, cover
  letter, tailored resume), whether you've dismissed the badge's first-run intro, and
  which corner of the screen you've dragged the badge to.

This list is kept in step with the `Profile` type in
[src/lib/profile.ts](https://github.com/ritsth/job-autofill-extension/blob/main/src/lib/profile.ts) —
any new field stored there should be added here too.

We do **not** use analytics, tracking, advertising, or crash reporting. There is no
telemetry of any kind.

## When data leaves your device

The extension only contacts a network service when you actively use an AI feature
(generating an answer, cover letter, or eligibility check). Which service it contacts
depends on the AI provider you select in Options:

1. **Bring-your-own Gemini key** — your selected profile context (resume, work history,
   the relevant job text, etc.) and your own Google Gemini API key are sent directly to
   Google's Gemini API (`generativelanguage.googleapis.com`) to generate text.
2. **Managed proxy** — the same context is sent to a Cloud Run service (operated by the
   extension's publisher) that relays the request to Google Vertex AI. To use it you
   **sign in with Google** via Chrome's identity API; a Google access token is sent so
   the service can verify you and enforce a per-user daily request limit. The service
   reads your Google account ID and email for metering only and does not sell, share, or
   repurpose them.
3. **On-device model** — when available, Chrome's built-in model generates text
   **entirely on your device with no network request**.

The extension does **not** transmit your data anywhere except the AI provider you
choose, and only for the purpose of generating the text you requested.

### How each provider uses your data

- **Managed proxy (Vertex AI):** Google does **not** use data submitted to the Vertex AI
  API to train or improve its foundation models.
- **On-device model:** nothing is sent off your device, so there is nothing to be used.
- **Bring-your-own Gemini key:** how Google may use this data depends on **your** key's
  tier. Google may use **free-tier** Gemini API (AI Studio) prompts and responses to
  improve its products; **paid-tier** usage is excluded. If this matters to you, use a
  paid-tier key, the on-device model, or the managed proxy. See Google's
  [Gemini API terms](https://ai.google.dev/gemini-api/terms) for the authoritative detail.

## Google sign-in

Sign-in is optional and only used for the **Managed proxy** provider. It uses Chrome's
`identity` API with the `openid`, `email`, and `profile` scopes. We use your email and
Google account ID solely to identify your requests and apply the daily usage limit. You
can sign out at any time from the Options page, which clears the cached email and revokes
the token.

## How to delete your data

- Clear individual fields in the Options page, or
- **Remove the extension** from `chrome://extensions` — this deletes everything stored in
  `chrome.storage.local`.

To stop managed-proxy usage, sign out in Options and/or switch to the bring-your-own key
or on-device provider.

## What we do not do

- We do **not** sell or rent your data.
- We do **not** use your data for any purpose unrelated to the extension's single
  purpose (autofilling job applications and generating job-application text).
- We do **not** use your data to determine creditworthiness or for lending purposes.

## Contact

Questions about this policy: akitirsth@gmail.com
