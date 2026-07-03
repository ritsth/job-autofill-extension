// Background service worker: the AI hub. It owns the provider, the API key, and
// the cross-origin fetch, so content scripts and UI pages never touch them.
// It handles AI_* messages and replies with an AIResult ({ text } or { error }).

import { getProfile, profileToContext, type AISettings } from '../lib/profile';
import { getActiveJob } from '../lib/savedJobs';
import { getCachedToken } from '../lib/auth';
import { getProvider, AIError, type AIProvider } from '../lib/ai';
import {
  buildAnswerPrompt,
  buildTailoredResumePrompt,
  buildResumeParsePrompt,
  buildJobEligibilityPrompt,
} from '../lib/ai/prompts';
import { substitutePlaceholders } from '../lib/coverLetter';
import type { AIResult, BackgroundMessage } from '../lib/messages';

// Builds the provider for a request. For the managed proxy the bearer is the
// user's Google sign-in token (resolved silently) unless an admin token is set —
// so a signed-out user gets a clear "sign in" prompt instead of a 401. Resolved
// lazily, only in branches that hit the AI, so the no-AI cover-letter path still
// works while signed out.
async function resolveProvider(ai: AISettings): Promise<AIProvider> {
  if (ai.provider === 'proxy' && !ai.proxyToken) {
    let token: string;
    try {
      token = await getCachedToken();
    } catch {
      throw new AIError(
        'Sign in to use the managed AI — open the extension to sign in, or pick another AI provider in options.',
      );
    }
    return getProvider({ ...ai, proxyToken: token });
  }
  return getProvider(ai);
}

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
  // Only our own pages/content scripts may drive the AI hub. No
  // externally_connectable is declared, so this can't fire for web pages today —
  // the check makes that boundary explicit rather than implicit.
  if (sender.id !== chrome.runtime.id) return false;
  // Only handle our AI messages; ignore content-targeted ones.
  if (
    msg?.type !== 'AI_GENERATE_ANSWER' &&
    msg?.type !== 'AI_GENERATE_COVER_LETTER' &&
    msg?.type !== 'AI_GENERATE_RESUME' &&
    msg?.type !== 'AI_PARSE_RESUME' &&
    msg?.type !== 'AI_ANALYZE_JOB'
  ) {
    return false;
  }
  handle(msg)
    .then((text) => sendResponse({ text } satisfies AIResult))
    .catch((e: unknown) =>
      sendResponse({
        text: '',
        error: e instanceof AIError ? e.message : `Unexpected error: ${(e as Error).message}`,
      } satisfies AIResult),
    );
  return true; // keep the message channel open for the async response
});

async function handle(msg: BackgroundMessage): Promise<string> {
  const profile = await getProfile();
  const context = profileToContext(profile);

  if (msg.type === 'AI_PARSE_RESUME') {
    // Returns raw JSON text; the options page validates it via parseResumeJson.
    const provider = await resolveProvider(profile.ai);
    return provider.generate(buildResumeParsePrompt(msg.text));
  }

  if (msg.type === 'AI_ANALYZE_JOB') {
    // Returns raw JSON; the content script parses it via parseEligibilityJson.
    const provider = await resolveProvider(profile.ai);
    return provider.generate(buildJobEligibilityPrompt(msg.text));
  }

  // The remaining handlers tailor to a job posting. A saved "active" job wins
  // over the live page's text/company/role, so tailoring survives a multi-page
  // application that has navigated away from the posting.
  const activeJob = await getActiveJob();
  const jobText = activeJob?.text || msg.jobText;

  if (msg.type === 'AI_GENERATE_ANSWER') {
    const provider = await resolveProvider(profile.ai);
    // The free-text answer is the only feature that honors the user's model
    // choice; everything else stays on the provider's fast default.
    return provider.generate({
      ...buildAnswerPrompt(msg.question, context, jobText),
      model: profile.ai.model,
    });
  }

  const company = msg.company.trim() || activeJob?.company || '';
  const role = msg.role.trim() || activeJob?.role || '';

  if (msg.type === 'AI_GENERATE_RESUME') {
    const provider = await resolveProvider(profile.ai);
    return provider.generate(buildTailoredResumePrompt(context, jobText, company, role));
  }

  // AI_GENERATE_COVER_LETTER — a straight placeholder fill ({{company}}, {{role}},
  // {{date}}). The applicant's wording, including the opening paragraph, is kept
  // verbatim; no AI rewrite. (No API key needed for this path.)
  return substitutePlaceholders(profile.baseCoverLetter, { company, role });
}

// Clicking the toolbar icon opens the side panel (which stays open until the
// user closes it), instead of a popup that closes on outside click.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Open the options page on first install so the user can set up their profile + key.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});
