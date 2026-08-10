import { describe, it, expect } from 'vitest';
import { profileToContext, DEFAULT_PROFILE, type Profile } from './profile';

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
