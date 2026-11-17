import { pageUrl } from './base.js';

/**
 * Guest or Member (ADR 0011). The page always opens as a Guest; GET api/auth/me upgrades it to a Member when the
 * Visitor already has a MANGOs Session (the shared .mangosgo.com cookie, which the page itself cannot read).
 * Where to log in and out comes from the server's config. Nothing here redirects on its own.
 */
const GUEST = { mode: 'guest', member: null, enabled: false, loginUrl: null, logoutUrl: null, error: null };

export async function loadSession() {
  try {
    const response = await fetch(pageUrl('api/auth/me'), { credentials: 'same-origin', cache: 'no-store' });
    const body = await response.json();
    const links = { enabled: body.enabled === true && Boolean(body.loginUrl), loginUrl: body.loginUrl ?? null, logoutUrl: body.logoutUrl ?? null };
    if (response.ok && body.mode === 'member' && body.member) return { ...GUEST, ...links, mode: 'member', member: body.member };
    return { ...GUEST, ...links, error: response.status === 401 ? null : body.error ?? 'unavailable' };
  } catch {
    return { ...GUEST, error: 'unavailable' };
  }
}

/** What each mode may use. Every Member-only feature checks here, so later ones (Multiplayer) plug in at one place. */
export function features(session) {
  return { avatarPicker: session.mode === 'member' };
}

/** MANGOs login page; MANGOs sends the Visitor back to this exact page, now with the shared session. */
export function login(session) {
  const target = new URL(session.loginUrl);
  target.searchParams.set('redirect', location.href);
  location.assign(target.href);
}

/**
 * Global MANGOs logout (the app keeps no login state of its own). Needs api.mangosgo.com to allow this origin
 * with credentials. When it does not, `onFallback` explains, then the Visitor is sent to MANGOs to log out there.
 */
export async function logout(session, { onFallback = () => {} } = {}) {
  try {
    const response = await fetch(session.logoutUrl, { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error(String(response.status));
    location.reload();
  } catch {
    onFallback();
    setTimeout(() => location.assign(new URL('/', session.loginUrl).href), 2500);
  }
}

/** The Member's last chosen Avatar, per MANGOs user id. Storage may be blocked; then nothing is remembered. */
export function savedAvatar(session) {
  try { return session.member ? localStorage.getItem(`aiavatar.avatar.${session.member.id}`) : null; } catch { return null; }
}
export function saveAvatar(session, id) {
  try { if (session.member) localStorage.setItem(`aiavatar.avatar.${session.member.id}`, id); } catch { /* optional */ }
}
