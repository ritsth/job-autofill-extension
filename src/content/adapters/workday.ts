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
 *   work across all three domains — the function below dispatches on which
 *   domain matched before applying any rule, rather than applying one rule's
 *   path shape to another domain's URLs.
 */
export function companyFromWorkdayUrl(hostname: string, pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);

  // Dispatch on domain FIRST. The three rules above are domain-specific
  // contracts, not universal heuristics — applying the /recruiting/ path rule
  // regardless of domain, as an earlier version of this function did, let a
  // myworkdayjobs.com URL whose site name happened to contain "recruiting"
  // hijack a perfectly good subdomain-derived tenant (caught in review).
  if (hostMatches(hostname, 'myworkdaysite.com')) {
    // The tenant follows "recruiting" in the path; there is no subdomain
    // fallback on this domain; a page with no "recruiting" segment (or
    // nothing after it) has no tenant to report.
    const recruitingIdx = segs.findIndex((s) => s.toLowerCase() === 'recruiting');
    return recruitingIdx !== -1 && segs[recruitingIdx + 1]
      ? titleCaseSlug(segs[recruitingIdx + 1])
      : '';
  }

  if (hostMatches(hostname, 'myworkdayjobs.com')) {
    // The tenant IS the subdomain — but only when there IS one. A bare
    // `myworkdayjobs.com` (also caught in review) has `labels.length === 2`,
    // so `sub` would be the domain's own first label ("myworkdayjobs"), not a
    // tenant.
    const labels = hostname.split('.');
    const sub = labels[0] ?? '';
    return labels.length > 2 && sub && !INFRA_LABEL.test(sub) ? titleCaseSlug(sub) : '';
  }

  // myworkday.com: the subdomain is Workday's own pod id (wd5, wd12, …), not
  // the tenant. The tenant is the first path segment instead. An empty result
  // here (no path, or the pod id has no path to fall back to) is the correct
  // outcome: it surfaces the "enter a company" prompt instead of shipping a
  // wrong one.
  const sub = hostname.split('.')[0] ?? '';
  if (sub && !INFRA_LABEL.test(sub)) return titleCaseSlug(sub);
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
