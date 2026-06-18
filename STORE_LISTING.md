# Chrome Web Store listing — copy & answers

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
> - **Cover letters** — generate a tailored letter from your template (company, role, and
>   date filled in) and download it as a PDF.
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
| `scripting` | Inject the autofill logic that populates form fields on supported application pages. |
| `sidePanel` | The extension's main UI is a side panel that stays open while the user works through an application. |
| `identity` | Optional Google sign-in (OpenID/email/profile) so users can authenticate to the managed AI proxy, which meters usage per user. |
| Host access to Greenhouse, Lever, Workday (`*.greenhouse.io`, `jobs.lever.co`, `*.myworkdayjobs.com`, etc.) | Run the autofill content script on supported job-application sites. |
| `generativelanguage.googleapis.com` | Send the user's context to Google's Gemini API to generate answers/cover letters when the user supplies their own key. |
| `*.run.app` | Send requests to the managed proxy (Cloud Run) that relays to Vertex AI, when the user selects that provider. |
| Content script on `<all_urls>` | The work-eligibility badge must be able to scan any job posting regardless of which site hosts it. It self-gates at runtime: it only renders when the user has scanning enabled **and** the page actually looks like a job posting, and it activates autofill only on the supported job boards above. Additionally, when the user explicitly **saves a job**, the inline "✨ AI answer" button appears beside that application's free-text questions so they can draft answers on any site — this is user-initiated and shows nothing until a job is saved. Users can turn scanning off entirely from the side panel. |

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
  proxy sign-in.

(We do not collect: health info, financial/payment info, web-browsing history, user
activity/analytics, or personal communications.)

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
