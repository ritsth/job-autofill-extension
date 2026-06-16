export interface SiteAdapter {
  id: 'greenhouse' | 'lever' | 'workday';
  /** True if this adapter handles the current page. */
  matches(url: URL): boolean;
  /** Best-effort company + role for cover-letter tailoring. */
  getPageInfo(): { company: string; role: string };
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function textOf(selectors: string[]): string {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

export { titleCaseSlug };
