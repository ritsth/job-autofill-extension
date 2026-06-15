// Background service worker: the AI hub. It owns the provider, the API key, and
// the cross-origin fetch, so content scripts and UI pages never touch them.
// It handles AI_* messages and replies with an AIResult ({ text } or { error }).

import { getProfile, profileToContext } from '../lib/profile';
import { getProvider, AIError } from '../lib/ai';
import { buildAnswerPrompt, buildCoverLetterPrompt, buildResumeParsePrompt } from '../lib/ai/prompts';
import { substitutePlaceholders } from '../lib/coverLetter';
import type { AIResult, BackgroundMessage } from '../lib/messages';

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, _sender, sendResponse) => {
  // Only handle our AI messages; ignore content-targeted ones.
  if (
    msg?.type !== 'AI_GENERATE_ANSWER' &&
    msg?.type !== 'AI_GENERATE_COVER_LETTER' &&
    msg?.type !== 'AI_PARSE_RESUME'
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
  const provider = getProvider(profile.ai);
  const context = profileToContext(profile);

  if (msg.type === 'AI_GENERATE_ANSWER') {
    return provider.generate(buildAnswerPrompt(msg.question, context));
  }

  if (msg.type === 'AI_PARSE_RESUME') {
    // Returns raw JSON text; the options page validates it via parseResumeJson.
    return provider.generate(buildResumeParsePrompt(msg.text));
  }

  // AI_GENERATE_COVER_LETTER
  const base = substitutePlaceholders(profile.baseCoverLetter, {
    company: msg.company,
    role: msg.role,
  });
  return provider.generate(buildCoverLetterPrompt(base, msg.company, msg.role, context));
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
