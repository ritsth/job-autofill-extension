import { type SiteAdapter, textOf, titleCaseSlug } from './types';

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
      h.endsWith('myworkdayjobs.com') ||
      h.endsWith('myworkday.com') ||
      h.endsWith('myworkdaysite.com')
    );
  },

  getPageInfo() {
    const role = textOf([
      '[data-automation-id="jobPostingHeader"]',
      '[data-automation-id="jobTitle"]',
      'h1',
      'h2',
    ]);

    // Workday has no reliable company element; the tenant subdomain is the best
    // signal, e.g. nvidia.wd5.myworkdayjobs.com → "Nvidia".
    let company = textOf(['[data-automation-id="company"]', "[class*='company']"]);
    if (!company) {
      const sub = location.hostname.split('.')[0];
      if (sub && sub !== 'www') company = titleCaseSlug(sub);
    }

    return { company, role };
  },
};
