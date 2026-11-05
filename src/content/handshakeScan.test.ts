import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScanText } from './sponsorship';

// Handshake's split job-search view keeps the job list and the filter chips in
// the same <main> as the selected posting, so the scan must read the posting
// pane only. Reading <main> made "No experience required" (a filter chip) show
// as the posting's requirement, and kept the verdict near-identical from one
// job to the next because the list dominated the text.

const POSTING =
  'Software Engineer Intern. US work authorization required. ' +
  'You will build backend services with our platform team over the summer.';
const WHOLE_PAGE =
  'No experience required  Open to US visa sponsorship  ' +
  'Python Developer  Java Developer  ' +
  POSTING;

function stubHandshake(elements: Record<string, string>) {
  const query = (sel: string) => (sel in elements ? { innerText: elements[sel] } : null);
  vi.stubGlobal('location', {
    href: 'https://app.joinhandshake.com/job-search/11407190?page=2',
    hostname: 'app.joinhandshake.com',
    pathname: '/job-search/11407190',
  });
  vi.stubGlobal('document', {
    body: { innerText: WHOLE_PAGE },
    querySelector: vi.fn(query),
    querySelectorAll: vi.fn(() => []),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Handshake scan scope', () => {
  it('reads the posting pane, not the job list and filter chips beside it', () => {
    stubHandshake({ '[data-hook="right-content"]': POSTING, main: WHOLE_PAGE });
    expect(getScanText()).toBe(POSTING);
  });

  it('still reads the older layout\'s details container', () => {
    stubHandshake({ '[data-hook="details-container"]': POSTING, main: WHOLE_PAGE });
    expect(getScanText()).toBe(POSTING);
  });

  it('prefers the posting pane when the older container is also present', () => {
    const older =
      'Older layout: the details container holds a different description of ' +
      'the same role, long enough to pass the 80-character threshold too.';
    stubHandshake({
      '[data-hook="right-content"]': POSTING,
      '[data-hook="details-container"]': older,
      main: WHOLE_PAGE,
    });
    expect(getScanText()).toBe(POSTING);
  });

  it('waits for a pane that is still filling in instead of reading the whole page', () => {
    stubHandshake({ '[data-hook="right-content"]': '', main: WHOLE_PAGE });
    expect(getScanText()).toBe('');
  });

  it('falls back to the generic page read on a standalone posting with no pane', () => {
    stubHandshake({ main: WHOLE_PAGE });
    expect(getScanText()).toBe(WHOLE_PAGE);
  });
});
