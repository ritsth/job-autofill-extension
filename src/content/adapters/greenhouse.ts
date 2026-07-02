import { type SiteAdapter, textOf, titleCaseSlug } from './types';
import { hostMatches } from '../../lib/host';

// Handles both the classic boards.greenhouse.io and the newer
// job-boards.greenhouse.io application pages.
export const greenhouseAdapter: SiteAdapter = {
  id: 'greenhouse',

  matches(url) {
    return hostMatches(url.hostname, 'greenhouse.io');
  },

  getPageInfo() {
    const role = textOf(['.app-title', 'h1.section-header', 'h1', '.job__title h1']);

    // Company: explicit element first, then the first URL path segment
    // (greenhouse URLs look like /{company}/jobs/{id}).
    let company = textOf(['.company-name', "[class*='company']", 'header img[alt]']);
    if (!company) {
      const segs = location.pathname.split('/').filter(Boolean);
      if (segs.length) company = titleCaseSlug(segs[0]);
    }

    return { company, role };
  },
};
