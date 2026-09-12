// Split out of Popup.tsx (#323) so it's testable via renderToStaticMarkup
// without importing the whole popup component and its transitive dependencies.

import { MAX_TEXT } from '../lib/savedJobs';

export function SavedJobTextMeta({ textLength }: { textLength: number }) {
  const reachedCap = textLength >= MAX_TEXT;

  return (
    <span
      title={
        reachedCap
          ? `Saved text reached the ${MAX_TEXT.toLocaleString()}-character cap and may have been trimmed.`
          : undefined
      }
    >
      {textLength.toLocaleString()} chars{reachedCap ? ' (trimmed)' : ''}
    </span>
  );
}
