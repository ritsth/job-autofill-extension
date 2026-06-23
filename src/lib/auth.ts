// Google sign-in for the managed proxy, via chrome.identity.
//
// The managed proxy meters AI usage per user, so it needs to know *who* is
// calling. We use Chrome's built-in identity API (no passwords, no extra
// backend): getAuthToken returns the signed-in user's Google OAuth access token,
// which the extension sends to the proxy as the bearer; the proxy verifies it and
// counts the call against that user's daily quota.
//
// Requires `identity` permission + an `oauth2` block in the manifest.

const AUTH_KEY = 'auth';
// Sticky "the user explicitly signed out" flag. Chrome silently re-mints tokens
// for basic scopes (email/profile) even after we revoke, so revocation alone
// can't keep sign-out from snapping back. While this flag is set we refuse silent
// tokens; an interactive signIn() clears it.
const SIGNED_OUT_KEY = 'signedOut';

export interface AuthUser {
  email: string;
}

/**
 * Resolves a Google OAuth access token. `interactive: true` shows the account
 * picker / consent on first sign-in; `interactive: false` silently returns a
 * cached (auto-refreshed) token, rejecting when the user isn't signed in.
 */
function getToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      const err = chrome.runtime.lastError;
      // Newer Chrome passes a { token } object; older versions a bare string.
      const token =
        typeof result === 'string'
          ? result
          : (result as unknown as { token?: string } | undefined)?.token;
      if (err || !token) {
        reject(new Error(err?.message || 'Not signed in'));
        return;
      }
      resolve(token);
    });
  });
}

/** Best-effort fetch of the user's email for display. Empty on any failure. */
async function fetchEmail(token: string): Promise<string> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { email?: string };
    return data.email || '';
  } catch {
    return '';
  }
}

/** Interactive sign-in. Caches the user's email locally and returns it. */
export async function signIn(): Promise<AuthUser> {
  const token = await getToken(true);
  const user: AuthUser = { email: await fetchEmail(token) };
  await chrome.storage.local.set({ [AUTH_KEY]: user });
  // Clear the sticky sign-out flag — the user is deliberately signing back in.
  await chrome.storage.local.remove(SIGNED_OUT_KEY);
  return user;
}

/**
 * Silent token for proxy calls. Rejects (→ "Sign in…") when not signed in, or
 * when the user explicitly signed out (even if Chrome would still mint a token).
 */
export async function getCachedToken(): Promise<string> {
  const r = await chrome.storage.local.get(SIGNED_OUT_KEY);
  if (r[SIGNED_OUT_KEY]) throw new Error('Signed out');
  return getToken(false);
}

/** Revokes the grant, clears Chrome's cache, and forgets the stored email. */
export async function signOut(): Promise<void> {
  try {
    const token = await getToken(false);
    // Revoke at Google — revoking the access token also revokes its refresh
    // token, killing the grant so a silent getAuthToken can't mint a new one.
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token)).catch(
      () => {},
    );
    await new Promise<void>((resolve) =>
      chrome.identity.removeCachedAuthToken({ token }, () => resolve()),
    );
  } catch {
    // Not signed in — nothing to revoke.
  }
  // Flush ALL cached tokens for this extension. removeCachedAuthToken only drops
  // the one token we saw; Chrome may hold others it would otherwise hand back to
  // a silent getAuthToken, making sign-out look ineffective (Test proxy still
  // works). Clearing the whole cache + the revoke above makes sign-out stick.
  await new Promise<void>((resolve) => chrome.identity.clearAllCachedAuthTokens(() => resolve()));
  // Set the sticky flag BEFORE removing the email so getCachedToken refuses to
  // silently re-mint, and reconcileAuthUser won't snap us back to "signed in".
  await chrome.storage.local.set({ [SIGNED_OUT_KEY]: true });
  await chrome.storage.local.remove(AUTH_KEY);
}

/** The signed-in user (for UI), or null. Presence of a stored email = signed in. */
export async function getAuthUser(): Promise<AuthUser | null> {
  const r = await chrome.storage.local.get(AUTH_KEY);
  return (r[AUTH_KEY] as AuthUser) ?? null;
}

/**
 * Sign-in state for the UI, reconciled with Chrome's actual OAuth grant. If we
 * have a stored user, use it. Otherwise a silent token may still exist — e.g. the
 * account-level grant survived an extension reload that cleared our stored email —
 * so detect it, persist the email (which fires onAuthChanged so every surface
 * syncs), and report as signed in. Returns null only when truly signed out.
 */
export async function reconcileAuthUser(): Promise<AuthUser | null> {
  const stored = await getAuthUser();
  if (stored) return stored;
  let token: string;
  try {
    token = await getCachedToken();
  } catch {
    return null;
  }
  const user: AuthUser = { email: await fetchEmail(token) };
  await chrome.storage.local.set({ [AUTH_KEY]: user });
  return user;
}

/** Subscribe to sign-in/out changes so the UI stays in sync across surfaces. */
export function onAuthChanged(cb: (user: AuthUser | null) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[AUTH_KEY]) {
      cb((changes[AUTH_KEY].newValue as AuthUser) ?? null);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
