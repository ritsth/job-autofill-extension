import { describe, expect, it } from 'vitest';
import { generatorResultIsCurrent, postingKey } from './sponsorship';

// #363: a cover letter / tailored resume that finishes generating after the
// user has moved to another posting must not download.

const JOB_A = 'https://www.linkedin.com/jobs/search/?currentJobId=111';
const JOB_B = 'https://www.linkedin.com/jobs/search/?currentJobId=222';
const metaA = { company: 'Acme', role: 'Engineer' };
const metaB = { company: 'Globex', role: 'Designer' };

describe('postingKey', () => {
  it('distinguishes postings by URL, company and role', () => {
    expect(postingKey(JOB_A, metaA)).toBe(postingKey(JOB_A, { ...metaA }));
    expect(postingKey(JOB_A, metaA)).not.toBe(postingKey(JOB_B, metaA));
    expect(postingKey(JOB_A, metaA)).not.toBe(postingKey(JOB_A, metaB));
  });

  it("can't be collided by a delimiter inside a field", () => {
    expect(postingKey(JOB_A, { company: 'A|B', role: 'C' })).not.toBe(
      postingKey(JOB_A, { company: 'A', role: 'B|C' }),
    );
  });
});

describe('generatorResultIsCurrent (#363)', () => {
  const builtFor = postingKey(JOB_A, metaA);

  it('downloads when nothing changed', () => {
    expect(
      generatorResultIsCurrent({ builtFor, renderedNow: builtFor, startUrl: JOB_A, urlNow: JOB_A }),
    ).toBe(true);
  });

  it('does not download after the user switched to another posting', () => {
    // The new posting's badge has rendered.
    expect(
      generatorResultIsCurrent({
        builtFor,
        renderedNow: postingKey(JOB_B, metaB),
        startUrl: JOB_A,
        urlNow: JOB_B,
      }),
    ).toBe(false);
  });

  it('does not download when the URL moved but the new badge has not rendered yet', () => {
    // The watcher debounces, so the switch can land before the re-render.
    expect(
      generatorResultIsCurrent({ builtFor, renderedNow: builtFor, startUrl: JOB_A, urlNow: JOB_B }),
    ).toBe(false);
  });

  it('does not download when the same URL now shows a different posting', () => {
    // A board that swaps postings in place without touching the URL.
    expect(
      generatorResultIsCurrent({
        builtFor,
        renderedNow: postingKey(JOB_A, metaB),
        startUrl: JOB_A,
        urlNow: JOB_A,
      }),
    ).toBe(false);
  });

  it('still downloads when the SAME posting re-rendered meanwhile', () => {
    // "Click Generate, then AI check while waiting": the AI check rebuilds the
    // badge with the same URL and meta. A badgeGeneration-based guard would
    // drop this PDF even though it is for the job still on screen.
    const rerendered = postingKey(JOB_A, { ...metaA });
    expect(
      generatorResultIsCurrent({ builtFor, renderedNow: rerendered, startUrl: JOB_A, urlNow: JOB_A }),
    ).toBe(true);
  });
});
