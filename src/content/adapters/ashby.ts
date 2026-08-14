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

// Handles jobs.ashbyhq.com postings and their /application forms.
export const ashbyAdapter: SiteAdapter = {
  id: 'ashby',

  // Exact host, like Lever: app.ashbyhq.com is Ashby's recruiter-facing
  // product, not a candidate job board, and must not activate autofill.
  matches(url) {
    return url.hostname === 'jobs.ashbyhq.com';
  },

  getPageInfo() {
    const fromTitle = parseAshbyTitle(document.title);
    const role = fromTitle.role || textOf(['main h1', 'h1', 'main h2', 'h2']);

    // Ashby URLs are /{company}/{jobId}[/application].
    let company = fromTitle.company;
    if (!company) {
      const segs = location.pathname.split('/').filter(Boolean);
      if (segs.length) company = titleCaseSlug(segs[0]);
    }

    return { company, role };
  },
};
