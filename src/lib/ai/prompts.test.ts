import { describe, expect, it } from 'vitest';
import { MAX_TEXT } from '../savedJobs';
import {
  buildAnswerPrompt,
  buildJobEligibilityPrompt,
  buildTailoredResumePrompt,
} from './prompts';

describe('prompt builders honor MAX_TEXT', () => {
  const longJob = 'x'.repeat(MAX_TEXT + 500);

  it('keeps the full saved posting in the answer prompt', () => {
    const result = buildAnswerPrompt('Question?', 'Profile', longJob);
    expect(result.prompt).toContain('x'.repeat(MAX_TEXT));
    expect(result.prompt).not.toContain('x'.repeat(MAX_TEXT + 1));
  });

  it('keeps the full saved posting in the eligibility prompt', () => {
    const result = buildJobEligibilityPrompt(longJob);
    expect(result.prompt).toContain('x'.repeat(MAX_TEXT));
    expect(result.prompt).not.toContain('x'.repeat(MAX_TEXT + 1));
  });

  it('keeps the full saved posting in the tailored resume prompt', () => {
    const result = buildTailoredResumePrompt('Profile', longJob);
    expect(result.prompt).toContain('x'.repeat(MAX_TEXT));
    expect(result.prompt).not.toContain('x'.repeat(MAX_TEXT + 1));
  });
});
