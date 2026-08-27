import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DisabledSites } from './DisabledSites';

// renderToStaticMarkup needs no DOM, so this stays in the default node env —
// see the file header on DisabledSites.tsx for why the list has to live in its
// own module to be testable at all.
const html = (node: React.ReactElement): string => renderToStaticMarkup(node);

describe('DisabledSites — the badge off-list on the Options page', () => {
  it('shows the empty-state copy and no rows when nothing is disabled', () => {
    const markup = html(<DisabledSites hosts={[]} onEnable={vi.fn()} />);
    expect(markup).toContain('No sites turned off');
    expect(markup).not.toContain('<button');
  });

  it('renders one row per disabled host', () => {
    const markup = html(<DisabledSites hosts={['b.com', 'a.com']} onEnable={vi.fn()} />);
    expect(markup).toContain('a.com');
    expect(markup).toContain('b.com');
    expect((markup.match(/<button/g) ?? []).length).toBe(2);
  });

  it('lists hosts alphabetically regardless of input (storage) order', () => {
    // Storage order is insertion order — most-recently-disabled last — which
    // isn't a useful reading order for a list the user scans to find one site.
    const markup = html(<DisabledSites hosts={['z.com', 'a.com', 'm.com']} onEnable={vi.fn()} />);
    const order = [...markup.matchAll(/🚫 ([^<]+)</g)].map((m) => m[1]);
    expect(order).toEqual(['a.com', 'm.com', 'z.com']);
  });

  it('gives each row an aria-label naming its own host', () => {
    const markup = html(<DisabledSites hosts={['boards.greenhouse.io']} onEnable={vi.fn()} />);
    expect(markup).toContain('aria-label="Turn the badge back on for boards.greenhouse.io"');
  });
});
