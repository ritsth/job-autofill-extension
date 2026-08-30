// True when `hostname` IS `domain` or a subdomain of it. Plain `.endsWith(domain)`
// is a classic host-check bug — "evilgreenhouse.io".endsWith("greenhouse.io") is
// also true — so every exact-or-subdomain host comparison goes through this.
export function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * The stored entry that switches the eligibility badge off for this hostname —
 * an exact match, or a broader domain `hostname` is a subdomain of — or
 * undefined when nothing covers it. Note the entry returned may differ from
 * `hostname` itself: visiting sub.example.com when "example.com" was the entry
 * disabled returns "example.com", not "sub.example.com" — there is nothing to
 * remove BY "sub.example.com" in that case, only by the entry that actually
 * matched. A sibling subdomain (jobs.example.com when boards.example.com is
 * disabled) is deliberately NOT covered: the control this drives is scoped to
 * "this site only", so silently spreading to sites the user hasn't visited
 * would be surprising.
 */
export function disabledHostFor(
  hostname: string,
  disabledHosts: readonly string[],
): string | undefined {
  // The `d !== ''` guard is what actually matters, not a blank-hostname check on
  // `hostname` itself: hostMatches(h, '') degrades to h.endsWith('.'), true for
  // ANY trailing-dot FQDN ("example.com." is legal and Chrome preserves the
  // dot) — so a stray blank entry would otherwise silently kill the badge on
  // unrelated sites. addDisabledHost never stores a blank entry, but this stays
  // defensive against one reaching storage some other way (a manual edit, a
  // future bug). Excluding d === '' also makes a blank `hostname` argument safe
  // for free: hostMatches('', d) is only ever true when d === '', which this
  // already filters out — so no separate `if (!hostname)` check is needed.
  return disabledHosts.find((d) => d !== '' && hostMatches(hostname, d));
}

/** True when the eligibility badge is switched off for this hostname. */
export function isHostDisabled(hostname: string, disabledHosts: readonly string[]): boolean {
  return disabledHostFor(hostname, disabledHosts) !== undefined;
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
