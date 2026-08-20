import { type SiteAdapter, textOf, titleCaseSlug } from './types';
import { hostMatches } from '../../lib/host';

// Workday's own pod/environment subdomains and generic path prefixes — never a
// customer tenant name.
const INFRA_LABEL = /^(www|jobs|impl(-\w+)?|wd\d+)$/;

/**
 * Derives the tenant/company name from a Workday URL. The three domains this
 * adapter matches put the tenant in different places — verified against real
 * Workday-hosted URLs on each, not assumed:
 *
 * - `*.myworkdayjobs.com`: the tenant IS the subdomain, e.g.
 *   `nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite` → "Nvidia".
 * - `*.myworkday.com`: the subdomain is Workday's own pod id (wd5, wd12, …),
 *   and the tenant is the first path segment instead, e.g.
 *   `wd5.myworkday.com/unf/d/task/…` → "Unf",
 *   `wd12.myworkday.com/bsu/wdhelp/helpcenter` → "Bsu".
 * - `*.myworkdaysite.com`: career sites are keyed off `/recruiting/{tenant}/`
 *   in the PATH, regardless of subdomain — both `jobs.*` and `wd{N}.*` are
 *   seen in the wild, and an optional locale segment can sit before
 *   `recruiting`, e.g. `wd5.myworkdaysite.com/recruiting/aaregional/…` →
 *   "Aaregional", `wd1.myworkdaysite.com/en-US/recruiting/abinbev/…` →
 *   "Abinbev". This is why a single "always use path segment 0" rule doesn't
 *   work across all three domains.
 */
export function companyFromWorkdayUrl(hostname: string, pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);

  // Once "recruiting" appears anywhere in the path, commit to reading the
  // tenant relative to it — this is unambiguously a myworkdaysite.com-style
  // URL. Falling through to the segment-0 fallback below when there's nothing
  // after "recruiting" would grab the literal word "recruiting" itself (or a
  // locale prefix like "en-US"), not a tenant, so a bare listing page
  // correctly yields '' instead of a fake company name.
  const recruitingIdx = segs.findIndex((s) => s.toLowerCase() === 'recruiting');
  if (recruitingIdx !== -1) {
    return segs[recruitingIdx + 1] ? titleCaseSlug(segs[recruitingIdx + 1]) : '';
  }

  const sub = hostname.split('.')[0] ?? '';
  if (sub && !INFRA_LABEL.test(sub)) return titleCaseSlug(sub);

  // Subdomain is an infra/pod label rather than the tenant — myworkday.com
  // puts the tenant as the first path segment instead. An empty result here
  // (no path, or the whole subdomain+path is infra) is the correct outcome:
  // it surfaces the "enter a company" prompt instead of shipping a wrong one.
  return segs.length ? titleCaseSlug(segs[0]) : '';
}

// Workday application forms (*.myworkdayjobs.com, *.myworkday.com). Unlike
// Greenhouse/Lever, Workday identifies fields with data-automation-id attributes
// rather than <label> elements — the shared label reader humanizes those so the
// standard rules still match (firstName → "first name", etc.). Workday is a
// multi-step wizard, so the user clicks "Fill this page" on each step.
export const workdayAdapter: SiteAdapter = {
  id: 'workday',

  matches(url) {
    const h = url.hostname;
    return (
      hostMatches(h, 'myworkdayjobs.com') ||
      hostMatches(h, 'myworkday.com') ||
      hostMatches(h, 'myworkdaysite.com')
    );
  },

  getPageInfo() {
    const role = textOf([
      '[data-automation-id="jobPostingHeader"]',
      '[data-automation-id="jobTitle"]',
      'h1',
      'h2',
    ]);

    // Workday has no reliable company element; fall back to the URL. See
    // companyFromWorkdayUrl for how the tenant is found — it differs by domain.
    let company = textOf(['[data-automation-id="company"]', "[class*='company']"]);
    if (!company) company = companyFromWorkdayUrl(location.hostname, location.pathname);

    return { company, role };
  },
};
