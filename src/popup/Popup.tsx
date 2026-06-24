import { useEffect, useState } from 'react';
import { getProfile, saveProfile, onProfileChanged, type Profile } from '../lib/profile';
import {
  getSavedJobs,
  addJob,
  setActiveJob,
  deleteJob,
  onSavedJobsChanged,
  type SavedJob,
} from '../lib/savedJobs';
import { sendToBackground, sendToTab } from '../lib/messages';
import type { AIResult, CapturedJob, FillResult, PageInfo } from '../lib/messages';
import { downloadLetter } from '../lib/coverLetter';
import { downloadResume } from '../lib/resume';
import { signIn, reconcileAuthUser, onAuthChanged, type AuthUser } from '../lib/auth';

export function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  // AI config, derived from the profile, for the "configure AI" hints.
  const [aiProvider, setAiProvider] = useState<Profile['ai']['provider']>('proxy');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [adminTokenSet, setAdminTokenSet] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);
  const [fillMsg, setFillMsg] = useState('');
  const [letter, setLetter] = useState('');
  const [resume, setResume] = useState('');
  const [busy, setBusy] = useState<'' | 'fill' | 'letter' | 'resume'>('');
  const [error, setError] = useState('');
  const [scanEnabled, setScanEnabled] = useState(true);
  const [coverLetterEnabled, setCoverLetterEnabled] = useState(true);
  const [resumeEnabled, setResumeEnabled] = useState(true);
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // Editable company/role, shared by the cover letter + resume (pre-filled from
  // page detection).
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');

  // Persist a boolean feature toggle and reflect it locally.
  async function toggleSetting(
    key: 'scanEnabled' | 'coverLetterEnabled' | 'tailoredResumeEnabled',
    setLocal: (v: boolean) => void,
    value: boolean,
  ) {
    setLocal(value);
    const profile = await getProfile();
    await saveProfile({ ...profile, [key]: value });
  }

  // Re-read the active tab's job info. Runs on mount and whenever the user
  // switches tabs or navigates (the side panel stays open across all of that).
  async function refresh() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      setTabId(tab.id);
      try {
        const info = await sendToTab<PageInfo>(tab.id, { type: 'PAGE_INFO' });
        setPage(info);
        // Prefill from detection, but never clobber what the user has typed.
        if (info.company) setCompany((c) => c || info.company);
        if (info.role) setRole((r) => r || info.role);
      } catch {
        setPage({ supported: false, site: null, company: '', role: '', jobText: '' });
      }
    } else {
      setTabId(null);
      setPage({ supported: false, site: null, company: '', role: '', jobText: '' });
    }
  }

  // Feature toggles live in the profile (not tab-derived). Load once and keep in
  // sync via storage changes, so a tab refresh can never clobber a fresh toggle
  // mid-save (which made the checkboxes look like they did nothing).
  useEffect(() => {
    const apply = (p: Profile) => {
      setScanEnabled(p.scanEnabled);
      setCoverLetterEnabled(p.coverLetterEnabled);
      setResumeEnabled(p.tailoredResumeEnabled);
      setAiProvider(p.ai.provider);
      setApiKeySet(!!p.ai.apiKey.trim());
      setAdminTokenSet(!!p.ai.proxyToken.trim());
    };
    getProfile().then(apply);
    return onProfileChanged(apply);
  }, []);

  // Google sign-in status for the managed proxy.
  useEffect(() => {
    reconcileAuthUser().then(setAuthUser);
    return onAuthChanged(setAuthUser);
  }, []);

  async function onSignIn() {
    setSignInBusy(true);
    setError('');
    try {
      setAuthUser(await signIn());
    } catch (e) {
      setError(`Sign-in failed: ${(e as Error).message}`);
    } finally {
      setSignInBusy(false);
    }
  }

  // Saved jobs live in their own store; load once and stay in sync.
  useEffect(() => {
    const apply = (s: { jobs: SavedJob[]; activeId: string | null }) => {
      setJobs(s.jobs);
      setActiveJobId(s.activeId);
    };
    getSavedJobs().then(apply);
    return onSavedJobsChanged(apply);
  }, []);

  useEffect(() => {
    refresh();
    const onActivated = () => refresh();
    const onUpdated = (_id: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && change.status === 'complete') refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFill() {
    if (!tabId) return;
    setBusy('fill');
    setFillMsg('');
    setError('');
    try {
      const res = await sendToTab<FillResult>(tabId, { type: 'PAGE_FILL' });
      setFillMsg(`Filled ${res.filled} of ${res.total} recognised field${res.total === 1 ? '' : 's'}.`);
    } catch {
      setError('Could not reach the page. Reload the job page and try again.');
    } finally {
      setBusy('');
    }
  }

  async function onCoverLetter() {
    setBusy('letter');
    setError('');
    setLetter('');
    try {
      const res = await sendToBackground<AIResult>({
        type: 'AI_GENERATE_COVER_LETTER',
        company: company.trim(),
        role: role.trim(),
        jobText: page?.jobText ?? '',
      });
      if (res.error) setError(res.error);
      else setLetter(res.text);
    } catch (e) {
      setError(`Generation failed: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function onResume() {
    setBusy('resume');
    setError('');
    setResume('');
    try {
      const res = await sendToBackground<AIResult>({
        type: 'AI_GENERATE_RESUME',
        company: company.trim(),
        role: role.trim(),
        jobText: page?.jobText ?? '',
      });
      if (res.error) setError(res.error);
      else setResume(res.text);
    } catch (e) {
      setError(`Generation failed: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function onSaveJob() {
    if (!tabId) return;
    setError('');
    try {
      const cap = await sendToTab<CapturedJob>(tabId, { type: 'CAPTURE_JOB' });
      if (!cap.text || cap.text.trim().length < 40) {
        setError('No job posting detected on this page to save.');
        return;
      }
      await addJob({
        company: cap.company,
        role: cap.role || cap.title,
        url: cap.url,
        text: cap.text,
      });
    } catch {
      setError('Could not read this page. Reload it and try again.');
    }
  }

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;
  const openOptions = () => chrome.runtime.openOptionsPage();
  const geminiNeedsKey = aiProvider === 'gemini' && !apiKeySet;
  // Proxy mode needs a signed-in account (unless the owner set an admin token).
  const proxyNeedsSignIn = aiProvider === 'proxy' && !adminTokenSet && !authUser;

  return (
    <div className="popup">
      <header className="brand">
        <span className="brand-logo" aria-hidden>
          <img src={chrome.runtime.getURL('icons/icon128.png')} alt="" width={36} height={36} />
        </span>
        <div className="brand-text">
          <h1>Little AI Helper</h1>
          <p className="tagline">Autofill · cover letters · eligibility</p>
        </div>
        <button className="ghost icon-btn" title="Refresh for the current tab" onClick={() => refresh()}>
          ↻
        </button>
      </header>

      {page?.supported ? (
        <p className="muted">
          <span className="pill">{page.site}</span>{' '}
          {page.role || 'job page'} {page.company && `· ${page.company}`}
        </p>
      ) : (
        <p className="muted">Open a Greenhouse, Lever, or Workday application page to use autofill.</p>
      )}

      {geminiNeedsKey && (
        <div className="block warn">
          AI isn't configured yet.{' '}
          <a onClick={openOptions} style={{ cursor: 'pointer' }}>Set it up →</a>
        </div>
      )}

      {proxyNeedsSignIn && (
        <div className="block signin">
          <p className="signin-text">
            Sign in to use the managed AI — free up to a daily limit per account.
          </p>
          <button className="primary full" disabled={signInBusy} onClick={onSignIn}>
            {signInBusy ? 'Signing in…' : 'Sign in with Google'}
          </button>
          <a className="signin-alt" onClick={openOptions} style={{ cursor: 'pointer' }}>
            or use your own Gemini key / on-device →
          </a>
        </div>
      )}

      {aiProvider === 'proxy' && authUser && (
        <p className="muted signedin">
          ✓ Signed in{authUser.email ? ` as ${authUser.email}` : ''}
        </p>
      )}

      <div className="block">
        <button className="primary" disabled={!page?.supported || busy !== ''} onClick={onFill}>
          {busy === 'fill' ? 'Filling…' : 'Fill this page'}
        </button>
        {fillMsg && <div className="status">{fillMsg}</div>}
      </div>

      <div className="block savedjob">
        <button className="full" onClick={onSaveJob} disabled={busy !== '' || !tabId}>
          💾 Save this job
        </button>
        {activeJob ? (
          <div className="jobusing">
            Using saved job:{' '}
            <strong>
              {activeJob.role || 'saved posting'}
              {activeJob.company ? ` · ${activeJob.company}` : ''}
            </strong>{' '}
            <button className="ghost jobclear" onClick={() => setActiveJob(null)}>
              use current page
            </button>
          </div>
        ) : (
          jobs.length > 0 && (
            <div className="jobusing muted">
              Using the current page. Pick a saved job to reuse its posting.
            </div>
          )
        )}
        {jobs.length > 0 && (
          <div className="joblist">
            {jobs.map((j) => (
              <div key={j.id} className={`jobrow${j.id === activeJobId ? ' active' : ''}`}>
                <button
                  className="jobpick"
                  title="Use this posting as the context for AI answers & documents"
                  onClick={() => setActiveJob(j.id === activeJobId ? null : j.id)}
                >
                  <span className="dot" />
                  <span className="jobname">
                    {j.role || 'Saved job'}
                    {j.company ? ` · ${j.company}` : ''}
                  </span>
                </button>
                <button className="jobdel" title="Delete" onClick={() => deleteJob(j.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="block">
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <input
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>

        <button className="primary" disabled={busy !== ''} onClick={onCoverLetter}>
          {busy === 'letter' ? 'Generating…' : 'Generate cover letter'}
        </button>
        {letter && (
          <>
            <textarea
              style={{ marginTop: 8 }}
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
            />
            <button
              className="full"
              style={{ marginTop: 8 }}
              onClick={() => downloadLetter(letter, company, role)}
            >
              ⬇ Download cover letter (.pdf)
            </button>
          </>
        )}

        <button
          className="primary"
          style={{ marginTop: 8 }}
          disabled={busy !== ''}
          onClick={onResume}
        >
          {busy === 'resume' ? 'Tailoring…' : 'Generate tailored resume'}
        </button>
        {resume && (
          <>
            <textarea
              style={{ marginTop: 8 }}
              value={resume}
              onChange={(e) => setResume(e.target.value)}
            />
            <button
              className="full"
              style={{ marginTop: 8 }}
              onClick={() => downloadResume(resume, company, role)}
            >
              ⬇ Download resume (.pdf)
            </button>
          </>
        )}
      </div>

      {error && <div className="status warn">{error}</div>}

      <div className="block toggles">
        <p className="toggles-title">Show in the page badge</p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={resumeEnabled}
            onChange={(e) => toggleSetting('tailoredResumeEnabled', setResumeEnabled, e.target.checked)}
          />
          Tailored resume generator
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={coverLetterEnabled}
            onChange={(e) => toggleSetting('coverLetterEnabled', setCoverLetterEnabled, e.target.checked)}
          />
          Tailored cover-letter generator
        </label>
        <label className="toggle" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <input
            type="checkbox"
            checked={scanEnabled}
            onChange={(e) => toggleSetting('scanEnabled', setScanEnabled, e.target.checked)}
          />
          Scan every page for visa/eligibility (YES/NO badge)
        </label>
      </div>

      <div className="block" style={{ textAlign: 'center' }}>
        <button className="ghost" onClick={openOptions}>
          Edit profile &amp; settings
        </button>
      </div>
    </div>
  );
}
