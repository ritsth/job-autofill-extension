import { useEffect, useState } from 'react';
import { Field } from './Field';
import type { EducationEntry, Profile, WorkEntry } from '../lib/profile';
import { useProfile } from '../ui/useProfile';
import { extractText, extractTextBatch } from '../lib/documents';
import { sendToBackground } from '../lib/messages';
import type { AIResult } from '../lib/messages';
import { parseResumeJson } from '../lib/resumeImport';
import { ProxyProvider } from '../lib/ai/proxy';
import { GEMINI_MODELS } from '../lib/ai/models';
import { AIError } from '../lib/ai';
import { signIn, signOut, reconcileAuthUser, onAuthChanged, getCachedToken, type AuthUser } from '../lib/auth';

export function Options() {
  const { profile, loaded, saveState, update } = useProfile();

  if (!loaded) return <div className="options">Loading…</div>;

  const p = profile;
  const setPersonal = (k: keyof Profile['personal'], v: string) =>
    update((prev) => ({ ...prev, personal: { ...prev.personal, [k]: v } }));
  const setPref = (k: keyof Profile['preferences'], v: string) =>
    update((prev) => ({ ...prev, preferences: { ...prev.preferences, [k]: v } }));
  const setAI = (k: keyof Profile['ai'], v: string) =>
    update((prev) => ({ ...prev, ai: { ...prev.ai, [k]: v } }));

  return (
    <OptionsView
      p={p}
      saveState={saveState}
      setPersonal={setPersonal}
      setPref={setPref}
      setAI={setAI}
      update={update}
    />
  );
}

function OptionsView({
  p,
  saveState,
  setPersonal,
  setPref,
  setAI,
  update,
}: {
  p: Profile;
  saveState: ReturnType<typeof useProfile>['saveState'];
  setPersonal: (k: keyof Profile['personal'], v: string) => void;
  setPref: (k: keyof Profile['preferences'], v: string) => void;
  setAI: (k: keyof Profile['ai'], v: string) => void;
  update: ReturnType<typeof useProfile>['update'];
}) {
  const [importState, setImportState] = useState<{ busy: boolean; msg: string; err: string }>({
    busy: false,
    msg: '',
    err: '',
  });
  // Snapshot of the profile taken right before the last import, for undo.
  const [undoSnapshot, setUndoSnapshot] = useState<Profile | null>(null);
  const [proxyTest, setProxyTest] = useState<{ busy: boolean; msg: string; err: string }>({
    busy: false,
    msg: '',
    err: '',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showProxyToken, setShowProxyToken] = useState(false);

  // Google sign-in state for the managed proxy.
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState('');
  useEffect(() => {
    reconcileAuthUser().then(setAuthUser);
    return onAuthChanged(setAuthUser);
  }, []);

  async function doSignIn(): Promise<void> {
    setAuthBusy(true);
    setAuthErr('');
    try {
      setAuthUser(await signIn());
    } catch (e) {
      setAuthErr((e as Error).message || 'Sign-in failed');
    } finally {
      setAuthBusy(false);
    }
  }

  async function doSignOut(): Promise<void> {
    setAuthBusy(true);
    try {
      await signOut();
      setAuthUser(null);
    } finally {
      setAuthBusy(false);
    }
  }

  /** Pings the configured proxy with a tiny prompt to verify URL + token. */
  async function testProxy(): Promise<void> {
    setProxyTest({ busy: true, msg: '', err: '' });
    try {
      // Admin token if set; otherwise the signed-in user's Google token.
      let token = p.ai.proxyToken;
      if (!token) {
        try {
          token = await getCachedToken();
        } catch {
          throw new AIError('Sign in with Google first (or paste an admin token).');
        }
      }
      // Connectivity test only — runs on the fast default model.
      const provider = new ProxyProvider(p.ai.proxyUrl, token);
      const text = await provider.generate({
        system: 'You are a connectivity test. Reply with exactly: OK',
        prompt: 'Reply with OK.',
        maxOutputTokens: 64,
      });
      setProxyTest({ busy: false, err: '', msg: `Connected ✓ (model replied: "${text.slice(0, 30)}")` });
    } catch (e) {
      setProxyTest({ busy: false, msg: '', err: e instanceof AIError ? e.message : (e as Error).message });
    }
  }

  /** Sends resume text to the AI and fills work / education / skills. */
  async function importFromResume(text: string): Promise<void> {
    if (!text.trim()) {
      setImportState({ busy: false, msg: '', err: 'Add some resume text first.' });
      return;
    }
    setImportState({ busy: true, msg: '', err: '' });
    try {
      const res = await sendToBackground<AIResult>({ type: 'AI_PARSE_RESUME', text });
      if (res.error) {
        setImportState({ busy: false, msg: '', err: res.error });
        return;
      }
      const parsed = parseResumeJson(res.text);
      const personalCount = Object.keys(parsed.personal).length;
      // Capture the pre-import profile so the user can undo a bad parse.
      setUndoSnapshot(structuredClone(p));
      update((prev) => ({
        ...prev,
        // Merge personal so found fields fill in without clobbering existing ones.
        personal: { ...prev.personal, ...parsed.personal },
        workHistory: parsed.work.length ? parsed.work : prev.workHistory,
        education: parsed.education.length ? parsed.education : prev.education,
        skills: parsed.skills.length ? parsed.skills : prev.skills,
      }));
      setImportState({
        busy: false,
        err: '',
        msg: `Imported ${personalCount} personal field(s), ${parsed.work.length} role(s), ${parsed.education.length} education entr(ies), ${parsed.skills.length} skill(s).`,
      });
    } catch (e) {
      setImportState({ busy: false, msg: '', err: (e as Error).message });
    }
  }

  function undoImport(): void {
    if (!undoSnapshot) return;
    const snapshot = undoSnapshot;
    update(() => snapshot);
    setUndoSnapshot(null);
    setImportState({ busy: false, err: '', msg: 'Reverted to the profile from before the import.' });
  }

  return (
    <div className="options">
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>Little AI Helper — Settings</h1>
        {saveState === 'saving' && <span className="help">Saving…</span>}
        {saveState === 'saved' && <span className="saved">✓ Saved</span>}
      </div>
      <p className="sub">
        Everything here stays on this device (local storage). Your API key is only sent to your
        chosen AI provider.
      </p>

      {/* AI provider */}
      <section className="card">
        <h2>AI provider</h2>
        <div className="row">
          <Field label="Provider">
            <select value={p.ai.provider} onChange={(e) => setAI('provider', e.target.value)}>
              <option value="gemini">Google Gemini (bring your own free key)</option>
              <option value="proxy">Managed proxy (Vertex AI via Cloud Run)</option>
              <option value="onDevice">On-device (Chrome built-in, no key)</option>
            </select>
          </Field>
          {/* On-device (Gemini Nano) has no model choice, so hide the picker. */}
          {p.ai.provider !== 'onDevice' && (
            <Field label="Model (for AI answers)">
              <select value={p.ai.model} onChange={(e) => setAI('model', e.target.value)}>
                {GEMINI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="help">
                Used only for ✨ AI answers to open-ended questions. Resume parsing and the
                eligibility badge always use the fast default model.
              </div>
            </Field>
          )}
        </div>
        {p.ai.provider === 'gemini' && (
          <Field label="Gemini API key">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type={showApiKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={p.ai.apiKey}
                placeholder="Paste your AI Studio key"
                onChange={(e) => setAI('apiKey', e.target.value)}
              />
              <button
                className="ghost"
                type="button"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                onClick={() => setShowApiKey((visible) => !visible)}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="help">
              Get a free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>
              . Free tier is rate-limited but fine for personal use.
            </div>
          </Field>
        )}
        {p.ai.provider === 'proxy' && (
          <>
            <Field label="Account">
              {authUser ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="saved">
                    Signed in{authUser.email ? ` as ${authUser.email}` : ''}
                  </span>
                  <button className="ghost" disabled={authBusy} onClick={doSignOut}>
                    Sign out
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="primary" disabled={authBusy} onClick={doSignIn}>
                    {authBusy ? 'Signing in…' : 'Sign in with Google'}
                  </button>
                  {authErr && <span className="warn">{authErr}</span>}
                </div>
              )}
              <div className="help">
                The managed AI is free up to a daily limit per account. Sign in so your usage is
                counted to you — no card, no key.
              </div>
            </Field>
            <Field label="Proxy URL">
              <input
                value={p.ai.proxyUrl}
                placeholder="https://job-autofill-proxy-xxxx-uc.a.run.app/generate"
                onChange={(e) => setAI('proxyUrl', e.target.value)}
              />
            </Field>
            <Field label="Admin token (optional)">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={showProxyToken ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={p.ai.proxyToken}
                  placeholder="Only the proxy owner needs this — bypasses sign-in & quota"
                  onChange={(e) => setAI('proxyToken', e.target.value)}
                />
                <button
                  className="ghost"
                  type="button"
                  aria-label={showProxyToken ? 'Hide admin token' : 'Show admin token'}
                  onClick={() => setShowProxyToken((visible) => !visible)}
                >
                  {showProxyToken ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="help">
                Leave blank for normal use. If you deployed the proxy yourself (see the{' '}
                <code>server/</code> folder), paste its <code>PROXY_TOKEN</code> to bypass sign-in
                and the daily limit. Stays on this device.
              </div>
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="primary" disabled={proxyTest.busy} onClick={testProxy}>
                {proxyTest.busy ? 'Testing…' : 'Test proxy'}
              </button>
              {proxyTest.msg && <span className="saved">{proxyTest.msg}</span>}
              {proxyTest.err && <span className="warn">{proxyTest.err}</span>}
            </div>
          </>
        )}
      </section>

      {/* Resume import */}
      <section className="card">
        <h2>Attach resume (auto-fills the sections below)</h2>
        <ResumeUpload
          busy={importState.busy}
          onText={async (text) => {
            update((prev) => ({ ...prev, resumeText: text }));
            await importFromResume(text);
          }}
        />
        <Field label="Resume text (primary AI context)">
          <textarea
            style={{ minHeight: 160 }}
            value={p.resumeText}
            placeholder="Paste your resume here, or upload a PDF/DOCX above."
            onChange={(e) => update((prev) => ({ ...prev, resumeText: e.target.value }))}
          />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="primary"
            disabled={importState.busy}
            onClick={() => importFromResume(p.resumeText)}
          >
            {importState.busy ? 'Reading with AI…' : '✨ Auto-fill personal, work, education & skills'}
          </button>
          {undoSnapshot && (
            <button className="ghost" disabled={importState.busy} onClick={undoImport}>
              ↶ Undo last import
            </button>
          )}
          {importState.msg && <span className="saved">{importState.msg}</span>}
          {importState.err && <span className="warn">{importState.err}</span>}
        </div>
        <div className="help">
          Uses your AI provider to read the resume and fill the Personal, Work, Education and Skills
          sections below. Review the results — it can occasionally misread dates or titles.
        </div>
      </section>

      {/* Personal */}
      <section className="card">
        <h2>Personal</h2>
        <div className="row">
          <Field label="First name">
            <input value={p.personal.firstName} onChange={(e) => setPersonal('firstName', e.target.value)} />
          </Field>
          <Field label="Last name">
            <input value={p.personal.lastName} onChange={(e) => setPersonal('lastName', e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <Field label="Email">
            <input value={p.personal.email} onChange={(e) => setPersonal('email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input value={p.personal.phone} onChange={(e) => setPersonal('phone', e.target.value)} />
          </Field>
        </div>
        <div className="row-3">
          <Field label="City">
            <input value={p.personal.city} onChange={(e) => setPersonal('city', e.target.value)} />
          </Field>
          <Field label="State/Region">
            <input value={p.personal.state} onChange={(e) => setPersonal('state', e.target.value)} />
          </Field>
          <Field label="Country">
            <input value={p.personal.country} onChange={(e) => setPersonal('country', e.target.value)} />
          </Field>
        </div>
        <div className="row-3">
          <Field label="LinkedIn">
            <input value={p.personal.linkedin} onChange={(e) => setPersonal('linkedin', e.target.value)} />
          </Field>
          <Field label="GitHub">
            <input value={p.personal.github} onChange={(e) => setPersonal('github', e.target.value)} />
          </Field>
          <Field label="Portfolio">
            <input value={p.personal.portfolio} onChange={(e) => setPersonal('portfolio', e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Work history */}
      <section className="card">
        <h2>Work history</h2>
        {p.workHistory.map((w, i) => (
          <WorkRow
            key={i}
            entry={w}
            onChange={(next) =>
              update((prev) => {
                const list = [...prev.workHistory];
                list[i] = next;
                return { ...prev, workHistory: list };
              })
            }
            onRemove={() =>
              update((prev) => ({
                ...prev,
                workHistory: prev.workHistory.filter((_, j) => j !== i),
              }))
            }
          />
        ))}
        <button
          className="ghost"
          onClick={() =>
            update((prev) => ({
              ...prev,
              workHistory: [
                ...prev.workHistory,
                { company: '', title: '', startDate: '', endDate: '', description: '' },
              ],
            }))
          }
        >
          + Add role
        </button>
      </section>

      {/* Education */}
      <section className="card">
        <h2>Education</h2>
        {p.education.map((ed, i) => (
          <EducationRow
            key={i}
            entry={ed}
            onChange={(next) =>
              update((prev) => {
                const list = [...prev.education];
                list[i] = next;
                return { ...prev, education: list };
              })
            }
            onRemove={() =>
              update((prev) => ({ ...prev, education: prev.education.filter((_, j) => j !== i) }))
            }
          />
        ))}
        <button
          className="ghost"
          onClick={() =>
            update((prev) => ({
              ...prev,
              education: [...prev.education, { school: '', degree: '', field: '', graduationYear: '' }],
            }))
          }
        >
          + Add education
        </button>
      </section>

      {/* Skills */}
      <section className="card">
        <h2>Skills</h2>
        <Field label="Separate with commas or new lines">
          <textarea
            style={{ minHeight: 90 }}
            value={p.skills.join(', ')}
            onChange={(e) =>
              update((prev) => ({
                ...prev,
                skills: e.target.value
                  .split(/[,\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
          />
        </Field>
      </section>

      {/* Additional documents */}
      <section className="card">
        <h2>Additional documents (extra AI context)</h2>
        <DocUpload
          onText={(name, text) =>
            update((prev) => ({
              ...prev,
              documents: [...prev.documents, { id: crypto.randomUUID(), name, text, addedAt: Date.now() }],
            }))
          }
        />
        {p.documents.length > 0 && (
          <div style={{ margin: '10px 0' }}>
            {p.documents.map((d) => (
              <div key={d.id} className="list-item" style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ flex: 1 }}>
                  📄 {d.name} <span className="help">({d.text.length.toLocaleString()} chars)</span>
                </span>
                <button
                  className="danger"
                  onClick={() =>
                    update((prev) => ({
                      ...prev,
                      documents: prev.documents.filter((x) => x.id !== d.id),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Preferences */}
      <section className="card">
        <h2>Preferences</h2>
        <div className="row">
          <Field label="Work authorization">
            <input value={p.preferences.workAuthorization} onChange={(e) => setPref('workAuthorization', e.target.value)} />
          </Field>
          <Field label="Requires sponsorship? (Yes/No)">
            <input value={p.preferences.requiresSponsorship} onChange={(e) => setPref('requiresSponsorship', e.target.value)} />
          </Field>
        </div>
        <Field label="Salary expectation">
          <input value={p.preferences.salaryExpectation} onChange={(e) => setPref('salaryExpectation', e.target.value)} />
        </Field>
      </section>

      {/* Cover letter */}
      <section className="card">
        <h2>Base cover letter</h2>
        <Field label="Template — use {{company}}, {{role}}, {{date}}">
          <textarea
            style={{ minHeight: 180 }}
            value={p.baseCoverLetter}
            onChange={(e) => update((prev) => ({ ...prev, baseCoverLetter: e.target.value }))}
          />
        </Field>
        <div className="help">
          On a job page, the popup substitutes the company/role/date placeholders.
        </div>
      </section>
      <footer className="help" style={{ marginTop: 16, textAlign: 'center' }}>
        Little AI Helper v{chrome.runtime.getManifest().version}
      </footer>
    </div>
  );
}

function WorkRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: WorkEntry;
  onChange: (e: WorkEntry) => void;
  onRemove: () => void;
}) {
  const set = (k: keyof WorkEntry, v: string) => onChange({ ...entry, [k]: v });
  return (
    <div className="list-item">
      <div className="row">
        <Field label="Title">
          <input value={entry.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Company">
          <input value={entry.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <Field label="Start (e.g. 2022)">
          <input value={entry.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field label="End (or 'present')">
          <input value={entry.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </Field>
      </div>
      <Field label="What you did">
        <textarea value={entry.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <button className="danger" onClick={onRemove}>
        Remove role
      </button>
    </div>
  );
}

function EducationRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: EducationEntry;
  onChange: (e: EducationEntry) => void;
  onRemove: () => void;
}) {
  const set = (k: keyof EducationEntry, v: string) => onChange({ ...entry, [k]: v });
  return (
    <div className="list-item">
      <div className="row">
        <Field label="School">
          <input value={entry.school} onChange={(e) => set('school', e.target.value)} />
        </Field>
        <Field label="Degree">
          <input value={entry.degree} onChange={(e) => set('degree', e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <Field label="Field of study">
          <input value={entry.field} onChange={(e) => set('field', e.target.value)} />
        </Field>
        <Field label="Graduation year">
          <input value={entry.graduationYear} onChange={(e) => set('graduationYear', e.target.value)} />
        </Field>
      </div>
      <button className="danger" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function ResumeUpload({
  onText,
  busy,
}: {
  onText: (text: string) => void | Promise<void>;
  busy: boolean;
}) {
  const [reading, setReading] = useState(false);
  const [warn, setWarn] = useState('');

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    setWarn('');
    try {
      const { text, warning } = await extractText(file);
      if (warning) setWarn(warning);
      if (text) await onText(text);
    } catch (err) {
      setWarn(`Could not read file: ${(err as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="field">
      <label>Upload resume (PDF / DOCX / TXT) — extracts text, then auto-fills</label>
      <input type="file" accept=".pdf,.docx,.txt,.md" onChange={handle} disabled={reading || busy} />
      {reading && <div className="help">Extracting text…</div>}
      {warn && <div className="warn">{warn}</div>}
    </div>
  );
}

function DocUpload({ onText }: { onText: (name: string, text: string) => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // One entry per file that had a problem, so a bad file in a batch of good
  // ones is identifiable rather than a single anonymous "could not read file".
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;

    setWarnings([]);
    setProgress({ done: 0, total: files.length });

    const results = await extractTextBatch(files, (done, total) => setProgress({ done, total }));

    for (const r of results) {
      if (r.text) onText(r.name, r.text);
    }
    setProgress(null);
    setWarnings(results.filter((r) => r.warning).map((r) => `${r.name}: ${r.warning}`));
  }

  const busy = progress !== null;
  return (
    <div className="field">
      <label>Upload PDF / DOCX / TXT — you can pick several at once</label>
      <input type="file" accept=".pdf,.docx,.txt,.md" multiple onChange={handle} disabled={busy} />
      {progress && (
        <div className="help">
          {progress.total === 1
            ? 'Extracting text…'
            : `Extracting text… ${progress.done} of ${progress.total}`}
        </div>
      )}
      {warnings.map((w) => (
        <div className="warn" key={w}>
          {w}
        </div>
      ))}
    </div>
  );
}
