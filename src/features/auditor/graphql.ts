/**
 * ThreadMax — Relationship Auditor: GraphQL Fetcher
 * Background API scan with safe pacing and doc_id sniffing.
 */

import { TM_Config } from '../../../config';
import { buildGraphQLPayload, validateUserId, extractIdFromCookie, extractIdFromDeepLink, extractIdFromScriptSlice, parseUsernamesFromHrefs, GRAPHQL_HEADERS, API_ORIGINS, EXCLUDED_USERNAME_PATHS } from '../../../utils';
import { TIMING } from '../../../constants';
import { RateLimiters, withRateLimit } from '../../../utils/rateLimit';

interface FetchProgressCallback {
  (type: 'followers' | 'following', count: number, page: number): void;
}

export async function fetchUserId(username: string): Promise<string | null> {
  if (!username) return null;
  const cleanUser = username.replace(/^@/, '').toLowerCase().trim();

  const validateAndCache = (id: string): string | null => {
    if (!id) return null;
    const str = String(id).trim();
    if (/^\d{4,25}$/.test(str) && str !== '0') {
      TM_Config.setUserId(cleanUser, str);
      return str;
    }
    return null;
  };

  // Tier 0: Persistent cache
  try {
    const cached = TM_Config.getUserId(cleanUser);
    if (cached && validateAndCache(cached)) return String(cached);
  } catch {}

  // Tier 1: Cookie (if self)
  try {
    const currentDetected = (detectUsername() || '').toLowerCase();
    const isSelf = !currentDetected || currentDetected === cleanUser;
    if (isSelf) {
      const mCookie = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/);
      if (mCookie && validateAndCache(mCookie[1])) return validateAndCache(mCookie[1]);
    }
  } catch {}

  // Tier 2: Deep link in meta/link tags
  try {
    const metaTags = document.querySelectorAll('meta[content*="user?id="], link[href*="user?id="]');
    for (const tag of metaTags) {
      const val = tag.getAttribute('content') || tag.getAttribute('href') || '';
      const m = val.match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i);
      if (m && validateAndCache(m[1])) return validateAndCache(m[1]);
    }
  } catch {}

  // Tier 3: In-page script JSON near username
  try {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const text = s.textContent || '';
      if (text.includes(cleanUser)) {
        const idx = text.indexOf(cleanUser);
        const slice = text.substring(Math.max(0, idx - 600), Math.min(text.length, idx + 600));
        const m = slice.match(/"(?:pk|user_id|target_user_id|profile_id)":"?(\d{4,25})"?/);
        if (m && validateAndCache(m[1])) return validateAndCache(m[1]);
      }
    }
  } catch {}

  // Tier 4: Same-origin HTML fetch of profile page
  try {
    const baseOrigin = window.location.origin || 'https://www.threads.net';
    const profileUrl = `${baseOrigin}/@${encodeURIComponent(cleanUser)}`;
    const pageRes = await fetch(profileUrl, {
      credentials: 'include',
      headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const mBarc = html.match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i);
      if (mBarc && validateAndCache(mBarc[1])) return validateAndCache(mBarc[1]);
      
      const idx = html.indexOf(cleanUser);
      if (idx !== -1) {
        const slice = html.substring(Math.max(0, idx - 600), Math.min(html.length, idx + 600));
        const m = slice.match(/"(?:pk|user_id|target_user_id|profile_id)":"?(\d{4,25})"?/);
        if (m && validateAndCache(m[1])) return validateAndCache(m[1]);
      }
      const mUser = html.match(/"user_id":"?(\d{4,25})"?/);
      if (mUser && validateAndCache(mUser[1])) return validateAndCache(mUser[1]);
    }
  } catch {}

  // Tier 5: REST API endpoints
  const testOrigins = [
    window.location.origin,
    'https://www.threads.com',
    'https://www.threads.net',
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  for (const origin of testOrigins) {
    try {
      const res = await fetch(`${origin}/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanUser)}`, {
        headers: { 'X-IG-App-ID': '238260118658252', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        const id = json?.data?.user?.pk || json?.data?.user?.id;
        if (id && validateAndCache(id)) return validateAndCache(id);
      }
    } catch {}
  }

  // Tier 6: Manual input fallback
  try {
    const manual = prompt(
      `[ThreadMax] Cannot auto-detect User ID for @${cleanUser}\n\nIf you know the User ID, enter it here or press Cancel:`
    );
    if (manual && /^\d+$/.test(manual.trim())) {
      return validateAndCache(manual.trim());
    }
  } catch {}

  return null;
}

export function detectUsername(): string | null {
  // 1. Current URL if on profile page
  const match = window.location.pathname.match(/^\/@([^/?#]+)/);
  if (match && !['explore', 'search', 'activity', 'messages', 'settings'].includes(match[1])) {
    return match[1];
  }
  // 2. Profile link in sidebar
  const profileLink = document.querySelector('a[href^="/@"]:not([href*="/post/"])');
  if (profileLink) {
    const m = (profileLink.getAttribute('href') || '').match(/@([^/?#]+)/);
    if (m) return m[1];
  }
  // 3. Avatar link
  const avatarLink = document.querySelector('a[href*="/@"]');
  if (avatarLink) {
    const m = (avatarLink.getAttribute('href') || '').match(/@([^/?#]+)/);
    if (m) return m[1];
  }
  return null;
}

export function sleepJitter(min = 3000, max = 5000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchGraphQLList(
  type: 'followers' | 'following',
  userId: string,
  onProgress: FetchProgressCallback | undefined,
  signal: AbortSignal
): Promise<string[]> {
  const baseOrigin = window.location.origin || 'https://www.threads.com';
  const lsd = document.querySelector('input[name="lsd"]')?.value || 
              (typeof unsafeWindow !== 'undefined' && unsafeWindow.LSD?.token) || '';
  
  const docId = TM_Config.getDocIdFollowers() || TM_Config.getDocIdFollowing();
  // Try specific doc_id first
  const specificDocId = type === 'followers' ? TM_Config.getDocIdFollowers() : TM_Config.getDocIdFollowing();
  
  if (!specificDocId) {
    throw new Error('NO_DOC_ID');
  }

  const usernames: string[] = [];
  let afterCursor: string | null = null;
  let hasNext = true;
  let page = 0;

  while (hasNext && !signal.aborted) {
    page++;
    const variables = { userID: userId, first: 50, after: afterCursor };
    const form = new URLSearchParams();
    if (lsd) form.set('lsd', lsd);
    form.set('variables', JSON.stringify(variables));
    form.set('doc_id', specificDocId);

    // Rate-limit guard: consume token before issuing GraphQL POST
    await RateLimiters.graphql.consume(1);

    const res = await fetch(`${baseOrigin}/api/graphql`, {
      method: 'POST',
      headers: {
        ...GRAPHQL_HEADERS,
        'X-FB-LSD': lsd,
      },
      credentials: 'include',
      body: form.toString(),
      signal,
    });

    if (!res.ok) {
      throw new Error(`GRAPHQL_${res.status}`);
    }

    const json = await res.json();
    const edgeData = type === 'followers'
      ? (json?.data?.user?.edge_followed_by || json?.data?.viewer?.user?.edge_followed_by)
      : (json?.data?.user?.edge_follow || json?.data?.viewer?.user?.edge_follow);

    const edges = edgeData?.edges || [];
    for (const e of edges) {
      const u = e.node?.username;
      if (u && !usernames.includes(u.toLowerCase())) {
        usernames.push(u.toLowerCase());
      }
    }

    if (onProgress) onProgress(type, usernames.length, page);

    hasNext = edgeData?.page_info?.has_next_page || false;
    afterCursor = edgeData?.page_info?.end_cursor || null;

    if (hasNext && !signal.aborted) {
      await sleepJitter(TIMING.GRAPHQL_JITTER_MIN_MS, TIMING.GRAPHQL_JITTER_MAX_MS);
    }
  }

  return usernames;
}

// ─── Active Sniffer (captures doc_id from live GraphQL requests) ─────────────
let snifferInstalled = false;

export function installGraphQLSniffer(): void {
  if (snifferInstalled) return;
  snifferInstalled = true;

  try {
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (win.__tm_sniffer_installed) return;
    win.__tm_sniffer_installed = true;

    const origFetch = win.fetch;
    win.fetch = async function (...args: any[]) {
      const url = args[0] ? String(args[0]) : '';
      const init = args[1] || {};

      if (url.includes('/api/graphql')) {
        try {
          const bodyStr = typeof init.body === 'string'
            ? init.body
            : (init.body instanceof URLSearchParams ? init.body.toString() : '');
          const params = new URLSearchParams(bodyStr);
          const docId = params.get('doc_id');
          const friendlyName = params.get('fb_api_req_friendly_name') || '';

          if (docId) {
            if (friendlyName.toLowerCase().includes('follower') || bodyStr.includes('follower')) {
              TM_Config.setDocIdFollowers(docId);
              console.info('[ThreadMax Sniffer] Captured Live Followers doc_id:', docId);
            } else if (friendlyName.toLowerCase().includes('following') || bodyStr.includes('following')) {
              TM_Config.setDocIdFollowing(docId);
              console.info('[ThreadMax Sniffer] Captured Live Following doc_id:', docId);
            }
          }
        } catch {}
      }

      return origFetch.apply(this, args);
    };
  } catch (e) {
    console.warn('[ThreadMax] Failed to install sniffer:', e);
  }
}