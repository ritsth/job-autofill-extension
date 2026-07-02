// True when `hostname` IS `domain` or a subdomain of it. Plain `.endsWith(domain)`
// is a classic host-check bug — "evilgreenhouse.io".endsWith("greenhouse.io") is
// also true — so every exact-or-subdomain host comparison goes through this.
export function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
