// supabase.js — TripCash client init

const SUPABASE_URL = 'https://msnholvugsehlxkvzlxp.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zbmhvbHZ1Z3NlaGx4a3Z6bHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTUxMjgsImV4cCI6MjA5NjA3MTEyOH0.v9BjeRLE1l4RCkO7E3gmS0WiDLXk-O03xMtQ-UOKYrM';

const { createClient } = supabase;
const nativeAuthStorage = Boolean(window.Capacitor?.isNativePlatform?.());
const webAuthStorage = {
  getItem(key) {
    return (key.endsWith('-code-verifier') ? localStorage : sessionStorage).getItem(key);
  },
  setItem(key, value) {
    return (key.endsWith('-code-verifier') ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};
const authStorage = nativeAuthStorage ? localStorage : webAuthStorage;
// Supabase removes the one-time PKCE code while initializing the client.
// Keep only whether this load began as an auth callback, never the code itself.
const authCallbackHadCodeAtBoot = new URLSearchParams(location.search).has('code');

function getAccessToken() {
  return window._tcAccessToken || null;
}

function safeAuthCallbackSuffix(callback) {
  if (callback.href.length > 4096 || callback.hash) return '';
  const allowed = new Set(['code', 'error', 'error_code', 'error_description', 'type', 'intent']);
  const params = new URLSearchParams();
  for (const [key, value] of callback.searchParams) {
    if (allowed.has(key) && value.length <= 2048) params.append(key, value);
  }
  if (!params.has('code') && !params.has('error')) return '';
  return `?${params}`;
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    storage: authStorage,
  },
  global: {
    fetch: (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      const token = getAccessToken();

      if (token && String(url).includes('/rest/v1/')) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      return fetch(url, { ...options, headers });
    },
  },
});

// Route iOS and Android auth callbacks back through the local Capacitor origin.
// Supabase exchanges the one-time PKCE code during the following reload.
function handleNativeAuthUrl(result) {
  const url = result?.url || '';
  let callback;
  try {
    callback = new URL(url);
  } catch (_) {
    return;
  }
  const verifiedWebCallback =
    callback.protocol === 'https:' && callback.hostname === 'tripcash.de' && callback.pathname === '/auth-callback';
  const installedAppCallback =
    callback.protocol === 'com.tripcash.app:' &&
    callback.hostname === 'auth-callback' &&
    (callback.pathname === '' || callback.pathname === '/');
  if (!verifiedWebCallback && !installedAppCallback) return;
  const browser = window.Capacitor?.Plugins?.Browser;
  if (browser) void browser.close().catch(() => {});

  const query = safeAuthCallbackSuffix(callback);
  if (!query || location.search === query) return;

  const callbackType = new URLSearchParams(query).get('type');
  if (callbackType === 'recovery') localStorage.setItem('tc-password-recovery-pending', 'true');

  history.replaceState(null, '', `${location.pathname}${query}`);
  location.reload();
}

document.addEventListener('DOMContentLoaded', () => {
  const nativeApp = window.Capacitor?.Plugins?.App;
  if (!nativeApp) return;

  nativeApp.addListener('appUrlOpen', handleNativeAuthUrl);
  nativeApp
    .getLaunchUrl()
    .then(handleNativeAuthUrl)
    .catch(() => {});
});
