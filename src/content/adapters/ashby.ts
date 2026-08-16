import { type SiteAdapter, textOf, titleCaseSlug } from './types';

/**
 * Splits an Ashby posting title into role + company.
 *
 * Ashby titles a posting "{Role} @ {Company}" — e.g. "Fullstack Engineer,
 * Product Team (New Grad) @ Composio". Ashby is a client-rendered SPA with
 * hashed CSS-module class names, so the title is far more stable than any
 * selector; this mirrors the LinkedIn branch of getJobMeta(), which parses
 * document.title for the same reason.
 *
 * The first group is greedy so the split lands on the LAST " @ " — the company
 * is the trailing segment. A board index is titled "{Company} Jobs" instead: it
 * has no " @ ", so it yields empty strings rather than being misread as a role.
 */
export function parseAshbyTitle(title: string): { company: string; role: string } {
  const m = /^(.+)\s+@\s+(.+)$/.exec(title.trim());
  if (!m) return { company: '', role: '' };
  return { role: m[1].trim(), company: m[2].trim() };
}

/**
 * Reads the schema.org JobPosting that Ashby server-renders into <head>.
 *
 * This is the most reliable source here: verified present on both /{id} and
 * /{id}/application, and it sits OUTSIDE the React root, so hydration never
 * removes it. It is also absent from the board index — exactly when we want to
 * decline rather than report the board as a posting.
 *
 * `expectedId` is the job id from the URL. Ashby sets identifier.value to that
 * same id, so requiring a match means a <head> left stale by a client-side
 * navigation is rejected instead of reporting the previously-viewed posting.
 */
export function parseAshbyJobPostingLd(
  json: string,
  expectedId: string,
): { company: string; role: string } | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null; // malformed JSON-LD is common in the wild; just fall through
  }
  const node = data as {
    '@type'?: unknown;
    title?: unknown;
    identifier?: { name?: unknown; value?: unknown };
    hiringOrganization?: { name?: unknown };
  };
  if (node?.['@type'] !== 'JobPosting') return null;

  const id = node.identifier?.value;
  if (expectedId && typeof id === 'string' && id !== expectedId) return null;

  // Ashby pads the title with a leading space, hence the trim.
  const role = typeof node.title === 'string' ? node.title.trim() : '';
  const org = node.hiringOrganization?.name;
  const identName = node.identifier?.name;
  const company =
    (typeof org === 'string' && org.trim()) ||
    (typeof identName === 'string' && identName.trim()) ||
    '';
  if (!role && !company) return null;
  return { company, role };
}

// Handles jobs.ashbyhq.com postings and their /application forms.
export const ashbyAdapter: SiteAdapter = {
  id: 'ashby',

  // Exact host, like Lever. app.ashbyhq.com is Ashby's recruiter-facing ATS,
  // not a candidate board: applyStandardFills() queries the whole document, so
  // enabling autofill there would type the user's details into candidate
  // records and scorecards. Ashby serves every board from jobs.ashbyhq.com, so
  // an exact match costs no coverage.
  matches(url) {
    return url.hostname === 'jobs.ashbyhq.com';
  },

  getPageInfo() {
    // Ashby URLs are /{company}/{jobId}[/application].
    const segs = location.pathname.split('/').filter(Boolean);

    let role = '';
    let company = '';

    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      const parsed = parseAshbyJobPostingLd(el.textContent ?? '', segs[1] ?? '');
      if (parsed) {
        role = parsed.role;
        company = parsed.company;
        break;
      }
    }

    if (!role || !company) {
      const fromTitle = parseAshbyTitle(document.title);
      role ||= fromTitle.role;
      company ||= fromTitle.company;
    }

    if (!role) role = textOf(['main h1', 'h1', 'main h2', 'h2']);
    if (!company && segs.length) company = titleCaseSlug(segs[0]);

    return { company, role };
  },
};
