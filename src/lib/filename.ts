// Shared filename builder for the generated documents (cover letter, tailored
// resume). Both download flows want the same filesystem-safe
// "{prefix}-{company}-{role}" shape, and the slug rules below — what counts as
// a separator, the length cap, trimming a hyphen the cap itself exposed — only
// stay consistent between them by living in one place (#327).

/**
 * Cap on the company/role slug, NOT counting the prefix — so a longer prefix
 * ("cover-letter" vs "resume") never eats into how much of the company and role
 * survive in the name.
 */
const MAX_SLUG_LENGTH = 60;

/**
 * Builds a filesystem-safe filename (without extension) as
 * `{prefix}-{company}-{role}`, or a bare `{prefix}` when neither is supplied.
 */
export function documentFilename(prefix: string, company: string, role: string): string {
  const slug = [company, role]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    // The cap can land exactly on the company/role join separator, leaving a
    // trailing hyphen that the trim above ran too early to see.
    .replace(/-+$/, '');
  return `${prefix}${slug ? '-' + slug : ''}`;
}
