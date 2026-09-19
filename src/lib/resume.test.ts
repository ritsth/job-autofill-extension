import { describe, it, expect } from 'vitest';
import { resumeFilename } from './resume';

// The slug rules themselves (special characters, the 60-char cap, trimming)
// are covered once in filename.test.ts — what matters here is only that this
// caller passes the right prefix through to documentFilename (#327).
describe('resumeFilename', () => {
  it('prefixes the company/role slug with "resume"', () => {
    expect(resumeFilename('Acme Corp', 'Software Engineer')).toBe(
      'resume-acme-corp-software-engineer'
    );
  });

  it('is the bare prefix when there is no company or role', () => {
    expect(resumeFilename('', '')).toBe('resume');
  });
});
