// True when `hostname` IS `domain` or a subdomain of it. Plain `.endsWith(domain)`
// is a classic host-check bug — "evilgreenhouse.io".endsWith("greenhouse.io") is
// also true — so every exact-or-subdomain host comparison goes through this.
export function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * True when the eligibility badge is switched off for this hostname — i.e. it
 * exactly matches, or is a subdomain of, an entry the user disabled it on.
 * A sibling subdomain (jobs.example.com when boards.example.com is disabled)
 * is deliberately NOT covered: the control this drives is scoped to "this site
 * only", so silently spreading to sites the user hasn't visited would be
 * surprising.
 */
export function isHostDisabled(hostname: string, disabledHosts: readonly string[]): boolean {
  // The `d !== ''` guard is what actually matters, not a blank-hostname check on
  // `hostname` itself: hostMatches(h, '') degrades to h.endsWith('.'), true for
  // ANY trailing-dot FQDN ("example.com." is legal and Chrome preserves the
  // dot) — so a stray blank entry would otherwise silently kill the badge on
  // unrelated sites. addDisabledHost never stores a blank entry, but this stays
  // defensive against one reaching storage some other way (a manual edit, a
  // future bug). Excluding d === '' also makes a blank `hostname` argument safe
  // for free: hostMatches('', d) is only ever true when d === '', which this
  // already filters out — so no separate `if (!hostname)` check is needed.
  return disabledHosts.some((d) => d !== '' && hostMatches(hostname, d));
}

/**
 * Adds a host to the off-list. A no-op when the hostname is blank (location.hostname
 * is "" on a file:// page — nothing meaningful to disable there) or already
 * covered by an existing entry (exact match or a broader parent already disabled).
 */
export function addDisabledHost(hosts: readonly string[], hostname: string): string[] {
  if (!hostname || isHostDisabled(hostname, hosts)) return [...hosts];
  return [...hosts, hostname];
}

/** Removes a host from the off-list ("turn the badge back on here"). */
export function removeDisabledHost(hosts: readonly string[], hostname: string): string[] {
  return hosts.filter((h) => h !== hostname);
}
