import { type SiteAdapter, textOf, titleCaseSlug } from './types';

// Handles jobs.lever.co postings and their /apply forms.
export const leverAdapter: SiteAdapter = {
  id: 'lever',

  matches(url) {
    return url.hostname === 'jobs.lever.co';
  },

  getPageInfo() {
    const role = textOf(['.posting-headline h2', '.posting-header h2', 'h2', 'h1']);

    // Lever URLs are /{company}/{postingId}[/apply].
    let company = textOf(['.main-header-logo img[alt]', "[class*='company']"]);
    if (!company) {
      const segs = location.pathname.split('/').filter(Boolean);
      if (segs.length) company = titleCaseSlug(segs[0]);
    }

    return { company, role };
  },
};
