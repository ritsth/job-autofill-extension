import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, GEMINI_MODELS } from './ai/models';
import {
  DEFAULT_PROFILE,
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
