# Chrome Web Store listing — copy & answers

**Live listing:** <https://chromewebstore.google.com/detail/Little%20AI%20Helper/iibpijacaghdcckphindbaijjgcbaoll>
**Published:** 2026-06-22

Paste-ready content for the Web Store Developer Dashboard. Keep this in sync with the
actual listing so submissions are reproducible.

---

## Product name

Little AI Helper

## Summary (≤132 characters)

> Autofill job applications on Greenhouse, Lever & Workday, draft AI answers and cover letters, and flag work-eligibility at a glance.

(127 chars.)

## Category

Productivity

## Language

English

---

## Detailed description

> **Stop retyping the same job-application fields.** Little AI Helper fills
> repetitive applications from a profile you enter once, drafts answers to open-ended
> questions, generates tailored cover letters, and flags work-eligibility requirements
> before you waste time on a posting you can't take.
>
> **What it does**
> - **Autofill** standard fields on Greenhouse, Lever, and Workday applications from your
>   saved profile.
> - **✨ AI answers** — a button appears beside free-text questions and drafts a response
>   from your resume and uploaded documents.
> - **Cover letters** — generate a cover letter from your template (company, role, and
>   date placeholders filled in) and download it as a PDF.
> - **Eligibility badge** — every job posting is scanned for visa-sponsorship,
>   U.S.-citizenship, and security-clearance language and shows a bold YES / NO badge in
>   the corner. On Handshake it also hosts a one-click cover-letter generator.
>
> **Your data stays yours.** Everything you enter is stored locally in your browser. Text
> is only sent to an AI provider when you ask it to generate something — and you choose
> the provider: your own free Google Gemini key, a managed proxy (sign in with Google),
> or Chrome's on-device model (no network at all). No analytics, no tracking.
>
> **AI providers**
> - Bring your own free Gemini key, or
> - Use the managed proxy (Google sign-in; metered per user), or
> - Use Chrome's built-in on-device model when available.

---

## Single purpose

> The extension's single purpose is to help users complete job applications: it autofills
> application form fields from a user-entered profile and generates job-application text
> (answers and cover letters), with an at-a-glance badge summarizing a posting's
> work-eligibility requirements.

---

## Permission justifications

| Permission | Justification |
| --- | --- |
| `storage` | Save the user's profile, resume, documents, and settings locally in the browser. |
| `activeTab` | Read and fill fields on the job-application page the user is currently on, when they click the extension. |
| `sidePanel` | The extension's main UI is a side panel that stays open while the user works through an application. |
| `identity` | Optional Google sign-in (OpenID/email/profile) so users can authenticate to the managed AI proxy, which meters usage per user. |
| Host access to Greenhouse, Lever, Workday (`*.greenhouse.io`, `jobs.lever.co`, `*.myworkdayjobs.com`, etc.) | Run the autofill content script on supported job-application sites. |
| `generativelanguage.googleapis.com` | Send the user's context to Google's Gemini API to generate answers/cover letters when the user supplies their own key. |
| `*.run.app` | Send requests to the managed proxy (Cloud Run) that relays to Vertex AI, when the user selects that provider. |
| Content script on `<all_urls>` (with `all_frames`) | The work-eligibility badge must be able to scan any job posting regardless of which site hosts it. It renders only while the user has scanning enabled (a neutral gray "no eligibility info" card appears when a page has no eligibility wording), and it activates autofill only on the supported job boards above. Additionally, when the user explicitly **saves a job**, the inline "✨ AI answer" button appears beside that application's free-text questions so they can draft answers on any site — this is user-initiated and shows nothing until a job is saved. `all_frames` is required because company career sites embed the ATS application form in an iframe, so the AI-answer button must reach those sub-frames; the badge and popup messaging stay top-frame-only. Users can turn scanning off entirely from the side panel. |

## Remote code

**No.** The extension does not load or execute remote code. It calls AI provider APIs to
send context and receive generated text (data only); all executable code is bundled in
the package.

---

## Privacy practices tab — disclosure answers

**Single purpose**: (use the statement above.)

**Data collected** (declare the categories the extension handles; all stored locally):
- **Personally identifiable information** — name, email address, phone number, physical
  location (city/state/country) the user enters for their profile, plus optional
  self-reported demographic fields.
- **Authentication information** — Google account email/token used for optional managed-
  proxy sign-in, plus the user's own Gemini API key or an admin proxy token, if they
  choose to enter one.
- **Website content** — resume text, uploaded documents (PDF/DOCX converted to plain
  text), work history, education, skills, cover-letter template, and saved job-posting
  text — all entered or captured by the user for use as AI context.

(We do not collect: health info, financial/payment info, web-browsing history, user
activity/analytics, or personal communications. The list of hostnames where the user has
turned the eligibility badge off — see PRIVACY.md — is a short, user-initiated settings
list, not browsing history: it only ever contains a site the user explicitly chose to
disable, it's never transmitted, and it does not log page visits.)

**Required certifications** (all true):
- ✅ I do not sell or transfer user data to third parties outside of approved use cases.
- ✅ I do not use or transfer user data for purposes unrelated to the item's single purpose.
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**:
`https://github.com/ritsth/job-autofill-extension/blob/main/PRIVACY.md`

---

## Assets checklist

- **Store icon**: 128×128 PNG — already in the package (`public/icons/icon128.png`).
- **Screenshots**: 1–5 at **1280×800** PNG (see the capture guide in `DEPLOYMENT.md`).
- **Small promo tile** (optional): 440×280.
- **Marquee promo tile** (optional): 1400×560.
