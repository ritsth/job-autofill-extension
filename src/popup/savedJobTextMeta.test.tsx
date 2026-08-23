import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAX_TEXT } from '../lib/savedJobs';
import { SavedJobTextMeta } from './Popup';

describe('SavedJobTextMeta', () => {
  it('shows an ordinary count below the storage cap', () => {
    const markup = renderToStaticMarkup(<SavedJobTextMeta textLength={MAX_TEXT - 1} />);

    expect(markup).toContain(`${(MAX_TEXT - 1).toLocaleString()} chars`);
    expect(markup).not.toContain('trimmed');
    expect(markup).not.toContain('title=');
  });

  it('marks text that reached the storage cap', () => {
    const markup = renderToStaticMarkup(<SavedJobTextMeta textLength={MAX_TEXT} />);

    expect(markup).toContain(`${MAX_TEXT.toLocaleString()} chars (trimmed)`);
    expect(markup).toContain(
      `title="Saved text reached the ${MAX_TEXT.toLocaleString()}-character cap and may have been trimmed."`,
    );
  });
});
