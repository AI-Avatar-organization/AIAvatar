/**
 * MANGOs Session (ADR 0011): a Visitor logged in to MANGOs carries the shared `accessToken` cookie on .mangosgo.com,
 * so this app on ai.mangosgo.com receives it with every same-origin request. The backend validates it with
 * MANGOs Auth (GET /users/me) and never sets a cookie of its own. No cookie or a rejected one means Guest.
 */
const DEFAULT_API_BASE = 'https://api.mangosgo.com/api/v1';
const DEFAULT_LOGIN_URL = 'https://mangosgo.com/login';
// Profile images are public files on the MANGOs API host, even when the backend reaches MANGOs at another address.
const DEFAULT_IMAGE_ORIGIN = 'https://api.mangosgo.com';

/** Value of one cookie from a Cookie header, or null. */
export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try { return decodeURIComponent(value) || null; } catch { return value || null; }
  }
  return null;
}

/** A browser-loadable http(s) image URL, or null (anything else, e.g. javascript:, is dropped). */
function imageUrl(value, origin) {
  if (!value) return null;
  try {
    const resolved = new URL(value, origin);
    return ['https:', 'http:'].includes(resolved.protocol) ? resolved.href : null;
  } catch { return null; }
}

/** The Member as the app sees them: only display fields; email and roles stay with MANGOs. */
function toMember(mangosUser, imageOrigin) {
  const displayName = mangosUser.displayName ?? ([mangosUser.firstName, mangosUser.lastName].filter(Boolean).join(' ') || 'MANGOs');
  return {
    id: mangosUser.id,
    firstName: mangosUser.firstName ?? null,
    lastName: mangosUser.lastName ?? null,
    displayName,
    avatarImageUrl: imageUrl(mangosUser.avatarImageUrl, imageOrigin)
  };
}

export function createMangosAuth({
  apiBase = process.env.MANGOS_API_BASE ?? DEFAULT_API_BASE,
  loginUrl = process.env.MANGOS_LOGIN_URL ?? DEFAULT_LOGIN_URL,
  // Logout runs in the browser (it must clear the shared cookie), so it uses the public API address.
  logoutUrl = process.env.MANGOS_LOGOUT_URL ?? `${DEFAULT_API_BASE}/auth/logout`,
  imageOrigin = process.env.MANGOS_IMAGE_ORIGIN ?? DEFAULT_IMAGE_ORIGIN,
  enabled = process.env.MANGOS_AUTH !== 'off',
  ttlMs = 60_000,
  timeoutMs = 5_000,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  const base = apiBase.replace(/\/+$/, '');
  const cache = new Map(); // accessToken → { member, expiresAt }; successes only, as the MANGOs guide asks

  /** The Member behind this request, or null for a Guest. Throws { status: 503 } when MANGOs Auth cannot answer. */
  async function memberFrom(request) {
    if (!enabled) return null;
    const token = readCookie(request.headers.cookie, 'accessToken');
    if (!token) return null;
    const cached = cache.get(token);
    if (cached && cached.expiresAt > now()) return cached.member;
    cache.delete(token);
    let response;
    try {
      response = await fetchImpl(`${base}/users/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw Object.assign(new Error('MANGOs Auth ไม่ตอบ'), { status: 503 });
    }
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw Object.assign(new Error(`MANGOs Auth ตอบ ${response.status}`), { status: 503 });
    const body = await response.json();
    const mangosUser = body?.data?.User ?? body?.User;
    if (!mangosUser?.id) throw Object.assign(new Error('MANGOs Auth ตอบไม่มีข้อมูลผู้ใช้'), { status: 503 });
    const member = toMember(mangosUser, imageOrigin);
    // Drop expired entries now and then so the map cannot grow without bound.
    if (cache.size > 1000) for (const [key, entry] of cache) if (entry.expiresAt <= now()) cache.delete(key);
    cache.set(token, { member, expiresAt: now() + ttlMs });
    return member;
  }

  /** For Member-only APIs (e.g. Multiplayer later): the Member, or throws { status: 401 }. */
  async function requireMember(request) {
    const member = await memberFrom(request);
    if (!member) throw Object.assign(new Error('ต้องเข้าสู่ระบบ MANGOs ก่อน'), { status: 401 });
    return member;
  }

  return { enabled, loginUrl, logoutUrl, memberFrom, requireMember };
}
