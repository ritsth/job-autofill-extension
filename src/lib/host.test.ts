import { describe, it, expect } from 'vitest';
import { addDisabledHost, hostMatches, isHostDisabled, removeDisabledHost } from './host';

describe('hostMatches', () => {
  it('matches the exact domain', () => {
    expect(hostMatches('linkedin.com', 'linkedin.com')).toBe(true);
  });

  it('matches a real subdomain', () => {
    expect(hostMatches('www.linkedin.com', 'linkedin.com')).toBe(true);
    expect(hostMatches('jobs.lever.co', 'lever.co')).toBe(true);
  });

  it('rejects a look-alike host that merely ends with the domain string', () => {
    // The bug this guards against: "evillinkedin.com".endsWith("linkedin.com") is
    // true, so a naive .endsWith() check would wrongly treat this as LinkedIn.
    expect(hostMatches('evillinkedin.com', 'linkedin.com')).toBe(false);
    expect(hostMatches('notmyworkday.com', 'myworkday.com')).toBe(false);
  });

  it('rejects an unrelated host', () => {
    expect(hostMatches('example.com', 'linkedin.com')).toBe(false);
  });
});

describe('isHostDisabled — per-site eligibility badge off-switch', () => {
  it('is disabled for the exact stored host', () => {
    expect(isHostDisabled('boards.greenhouse.io', ['boards.greenhouse.io'])).toBe(true);
  });

  it('is disabled for a deeper subdomain of a stored host', () => {
    expect(isHostDisabled('sub.boards.greenhouse.io', ['boards.greenhouse.io'])).toBe(true);
  });

  it('leaves a SIBLING subdomain on — "this site only" must not spread', () => {
    // jobs.greenhouse.io and boards.greenhouse.io are different sites to the
    // user even though they share a parent domain; disabling one must not
    // silently disable the other.
    expect(isHostDisabled('jobs.greenhouse.io', ['boards.greenhouse.io'])).toBe(false);
  });

  it('leaves the parent domain on', () => {
    expect(isHostDisabled('greenhouse.io', ['boards.greenhouse.io'])).toBe(false);
  });

  it('rejects a look-alike host, same guard as hostMatches', () => {
    expect(isHostDisabled('evilboards.greenhouse.io', ['boards.greenhouse.io'])).toBe(false);
  });

  it('is never disabled against an empty list', () => {
    expect(isHostDisabled('boards.greenhouse.io', [])).toBe(false);
  });

  it('never matches on a blank hostname or a blank entry', () => {
    // hostMatches(h, '') degrades to h.endsWith('.'), which is true for any
    // trailing-dot FQDN ("example.com." is legal and Chrome keeps the dot) — so
    // a stray blank entry must not become "everything with a trailing dot".
    expect(isHostDisabled('', ['boards.greenhouse.io'])).toBe(false);
    expect(isHostDisabled('example.com.', [''])).toBe(false);
  });
});

describe('addDisabledHost — "turn off on this site only"', () => {
  it('appends a new host', () => {
    expect(addDisabledHost(['a.com'], 'b.com')).toEqual(['a.com', 'b.com']);
  });

  it('does not duplicate an entry that is already disabled', () => {
    expect(addDisabledHost(['b.com'], 'b.com')).toEqual(['b.com']);
  });

  it('is a no-op when a broader parent already covers the host', () => {
    expect(addDisabledHost(['greenhouse.io'], 'boards.greenhouse.io')).toEqual(['greenhouse.io']);
  });

  it('rejects a blank hostname without mutating the list', () => {
    // location.hostname is "" on a file:// page — there is nothing meaningful
    // to disable, and storing "" would make every hostMatches(h, "") check
    // behave oddly (a blank domain suffix matches everything).
    expect(addDisabledHost(['a.com'], '')).toEqual(['a.com']);
  });
});

describe('removeDisabledHost — "turn back on" in Options', () => {
  it('removes the matching entry', () => {
    expect(removeDisabledHost(['a.com', 'b.com'], 'a.com')).toEqual(['b.com']);
  });

  it('leaves other entries untouched', () => {
    expect(removeDisabledHost(['a.com', 'b.com', 'c.com'], 'b.com')).toEqual(['a.com', 'c.com']);
  });

  it('is a no-op when the host is not in the list', () => {
    expect(removeDisabledHost(['a.com'], 'z.com')).toEqual(['a.com']);
  });
});
