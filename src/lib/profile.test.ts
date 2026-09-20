import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, GEMINI_MODELS } from './ai/models';
import {
  CONTEXT_TEXT_BUDGET,
  DEFAULT_PROFILE,
  RESUME_TEXT_BUDGET,
  computeContextUsage,
  onProfileChanged,
  profileToContext,
  upsertDocument,
  type Profile,
  type UploadedDoc,
} from './profile';

const STORAGE_KEY = 'profile';

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
) => void;
let storageChangeListeners: Set<StorageChangeListener>;

beforeEach(() => {
  storageChangeListeners = new Set();
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => {
          storageChangeListeners.add(listener);
        }),
        removeListener: vi.fn((listener: StorageChangeListener) => {
          storageChangeListeners.delete(listener);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function emitStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
): void {
  for (const listener of storageChangeListeners) listener(changes, area);
}

describe('onProfileChanged', () => {
  it('calls back with the profile for local changes', () => {
    const callback = vi.fn();
    const next: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane' },
    };
    onProfileChanged(callback);

    emitStorageChange({ [STORAGE_KEY]: { newValue: next } }, 'local');

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(next);
  });

  it('ignores profile changes from the sync area', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange({ [STORAGE_KEY]: { newValue: DEFAULT_PROFILE } }, 'sync');

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores unrelated local storage changes', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange({ savedJobs: { newValue: [] } }, 'local');

    expect(callback).not.toHaveBeenCalled();
  });

  it('uses the full default profile when the profile key is removed', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange({ [STORAGE_KEY]: { newValue: undefined } }, 'local');

    expect(callback).toHaveBeenCalledWith(DEFAULT_PROFILE);
  });

  it('stops delivering changes after unsubscribe', () => {
    const callback = vi.fn();
    const unsubscribe = onProfileChanged(callback);

    unsubscribe();
    emitStorageChange({ [STORAGE_KEY]: { newValue: DEFAULT_PROFILE } }, 'local');

    expect(callback).not.toHaveBeenCalled();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledOnce();
  });

  it('deep-merges a partial profile with defaults', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange(
      { [STORAGE_KEY]: { newValue: { personal: { firstName: 'Jane' } } } },
      'local',
    );

    expect(callback).toHaveBeenCalledWith({
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane' },
    });
  });

  // The disabledHosts fallback that used to be asserted here moved out with the
  // field itself in #347 — see settings.test.ts, which keeps the same guard.

  it.each([
    ['unknown', 'gemini-2.0-flash', DEFAULT_MODEL],
    ['known', GEMINI_MODELS[0].id, GEMINI_MODELS[0].id],
  ])('normalizes a %s stored model', (_kind, storedModel, expectedModel) => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange(
      { [STORAGE_KEY]: { newValue: { ai: { model: storedModel } } } },
      'local',
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: { ...DEFAULT_PROFILE.ai, model: expectedModel },
      }),
    );
  });
});

describe('profileToContext', () => {
  it('returns an empty string for a completely empty profile', () => {
    // Regression test for #169: profileToContext used to unconditionally push a
    // "Name:" line, so an empty profile silently produced "Name:" instead of "",
    // which meant downstream code had no way to detect the profile was empty.
    expect(profileToContext(DEFAULT_PROFILE)).toBe('');
  });

  it('produces a clean single Name line when only firstName is set', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane' },
    };
    expect(profileToContext(p)).toBe('Name: Jane');
  });

  it('produces a clean single Name line when only lastName is set (no stray space)', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, lastName: 'Smith' },
    };
    expect(profileToContext(p)).toBe('Name: Smith');
  });

  it('renders work entries without dangling "at" or "from" when fields are missing', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      workHistory: [
        { title: 'Engineer', company: '', startDate: '', endDate: '', description: '' },
        { title: '', company: 'Google', startDate: '2023', endDate: '', description: '' },
      ],
      education: [
        { degree: 'BS', field: '', school: '', graduationYear: '' },
        { degree: '', field: '', school: 'MIT', graduationYear: '2025' },
      ],
    };
    const result = profileToContext(p);
    expect(result).toContain('- Engineer');
    expect(result).toContain('- Google (2023–present)');
    expect(result).toContain('- BS');
    expect(result).toContain('- MIT (2025)');
    expect(result).not.toContain('  '); // no double space
    expect(result).not.toContain(' at ');
    expect(result).not.toContain(' from ');
  });

  it('still includes the other sections for a populated profile', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane', lastName: 'Doe', city: 'Atlanta' },
      skills: ['TypeScript', 'React'],
      workHistory: [
        { company: 'Acme', title: 'Engineer', startDate: '2022', endDate: '', description: 'Built things' },
      ],
    };
    const result = profileToContext(p);
    expect(result).toContain('Name: Jane Doe');
    expect(result).toContain('Location: Atlanta');
    expect(result).toContain('Skills: TypeScript, React');
    expect(result).toContain('Work history:');
    expect(result).toContain('Acme');
  });

  // #251: profileToContext used to concatenate resumeText + every document's
  // full text with no limit, so a few uploaded documents could push the whole
  // prompt past the proxy's hard MAX_PROMPT_CHARS ceiling and fail every AI
  // call. These pin the cap. (Documents used to share the pool via a *fixed*
  // 8,000-char-per-document cap; that's now a dynamic fair share instead —
  // see the "dynamic per-document share" describe block below for the
  // algorithm itself. These tests just confirm profileToContext still
  // respects the overall ceiling regardless of how it's divided internally.)
  describe('context size budget (#251)', () => {
    function doc(name: string, length: number): UploadedDoc {
      return { id: name, name, text: 'x'.repeat(length), addedAt: 0 };
    }

    // Content is a run of 'x' characters and nothing else in these tests
    // contains 'x' (labels, filenames, field names), so the maximal 'x' runs in
    // the output are exactly the per-field contributions, in order — a more
    // robust way to pin exact lengths than slicing the string on its own labels.
    function xRuns(s: string): number[] {
      return (s.match(/x+/g) ?? []).map((run) => run.length);
    }

    it('is unchanged for a normal-sized profile — no regression for the common case', () => {
      const p: Profile = {
        ...DEFAULT_PROFILE,
        personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane' },
        resumeText: 'A modest resume, well under budget.',
        documents: [doc('cover-letter.pdf', 500), doc('transcript.pdf', 300)],
      };
      const result = profileToContext(p);
      // Every character of both documents survives untouched.
      expect(result).toContain('x'.repeat(500));
      expect(result).toContain('x'.repeat(300));
      expect(result).toContain('A modest resume, well under budget.');
    });

    it('caps the resume at RESUME_TEXT_BUDGET', () => {
      const p: Profile = { ...DEFAULT_PROFILE, resumeText: 'x'.repeat(RESUME_TEXT_BUDGET + 5_000) };
      const result = profileToContext(p);
      expect(xRuns(result)).toEqual([RESUME_TEXT_BUDGET]);
    });

    it('splits the shared budget evenly between two equally-oversized documents', () => {
      const p: Profile = {
        ...DEFAULT_PROFILE,
        documents: [doc('a.pdf', 100_000), doc('b.pdf', 100_000)],
      };
      const result = profileToContext(p);
      // Both documents are present (neither dropped), each getting half of
      // the full 60,000 pool (no resume here) — not a fixed per-document cap.
      expect(result).toContain('Document "a.pdf"');
      expect(result).toContain('Document "b.pdf"');
      expect(xRuns(result)).toEqual([30_000, 30_000]);
    });

    it('gives the resume priority, and a lone document the entire rest of the pool', () => {
      const p: Profile = {
        ...DEFAULT_PROFILE,
        resumeText: 'x'.repeat(RESUME_TEXT_BUDGET), // uses its full priority slice
        documents: [doc('huge.pdf', 200_000)],
      };
      const result = profileToContext(p);
      // First run is the resume — full RESUME_TEXT_BUDGET, not shrunk to make
      // room for the document. With only one document, it gets the *entire*
      // rest of CONTEXT_TEXT_BUDGET (40,000) — the whole point of the dynamic
      // share replacing the old fixed 8,000-char cap.
      const runs = xRuns(result);
      expect(runs[0]).toBe(RESUME_TEXT_BUDGET);
      expect(runs[1]).toBe(CONTEXT_TEXT_BUDGET - RESUME_TEXT_BUDGET);
    });

    it('shrinks the real regression scenario from the issue well under the proxy limit', () => {
      // The exact numbers measured in #251: three real documents (~55k/~53k/~8k
      // chars, ~116k combined) that — with a modest resume — added up to
      // ~133k characters of prompt, dangerously close to the proxy's 200k
      // hard limit. Under the dynamic 3-way split (~18.3k each, the smallest
      // document using less than its share since it doesn't need it), the
      // total lands around 50k — still a large reduction from the original
      // problem, comfortably under the proxy limit, while giving each
      // document far more room than the old flat 8,000-char cap did.
      const p: Profile = {
        ...DEFAULT_PROFILE,
        resumeText: 'x'.repeat(5_000),
        documents: [doc('one.pdf', 55_249), doc('two.pdf', 52_791), doc('three.pdf', 8_288)],
      };
      const result = profileToContext(p);
      expect(result).toContain('Document "one.pdf"');
      expect(result).toContain('Document "two.pdf"');
      expect(result).toContain('Document "three.pdf"');
      expect(result.length).toBeLessThan(52_000); // was ~133k before any cap
    });

    it('no longer drops documents once there are "enough" of them — every document gets a fair, non-zero share', () => {
      // Under the old fixed 8,000-char-per-document cap, 6 documents against
      // a 40,000 shared budget (after the resume's full priority slice) used
      // exactly 5 * 8,000 and dropped the 6th entirely. Under the dynamic
      // share, the same 6 documents instead each get an equal ~6,666-char
      // slice — nothing is dropped. This is the direct payoff of the
      // dynamic-share change: budget is never wasted, so there's no cliff
      // where "one document too many" starts silently losing documents.
      const p: Profile = {
        ...DEFAULT_PROFILE,
        resumeText: 'x'.repeat(RESUME_TEXT_BUDGET),
        documents: Array.from({ length: 6 }, (_, i) => doc(`doc-${i}.pdf`, 8_000)),
      };
      const result = profileToContext(p);
      for (let i = 0; i < 6; i++) expect(result).toContain(`Document "doc-${i}.pdf"`);
      const runs = xRuns(result);
      expect(runs[0]).toBe(RESUME_TEXT_BUDGET);
      // 40,000 shared among 6 documents that all want more than their share:
      // integer division leaves a small remainder distributed across the
      // last few documents (6,666 x2, 6,667 x4) — every one is comfortably
      // non-zero, which is the property under test.
      expect(runs.slice(1)).toEqual([6_666, 6_666, 6_667, 6_667, 6_667, 6_667]);
    });

    it('never produces a context longer than CONTEXT_TEXT_BUDGET plus a small, bounded label overhead', () => {
      const p: Profile = {
        ...DEFAULT_PROFILE,
        resumeText: 'x'.repeat(100_000),
        documents: Array.from({ length: 20 }, (_, i) => doc(`doc-${i}.pdf`, 50_000)),
      };
      const result = profileToContext(p);
      // "\nResume:\n" + "\nDocument \"doc-N.pdf\":\n" per included document is the
      // only overhead beyond the raw character budget — generously bounded here.
      // Holds regardless of how the dynamic split divides the pool internally,
      // since no document can ever use more than what's left of the pool.
      expect(result.length).toBeLessThan(CONTEXT_TEXT_BUDGET + 2_000);
    });
  });
});

describe('computeContextUsage', () => {
  // The follow-up to #251: a per-document check couldn't say how many
  // characters of a document actually reach the AI, because that's
  // order-dependent. computeContextUsage answers that precisely, and
  // profileToContext is built from its result (not a second, parallel walk),
  // so the two can never disagree.
  //
  // Documents share the pool via a dynamic fair split, not a fixed
  // per-document cap: each document gets an equal claim on whatever's left
  // among the documents not yet processed (itself included), in list order.
  // One document alone gets the whole remaining pool; a document that needs
  // less than its share leaves the rest for documents after it (but not
  // documents before it — earlier documents keep some priority).
  function doc(name: string, length: number): UploadedDoc {
    return { id: name, name, text: 'x'.repeat(length), addedAt: 0 };
  }

  it('reports full usage for a normal profile — nothing trimmed', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      resumeText: 'A modest resume.',
      documents: [doc('a.pdf', 500), doc('b.pdf', 300)],
    };
    const usage = computeContextUsage(p);
    expect(usage.resume).toEqual({ usedChars: 16, totalChars: 16, usedText: 'A modest resume.' });
    expect(usage.documents).toEqual([
      { id: 'a.pdf', usedChars: 500, totalChars: 500, usedText: 'x'.repeat(500) },
      { id: 'b.pdf', usedChars: 300, totalChars: 300, usedText: 'x'.repeat(300) },
    ]);
  });

  it('gives a single document the entire remaining pool, not a fixed per-document cap', () => {
    // The headline behavior this replaces the old fixed 8,000-char cap with:
    // one document, no competition, gets everything that's left.
    const p: Profile = { ...DEFAULT_PROFILE, documents: [doc('big.pdf', 100_000)] };
    const usage = computeContextUsage(p);
    expect(usage.documents[0]).toEqual({
      id: 'big.pdf',
      usedChars: CONTEXT_TEXT_BUDGET,
      totalChars: 100_000,
      usedText: 'x'.repeat(CONTEXT_TEXT_BUDGET),
    });
  });

  it('caps the resume at RESUME_TEXT_BUDGET', () => {
    const p: Profile = { ...DEFAULT_PROFILE, resumeText: 'x'.repeat(RESUME_TEXT_BUDGET + 5_000) };
    const usage = computeContextUsage(p);
    expect(usage.resume.usedChars).toBe(RESUME_TEXT_BUDGET);
    expect(usage.resume.totalChars).toBe(RESUME_TEXT_BUDGET + 5_000);
  });

  it('redistributes a small document\'s unused share to a later, larger document', () => {
    // 60,000 pool, 2 documents, no resume: a naive half-split would give each
    // 30,000. The small document only needs 3,000, so it uses exactly that
    // and leaves the rest (57,000) for the large document that follows.
    const p: Profile = {
      ...DEFAULT_PROFILE,
      documents: [doc('small.pdf', 3_000), doc('large.pdf', 100_000)],
    };
    const usage = computeContextUsage(p);
    expect(usage.documents[0].usedChars).toBe(3_000);
    expect(usage.documents[1].usedChars).toBe(57_000); // 60,000 - 3,000, not a flat 30,000
  });

  it('does not redistribute backward — an earlier large document only gets its share, even if a later document turns out small', () => {
    // Same two document sizes as above, order reversed. The large document is
    // processed FIRST, before anyone knows the second document is small — so
    // it's capped at the naive half-split (30,000), not boosted retroactively.
    // This is the "some order priority" behavior chosen over full
    // order-independence: budget the large document doesn't get here (a
    // remainder of 27,000) simply goes unclaimed, rather than flowing
    // backward to a document whose share was already decided.
    const p: Profile = {
      ...DEFAULT_PROFILE,
      documents: [doc('large.pdf', 100_000), doc('small.pdf', 3_000)],
    };
    const usage = computeContextUsage(p);
    expect(usage.documents[0].usedChars).toBe(30_000); // vs. 57,000 in the forward-order case
    expect(usage.documents[1].usedChars).toBe(3_000);
  });

  it('divides the pool evenly across several equally-oversized documents', () => {
    // 5 documents, none of which fit within any share they'd be offered
    // (60,000 / 5 = 12,000 exactly — chosen to divide evenly, so there's no
    // integer-rounding remainder to account for).
    const p: Profile = {
      ...DEFAULT_PROFILE,
      documents: Array.from({ length: 5 }, (_, i) => doc(`doc-${i}.pdf`, 50_000)),
    };
    const usage = computeContextUsage(p);
    expect(usage.documents.map((d) => d.usedChars)).toEqual([12_000, 12_000, 12_000, 12_000, 12_000]);
  });

  it('never reduces a document to zero chars for any realistic document count — the old "dropped entirely" cliff is gone', () => {
    // Stress case: 50 documents, all requesting far more than any possible
    // share. Under the old fixed 8,000-char cap, the shared budget would run
    // out partway through the list and every document after that point got
    // nothing. Under the dynamic share, the pool divides evenly across all
    // 50 (60,000 / 50 = 1,200 each) — smaller per document than with fewer
    // files, but every single one gets a real, non-zero, usable slice.
    const p: Profile = {
      ...DEFAULT_PROFILE,
      documents: Array.from({ length: 50 }, (_, i) => doc(`doc-${i}.pdf`, 10_000)),
    };
    const usage = computeContextUsage(p);
    expect(usage.documents.every((d) => d.usedChars === 1_200)).toBe(true);
  });

  it('does not let an empty document consume any of the shared budget, or count toward the split', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      documents: [doc('empty.pdf', 0), doc('after.pdf', 500)],
    };
    const usage = computeContextUsage(p);
    expect(usage.documents[0]).toEqual({ id: 'empty.pdf', usedChars: 0, totalChars: 0, usedText: '' });
    // The document after the empty one gets the WHOLE pool, not half of it —
    // confirms the empty document doesn't count toward docsLeft either.
    expect(usage.documents[1].usedChars).toBe(500);
  });

  it('agrees with profileToContext: every used slice appears verbatim, and an empty document never appears at all', () => {
    const profiles: Profile[] = [
      // normal
      { ...DEFAULT_PROFILE, resumeText: 'A modest resume.', documents: [doc('a.pdf', 500)] },
      // single document takes the whole pool
      { ...DEFAULT_PROFILE, documents: [doc('big.pdf', 100_000)] },
      // forward redistribution between two documents
      { ...DEFAULT_PROFILE, documents: [doc('small.pdf', 3_000), doc('large.pdf', 100_000)] },
      // an empty document contributes nothing and must not appear in the output
      { ...DEFAULT_PROFILE, documents: [doc('empty.pdf', 0), doc('after.pdf', 500)] },
    ];
    for (const p of profiles) {
      const usage = computeContextUsage(p);
      const context = profileToContext(p);
      for (const d of usage.documents) {
        if (d.usedChars > 0) {
          expect(context).toContain(d.usedText);
        } else {
          expect(context).not.toContain(`Document "${d.id}"`);
        }
      }
    }
  });
});

describe('upsertDocument', () => {
  // Regression test for #267 via #271: this logic used to live inline in
  // Options.tsx JSX, which can't be imported under vitest's DOM-less test env
  // (`DOMMatrix is not defined`, via the transitive pdfjs-dist import), so it
  // shipped with no test. Extracted here so it finally has one.
  function docs(names: string[]): UploadedDoc[] {
    return names.map((name, i) => ({ id: `id-${i}`, name, text: `text ${i}`, addedAt: i }));
  }

  it('appends a document with a new filename', () => {
    const result = upsertDocument(docs(['resume.pdf']), 'cover.pdf', 'cover text');
    expect(result.map((d) => d.name)).toEqual(['resume.pdf', 'cover.pdf']);
    expect(result[1].text).toBe('cover text');
  });

  it('replaces an existing document with the same filename, moving it to the end', () => {
    // Pins the current (pre-extraction) behavior: filter-then-append means a
    // re-upload moves to the end of the list, changing both the Options display
    // order and where it appears in the AI context — #271 flagged this as
    // accidental rather than chosen; this test makes it deliberate.
    const result = upsertDocument(docs(['a.pdf', 'b.pdf', 'c.pdf']), 'a.pdf', 'new a text');
    expect(result.map((d) => d.name)).toEqual(['b.pdf', 'c.pdf', 'a.pdf']);
    expect(result[2].text).toBe('new a text');
  });

  it('matches an existing filename case- and whitespace-insensitively', () => {
    // Pins the case-insensitivity as intentional (#271) — filesystems are
    // case-insensitive on macOS/Windows, so "Resume.PDF" and "resume.pdf" are
    // the same file to a user re-uploading it.
    const result = upsertDocument(docs(['resume.pdf']), '  Resume.PDF  ', 'updated text');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('  Resume.PDF  ');
    expect(result[0].text).toBe('updated text');
  });

  it('accumulates correctly across a sequence of calls (multi-file upload)', () => {
    // DocUpload calls onText once per file in a loop for a multi-file upload
    // (extractTextBatch), so a sequence of calls is a real path, not synthetic.
    let result: UploadedDoc[] = [];
    result = upsertDocument(result, 'a.pdf', 'a1');
    result = upsertDocument(result, 'b.pdf', 'b1');
    result = upsertDocument(result, 'a.pdf', 'a2');
    expect(result.map((d) => [d.name, d.text])).toEqual([
      ['b.pdf', 'b1'],
      ['a.pdf', 'a2'],
    ]);
  });
});
