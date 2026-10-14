import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE, type AISettings, type Profile } from '../lib/profile';
import { AIError, type AIProvider } from '../lib/ai/provider';
import {
  buildAnswerPrompt,
  buildJobEligibilityPrompt,
  buildResumeParsePrompt,
  buildTailoredResumePrompt,
} from '../lib/ai/prompts';
import type { AIResult, BackgroundMessage } from '../lib/messages';
import type { SavedJob } from '../lib/savedJobs';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn<() => Promise<Profile>>(),
  profileToContext: vi.fn<(profile: Profile) => string>(),
  getActiveJob: vi.fn<() => Promise<SavedJob | null>>(),
  getCachedToken: vi.fn<() => Promise<string>>(),
  getProvider: vi.fn<(settings: AISettings) => AIProvider>(),
  generate: vi.fn<AIProvider['generate']>(),
}));

vi.mock('../lib/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/profile')>()),
  getProfile: mocks.getProfile,
  profileToContext: mocks.profileToContext,
}));
vi.mock('../lib/savedJobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/savedJobs')>()),
  getActiveJob: mocks.getActiveJob,
}));
vi.mock('../lib/auth', () => ({ getCachedToken: mocks.getCachedToken }));
vi.mock('../lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ai')>()),
  getProvider: mocks.getProvider,
}));

const RUNTIME_ID = 'synthetic-extension';
const CONTEXT = 'Name: Synthetic Applicant\nSkills: TypeScript';
type MessageListener = (
  msg: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (result: AIResult) => void,
) => boolean;
let listener: MessageListener;
let profile: Profile;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  profile = structuredClone(DEFAULT_PROFILE);
  profile.ai.provider = 'gemini';
  profile.ai.proxyUrl = 'https://example.invalid/generate';
  profile.ai.model = 'selected-model';
  profile.baseCoverLetter = 'Hello {{company}}, I am applying for {{role}}.';
  mocks.getProfile.mockResolvedValue(profile);
  mocks.profileToContext.mockReturnValue(CONTEXT);
  mocks.getActiveJob.mockResolvedValue(null);
  mocks.getCachedToken.mockResolvedValue('synthetic-bearer');
  mocks.getProvider.mockReturnValue({ id: 'synthetic', generate: mocks.generate });
  mocks.generate.mockResolvedValue('generated result');
  vi.stubGlobal('chrome', {
    runtime: {
      id: RUNTIME_ID,
      onMessage: {
        addListener: vi.fn((handler: MessageListener) => { listener = handler; }),
      },
      onInstalled: { addListener: vi.fn() },
    },
  });
  await import('./service-worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function send(msg: BackgroundMessage): Promise<AIResult> {
  return new Promise((resolve) => {
    expect(listener(msg, { id: RUNTIME_ID }, resolve)).toBe(true);
  });
}

type TailoredMessage = Extract<BackgroundMessage, { type: 'AI_GENERATE_ANSWER' | 'AI_GENERATE_RESUME' }>;
const tailoredMessages: TailoredMessage[] = [
  { type: 'AI_GENERATE_ANSWER', question: 'Why this role?', jobText: 'Live posting' },
  { type: 'AI_GENERATE_RESUME', company: ' Live company ', role: ' Live role ', jobText: 'Live posting' },
];

describe('background message handling — lazy profile context', () => {
  it.each([
    { type: 'AI_PARSE_RESUME', text: 'Synthetic resume' },
    { type: 'AI_ANALYZE_JOB', text: 'Synthetic posting' },
  ] as const)('$type sends its original prompt without building profile context', async (msg) => {
    mocks.profileToContext.mockImplementation(() => { throw new Error('Unused context was built'); });

    expect(await send(msg)).toEqual({ text: 'generated result' });
    expect(mocks.profileToContext).not.toHaveBeenCalled();
    expect(mocks.getActiveJob).not.toHaveBeenCalled();
    expect(mocks.getProvider).toHaveBeenCalledWith(profile.ai);
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
      msg.type === 'AI_PARSE_RESUME'
        ? buildResumeParsePrompt(msg.text)
        : buildJobEligibilityPrompt(msg.text),
    );
  });

  it('fills a cover letter while signed out without building context or calling a provider', async () => {
    profile.ai.provider = 'proxy';
    profile.ai.proxyToken = '';
    mocks.getCachedToken.mockRejectedValue(new Error('Signed out'));
    mocks.profileToContext.mockImplementation(() => { throw new Error('Unused context was built'); });

    expect(await send({ type: 'AI_GENERATE_COVER_LETTER', company: ' Example ', role: ' Engineer ' }))
      .toEqual({ text: 'Hello Example, I am applying for Engineer.' });
    expect(mocks.profileToContext).not.toHaveBeenCalled();
    expect(mocks.getCachedToken).not.toHaveBeenCalled();
    expect(mocks.getProvider).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(tailoredMessages)('$type still builds context once and preserves the original prompt', async (msg) => {
    expect(await send(msg)).toEqual({ text: 'generated result' });
    expect(mocks.profileToContext).toHaveBeenCalledExactlyOnceWith(profile);
    expect(mocks.getProvider).toHaveBeenCalledExactlyOnceWith(profile.ai);
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
      msg.type === 'AI_GENERATE_ANSWER'
        ? { ...buildAnswerPrompt(msg.question, CONTEXT, msg.jobText), model: profile.ai.model }
        : buildTailoredResumePrompt(CONTEXT, msg.jobText, 'Live company', 'Live role'),
    );
  });

  it.each(tailoredMessages)('$type still rejects a blank profile before job or provider lookup', async (msg) => {
    mocks.profileToContext.mockReturnValue(' \n ');

    expect(await send(msg)).toEqual({
      text: '',
      error: 'Your profile is empty — add your details in Options first.',
    });
    expect(mocks.profileToContext).toHaveBeenCalledExactlyOnceWith(profile);
    expect(mocks.getActiveJob).not.toHaveBeenCalled();
    expect(mocks.getCachedToken).not.toHaveBeenCalled();
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it.each(tailoredMessages)('$type still prefers the active saved posting', async (msg) => {
    mocks.getActiveJob.mockResolvedValue({
      id: 'synthetic-job', url: 'https://example.invalid/job', savedAt: 1,
      company: 'Saved company', role: 'Saved role', text: 'Saved posting',
    });
    if (msg.type === 'AI_GENERATE_RESUME') msg = { ...msg, company: '', role: '' };

    expect(await send(msg)).toEqual({ text: 'generated result' });
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
      msg.type === 'AI_GENERATE_ANSWER'
        ? { ...buildAnswerPrompt(msg.question, CONTEXT, 'Saved posting'), model: profile.ai.model }
        : buildTailoredResumePrompt(CONTEXT, 'Saved posting', 'Saved company', 'Saved role'),
    );
  });

  it.each([
    { company: '', role: '', expected: 'Hello Saved company, I am applying for Saved role.' },
    { company: ' Live company ', role: ' Live role ', expected: 'Hello Live company, I am applying for Live role.' },
  ])('preserves cover-letter company/role fallback for $company / $role', async ({ company, role, expected }) => {
    mocks.getActiveJob.mockResolvedValue({
      id: 'synthetic-job', url: 'https://example.invalid/job', savedAt: 1,
      company: 'Saved company', role: 'Saved role', text: 'Saved posting',
    });

    expect(await send({ type: 'AI_GENERATE_COVER_LETTER', company, role })).toEqual({ text: expected });
    expect(mocks.profileToContext).not.toHaveBeenCalled();
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it('still resolves a managed-proxy bearer for parsing without computing context', async () => {
    profile.ai.provider = 'proxy';
    profile.ai.proxyToken = '';

    expect(await send({ type: 'AI_PARSE_RESUME', text: 'Synthetic resume' })).toEqual({ text: 'generated result' });
    expect(mocks.getCachedToken).toHaveBeenCalledOnce();
    expect(mocks.getProvider).toHaveBeenCalledExactlyOnceWith({ ...profile.ai, proxyToken: 'synthetic-bearer' });
    expect(mocks.profileToContext).not.toHaveBeenCalled();
  });

  it('still uses an explicit proxy token without a Google-token lookup', async () => {
    profile.ai.provider = 'proxy';
    profile.ai.proxyToken = 'synthetic-explicit-token';

    expect(await send({ type: 'AI_ANALYZE_JOB', text: 'Synthetic posting' })).toEqual({ text: 'generated result' });
    expect(mocks.getCachedToken).not.toHaveBeenCalled();
    expect(mocks.getProvider).toHaveBeenCalledExactlyOnceWith(profile.ai);
  });

  it('preserves the managed-proxy sign-in error for parsing', async () => {
    profile.ai.provider = 'proxy';
    profile.ai.proxyToken = '';
    mocks.getCachedToken.mockRejectedValue(new AIError('Signed out'));

    expect(await send({ type: 'AI_PARSE_RESUME', text: 'Synthetic resume' })).toEqual({
      text: '',
      error: 'Sign in to use the managed AI — open the extension to sign in, or pick another AI provider in options.',
    });
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it('ignores requests from another extension before reading the profile', () => {
    const reply = vi.fn();

    expect(listener({ type: 'AI_PARSE_RESUME', text: 'Synthetic resume' }, { id: 'another-extension' }, reply)).toBe(false);
    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('ignores content-targeted messages before reading the profile', () => {
    const reply = vi.fn();

    expect(listener({ type: 'PAGE_INFO' } as unknown as BackgroundMessage, { id: RUNTIME_ID }, reply)).toBe(false);
    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});
