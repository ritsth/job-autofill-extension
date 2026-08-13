import { describe, expect, it } from 'vitest';
import { fillNotice } from './Popup';

describe('fillNotice', () => {
  it('reads unchanged when nothing was already filled', () => {
    expect(fillNotice({ filled: 3, total: 5, alreadyFilled: 0 })).toBe(
      'Filled 3 of 5 recognised fields.',
    );
  });

  it('reports every field as already correct instead of "Filled 0 of N"', () => {
    // The regression this exists for: re-clicking Fill on an already-filled
    // page should not read as a total failure.
    const msg = fillNotice({ filled: 0, total: 5, alreadyFilled: 5 });
    expect(msg).toContain('Filled 0 of 5');
    expect(msg).toContain('5 already had your details');
  });

  it('reports a mix of newly filled and already-correct fields', () => {
    const msg = fillNotice({ filled: 2, total: 5, alreadyFilled: 3 });
    expect(msg).toContain('Filled 2 of 5');
    expect(msg).toContain('3 already had your details');
  });

  it('uses singular "field" only for a single recognised field', () => {
    expect(fillNotice({ filled: 1, total: 1, alreadyFilled: 0 })).toBe(
      'Filled 1 of 1 recognised field.',
    );
    expect(fillNotice({ filled: 0, total: 2, alreadyFilled: 0 })).toBe(
      'Filled 0 of 2 recognised fields.',
    );
  });

  it('is a plain "0 of 0" message when nothing on the page was recognised', () => {
    expect(fillNotice({ filled: 0, total: 0, alreadyFilled: 0 })).toBe(
      'Filled 0 of 0 recognised fields.',
    );
  });
});
