import { describe, it, expect } from 'vitest';
import { companyFromWorkdayUrl } from './workday';

// Every hostname/pathname pair below is copied from a real, currently-live
// Workday-hosted URL (found via web search while working on #178), not
// invented — see the function's doc comment for why the three domains need
// different rules.
describe('companyFromWorkdayUrl — tenant extraction across all three Workday domains', () => {
  describe('*.myworkdayjobs.com — the tenant is the subdomain', () => {
    it('reads the tenant straight off the subdomain', () => {
      expect(
        companyFromWorkdayUrl('nvidia.wd5.myworkdayjobs.com', '/NVIDIAExternalCareerSite'),
      ).toBe('Nvidia');
      expect(companyFromWorkdayUrl('workday.wd5.myworkdayjobs.com', '/Workday')).toBe('Workday');
      expect(companyFromWorkdayUrl('path.wd1.myworkdayjobs.com', '/External')).toBe('Path');
    });

    it('caught in review: a path that happens to contain "recruiting" must not steal the tenant from another domain\'s rule', () => {
      // Before the fix, the /recruiting/ rule ran unconditionally regardless
      // of domain, so this returned "Acme" (myworkdaysite.com's rule) instead
      // of "Nvidia" (myworkdayjobs.com's own, correct rule).
      expect(companyFromWorkdayUrl('nvidia.wd5.myworkdayjobs.com', '/recruiting/acme')).toBe(
        'Nvidia',
      );
    });

    it('caught in review: a bare apex with no tenant subdomain reports no company', () => {
      // hostMatches('myworkdayjobs.com', 'myworkdayjobs.com') is true (exact
      // match), but there's no subdomain to read a tenant from. Before the
      // fix this returned "Myworkdayjobs" — the domain's own label.
      expect(companyFromWorkdayUrl('myworkdayjobs.com', '/something')).toBe('');
    });
  });

  describe('*.myworkday.com — the subdomain is an infra pod, the tenant is path segment 0', () => {
    it('extracts the tenant from the path when the subdomain is a wdN pod', () => {
      expect(companyFromWorkdayUrl('wd5.myworkday.com', '/unf/d/task/1422$1841.htmld')).toBe(
        'Unf',
      );
      expect(companyFromWorkdayUrl('wd12.myworkday.com', '/bsu/wdhelp/helpcenter')).toBe('Bsu');
      expect(
        companyFromWorkdayUrl('wd108.myworkday.com', '/msk/d/task/2998$46522.htmld'),
      ).toBe('Msk');
      expect(companyFromWorkdayUrl('wd10.myworkday.com', '/nait/d/task/2998$46522.htmld')).toBe(
        'Nait',
      );
      expect(
        companyFromWorkdayUrl('wd115.myworkday.com', '/saintfrancis/d/task/2998$46522.htmld'),
      ).toBe('Saintfrancis');
      expect(companyFromWorkdayUrl('wd503.myworkday.com', '/svsu/d/home.htmld')).toBe('Svsu');
    });

    it('was the reported bug: the pod id alone used to leak through as the company', () => {
      // No path — nothing to fall back to, so the correct result is empty, not
      // the pod id. An empty company surfaces the "enter a company" prompt
      // instead of silently shipping a cover letter addressed to "Wd5".
      expect(companyFromWorkdayUrl('wd5.myworkday.com', '/')).toBe('');
      expect(companyFromWorkdayUrl('wd5.myworkday.com', '')).toBe('');
    });

    it('treats an impl/staging environment subdomain the same way', () => {
      expect(companyFromWorkdayUrl('impl.wd5.myworkday.com', '/')).toBe('');
      expect(companyFromWorkdayUrl('impl-services.wd5.myworkday.com', '/')).toBe('');
    });
  });

  describe('*.myworkdaysite.com — the tenant follows "/recruiting/" in the path', () => {
    it('reads the tenant after /recruiting/, regardless of the subdomain', () => {
      // jobs.* subdomain, no locale prefix.
      expect(
        companyFromWorkdayUrl(
          'jobs.myworkdaysite.com',
          '/recruiting/acme/Search',
        ),
      ).toBe('Acme');
      // wdN.* subdomain, no locale prefix.
      expect(
        companyFromWorkdayUrl(
          'wd5.myworkdaysite.com',
          '/recruiting/aaregional/Search/0/refreshFacet/318c8bb6f553100021d223d9780d30be',
        ),
      ).toBe('Aaregional');
      // wdN.* subdomain WITH a locale segment before "recruiting" — this is
      // exactly the case a naive "first path segment" rule gets wrong, since
      // segment 0 here is "en-US", not the tenant.
      expect(
        companyFromWorkdayUrl('wd1.myworkdaysite.com', '/en-US/recruiting/abinbev/Search'),
      ).toBe('Abinbev');
    });

    it('was the reported bug: the pod id used to leak through here too', () => {
      expect(companyFromWorkdayUrl('wd1.myworkdaysite.com', '/')).toBe('');
    });
  });

  describe('edge cases', () => {
    it('still excludes a bare www subdomain', () => {
      expect(companyFromWorkdayUrl('www.myworkday.com', '/')).toBe('');
    });

    it('does not treat a trailing "recruiting" with nothing after it as a match', () => {
      // Caught by this test suite during development: the fix's first draft
      // fell through to the segment-0 fallback here and returned "Recruiting"
      // — the literal marker word, not a tenant.
      expect(companyFromWorkdayUrl('wd5.myworkdaysite.com', '/recruiting')).toBe('');
      expect(companyFromWorkdayUrl('wd5.myworkdaysite.com', '/recruiting/')).toBe('');
      // Same failure mode with a locale prefix ahead of "recruiting" — must not
      // fall through and return "En Us" either.
      expect(companyFromWorkdayUrl('wd1.myworkdaysite.com', '/en-US/recruiting')).toBe('');
    });

    it('matches "recruiting" case-insensitively', () => {
      expect(companyFromWorkdayUrl('wd5.myworkdaysite.com', '/Recruiting/acme')).toBe('Acme');
    });
  });
});
