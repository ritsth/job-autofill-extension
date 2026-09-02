import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, GEMINI_MODELS } from './ai/models';
import {
  CONTEXT_TEXT_BUDGET,
  DEFAULT_PROFILE,
  DOCUMENT_TEXT_BUDGET,
  RESUME_TEXT_BUDGET,
  isDocumentTrimmed,
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

  it('falls back to an empty disabledHosts list for a profile stored before the field existed', () => {
    // Migration guard: every existing user's stored profile predates this
    // field entirely. Without the explicit fallback in withDefaults, this
    // would resolve to `undefined` and crash the `.some()` in isHostDisabled.
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange(
      { [STORAGE_KEY]: { newValue: { personal: { firstName: 'Jane' } } } },
      'local',
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ disabledHosts: [] }),
    );
  });

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
  // call. These pin the cap.
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

    it('caps each document at DOCUMENT_TEXT_BUDGET, degrading every document rather than dropping the tail', () => {
      const p: Profile = {
        ...DEFAULT_PROFILE,
        documents: [doc('a.pdf', DOCUMENT_TEXT_BUDGET + 10_000), doc('b.pdf', DOCUMENT_TEXT_BUDGET + 10_000)],
      };
      const result = profileToContext(p);
      // Both documents are present (neither dropped) and each contributes at
      // most the per-document cap.
      expect(result).toContain('Document "a.pdf"');
      expect(result).toContain('Document "b.pdf"');
      expect(xRuns(result)).toEqual([DOCUMENT_TEXT_BUDGET, DOCUMENT_TEXT_BUDGET]);
    });

    it('gives the resume priority: it is never trimmed to make room for documents', () => {
      const p: Profile = {
        ...DEFAULT_PROFILE,
        resumeText: 'x'.repeat(RESUME_TEXT_BUDGET), // uses its full priority slice
        documents: [doc('huge.pdf', 200_000)],
      };
      const result = profileToContext(p);
      // First run is the resume — full RESUME_TEXT_BUDGET, not shrunk to make
      // room for the document (which still gets its own DOCUMENT_TEXT_BUDGET
      // slice out of what's left, not zero).
      const runs = xRuns(result);
      expect(runs[0]).toBe(RESUME_TEXT_BUDGET);
      expect(runs[1]).toBe(DOCUMENT_TEXT_BUDGET);
    });

    it('shrinks the real regression scenario from the issue well under the proxy limit', () => {
      // The exact numbers measured in #251: three real documents (~55k/~53k/~8k
      // chars, ~116k combined) that — with the old resumeText + a modest resume
      // — added up to ~133k characters of prompt, dangerously close to the
      // proxy's 200k hard limit and one document away from tipping over it.
      const p: Profile = {
        ...DEFAULT_PROFILE,
        resumeText: 'x'.repeat(5_000),
        documents: [doc('one.pdf', 55_249), doc('two.pdf', 52_791), doc('three.pdf', 8_288)],
      };
      const result = profileToContext(p);
      expect(result).toContain('Document "one.pdf"');
      expect(result).toContain('Document "two.pdf"');
      expect(result).toContain('Document "three.pdf"');
      expect(result.length).toBeLessThan(35_000); // was ~133k before the cap
    });

    it('drops documents entirely, in list order, once the shared budget is exhausted', () => {
      // Resume uses its full RESUME_TEXT_BUDGET (20k), leaving exactly
      // CONTEXT_TEXT_BUDGET - RESUME_TEXT_BUDGET = 40k shared budget for
      // documents. Five documents at the 8k per-document cap use exactly that
      // 40k; a sixth has nothing left and is dropped entirely rather than
      // appended as a useless sliver.
      const p: Profile = {
        ...DEFAULT_PROFILE,
        resumeText: 'x'.repeat(RESUME_TEXT_BUDGET),
        documents: Array.from({ length: 6 }, (_, i) => doc(`doc-${i}.pdf`, DOCUMENT_TEXT_BUDGET)),
      };
      const result = profileToContext(p);
      for (let i = 0; i < 5; i++) expect(result).toContain(`Document "doc-${i}.pdf"`);
      expect(result).not.toContain('Document "doc-5.pdf"');
      expect(xRuns(result)).toEqual([
        RESUME_TEXT_BUDGET,
        DOCUMENT_TEXT_BUDGET,
        DOCUMENT_TEXT_BUDGET,
        DOCUMENT_TEXT_BUDGET,
        DOCUMENT_TEXT_BUDGET,
        DOCUMENT_TEXT_BUDGET,
      ]);
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
      expect(result.length).toBeLessThan(CONTEXT_TEXT_BUDGET + 2_000);
    });
  });
});

describe('isDocumentTrimmed', () => {
  function doc(length: number): UploadedDoc {
    return { id: 'd', name: 'd.pdf', text: 'x'.repeat(length), addedAt: 0 };
  }

  it('is false at exactly the budget', () => {
    expect(isDocumentTrimmed(doc(DOCUMENT_TEXT_BUDGET))).toBe(false);
  });

  it('is true one character over the budget', () => {
    expect(isDocumentTrimmed(doc(DOCUMENT_TEXT_BUDGET + 1))).toBe(true);
  });

  it('is false for a short document', () => {
    expect(isDocumentTrimmed(doc(100))).toBe(false);
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
