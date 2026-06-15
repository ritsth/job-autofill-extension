import { useEffect, useState } from 'react';
import { getProfile, saveProfile } from '../lib/profile';
import { sendToBackground, sendToTab } from '../lib/messages';
import type { AIResult, FillResult, PageInfo } from '../lib/messages';
import { downloadLetter } from '../lib/coverLetter';

export function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [fillMsg, setFillMsg] = useState('');
  const [letter, setLetter] = useState('');
  const [busy, setBusy] = useState<'' | 'fill' | 'letter'>('');
  const [error, setError] = useState('');
  const [scanEnabled, setScanEnabled] = useState(true);

  async function toggleScan(value: boolean) {
    setScanEnabled(value);
    const profile = await getProfile();
    await saveProfile({ ...profile, scanEnabled: value });
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
      } catch {
        setPage({ supported: false, site: null, company: '', role: '' });
      }
    } else {
      setTabId(null);
      setPage({ supported: false, site: null, company: '', role: '' });
    }
    const profile = await getProfile();
    const needsConfig =
      (profile.ai.provider === 'gemini' && !profile.ai.apiKey.trim()) ||
      (profile.ai.provider === 'proxy' && !profile.ai.proxyToken.trim());
    setNeedsKey(needsConfig);
    setScanEnabled(profile.scanEnabled);
  }

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
        company: page?.company ?? '',
        role: page?.role ?? '',
      });
      if (res.error) setError(res.error);
      else setLetter(res.text);
    } catch (e) {
      setError(`Generation failed: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  const openOptions = () => chrome.runtime.openOptionsPage();

  return (
    <div className="popup">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ flex: 1 }}>AI Job Autofill</h1>
        <button className="ghost" title="Refresh for the current tab" onClick={() => refresh()}>
          ↻
        </button>
      </div>
      {page?.supported ? (
        <p className="muted">
          <span className="pill">{page.site}</span>{' '}
          {page.role || 'job page'} {page.company && `· ${page.company}`}
        </p>
      ) : (
        <p className="muted">Open a Greenhouse or Lever application page to use autofill.</p>
      )}

      {needsKey && (
        <div className="block warn">
          AI isn't configured yet.{' '}
          <a onClick={openOptions} style={{ cursor: 'pointer' }}>Set it up →</a>
        </div>
      )}

      <div className="block">
        <button className="primary" disabled={!page?.supported || busy !== ''} onClick={onFill}>
          {busy === 'fill' ? 'Filling…' : 'Fill this page'}
        </button>
        {fillMsg && <div className="status">{fillMsg}</div>}
      </div>

      <div className="block">
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
              onClick={() => downloadLetter(letter, page?.company ?? '', page?.role ?? '')}
            >
              ⬇ Download .txt
            </button>
          </>
        )}
      </div>

      {error && <div className="status warn">{error}</div>}

      <label
        className="block"
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}
      >
        <input
          type="checkbox"
          checked={scanEnabled}
          onChange={(e) => toggleScan(e.target.checked)}
        />
        Scan every page for visa/eligibility (YES/NO badge)
      </label>

      <div className="block" style={{ textAlign: 'center' }}>
        <button className="ghost" onClick={openOptions}>
          Edit profile &amp; settings
        </button>
      </div>
    </div>
  );
}
