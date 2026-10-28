// auth.js — login, register, guest, logout
// Relies on: db (supabase.js), showToast / showScreen / setLoading / shake (app.js)

// ── Auth state listener ───────────────────────────────────────
let authBooted = false;
let authSessionSequence = 0;
const PASSWORD_RECOVERY_KEY = 'tc-password-recovery-pending';
const PROFILE_CACHE_PREFIX = 'tc-profile-cache-';
// Matches the trip and identity caches: on a shared browser, a profile (name,
// PayPal link) left behind by a closed tab does not outlive a week.
const PROFILE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NATIVE_TURNSTILE_URL = 'https://tripcash.de/native-captcha';
const AUTH_INTENT_PARAM = 'intent';
const SIGNUP_CONFIRMATION_INTENT = 'signup';
let signupConfirmationShownThisLoad = false;
let initialSessionRefreshPromise = null;
let profileInitializationPromise = Promise.resolve();
const authTurnstileWidgets = new Map();
const authTurnstilePromises = new Map();
const nativeTurnstileWidgets = new Map();
const failedAuthTurnstileFlows = new Set();
// Apple and Google are configured for this deployment, so render them in the
// initial auth layout instead of inserting a large block after the settings request.
// A successful settings response can still remove a provider that has been disabled.
const availableSocialProviders = new Set(['apple', 'google']);
let socialLoginPending = false;

async function loadSocialProviders() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: controller.signal,
    });
    if (!response.ok) return;
    const settings = await response.json();
    for (const provider of ['apple', 'google']) {
      if (settings.external?.[provider] === true) availableSocialProviders.add(provider);
      else availableSocialProviders.delete(provider);
      const button = document.querySelector(`[data-social-provider="${provider}"]`);
      if (button) button.hidden = !availableSocialProviders.has(provider);
    }
    updateSocialLoginVisibility();
  } catch (_) {
    /* Email and guest login remain available. */
  } finally {
    clearTimeout(timeout);
  }
}

function updateSocialLoginVisibility() {
  const section = document.getElementById('social-login');
  const mode = document.getElementById('screen-auth')?.dataset.authMode || 'login';
  if (section) section.hidden = !availableSocialProviders.size || mode !== 'login';
}

function arrangeAuthEntry() {
  const entry = document.getElementById('auth-login-start');
  const social = document.getElementById('social-login');
  const form = document.getElementById('form-login-email');
  const actions = entry?.querySelector('.auth-entry-actions');
  const notice = document.getElementById('social-terms-notice');
  const buttons = social?.querySelector('.social-login-buttons');
  const divider = social?.querySelector('.auth-divider');
  if (!entry || !social || !form || !actions || !notice || !buttons || !divider) return;
  // Keep the age and Terms notice with the buttons it applies to, not the email form.
  social.append(buttons, notice, divider);
  entry.insertBefore(social, form);
}

async function startSocialLogin(provider) {
  if (socialLoginPending || !availableSocialProviders.has(provider)) return;
  if (isAnonymousAuthUser(window._currentUser)) {
    showToast('Save your guest account with email before using social sign-in.', 'error');
    return;
  }
  socialLoginPending = true;
  const buttons = document.querySelectorAll('[data-social-provider]');
  buttons.forEach(button => {
    button.disabled = true;
  });
  try {
    const native = isNativeAuthRuntime();
    const nativePlatform = window.Capacitor?.getPlatform?.();
    if (native && nativePlatform === 'ios' && provider === 'apple') {
      await startNativeAppleLogin();
      return;
    }
    const { data, error } = await db.auth.signInWithOAuth({
      provider,
      options: { redirectTo: nativeOrWebAuthRedirect() || `${location.origin}/app`, skipBrowserRedirect: true },
    });
    if (error) throw error;
    const destination = new URL(data.url);
    if (destination.origin !== SUPABASE_URL || destination.pathname !== '/auth/v1/authorize')
      throw new Error('Invalid authorization destination');
    if (native) {
      const browser = window.Capacitor?.Plugins?.Browser;
      if (!browser) throw new Error('Browser plugin is unavailable');
      await browser.open({ url: destination.href });
    } else location.assign(destination.href);
  } catch (error) {
    showToast(socialLoginErrorMessage(provider, error), 'error');
  } finally {
    socialLoginPending = false;
    buttons.forEach(button => {
      button.disabled = false;
    });
  }
}

function socialLoginErrorMessage(provider, error) {
  const detail = String(error?.message || '').toLowerCase();
  if (
    provider === 'apple' &&
    (detail.includes('audience') || detail.includes('client id') || detail.includes('client_id'))
  ) {
    return 'Apple sign-in is not configured for this iPhone app yet. Please try again later.';
  }
  if (provider === 'apple' && detail.includes('nonce')) {
    return 'Apple could not verify this sign-in. Please close the app and try again.';
  }
  return 'Sign-in could not start. Please try again or use email.';
}

async function startNativeAppleLogin() {
  const apple = window.Capacitor?.Plugins?.AppleReauth;
  if (!apple?.signIn) throw new Error('Native Apple sign-in is unavailable');
  // Let any boot-time refresh finish before exchanging Apple's token. Otherwise
  // that older refresh can persist the previous guest session after Apple wins.
  if (initialSessionRefreshPromise) await initialSessionRefreshPromise.catch(() => null);
  const authorization = await apple.signIn();
  if (authorization?.cancelled) return;
  if (!authorization?.identityToken || !authorization?.nonce) {
    throw new Error('Apple did not return the required sign-in details');
  }

  const { data, error } = await db.auth.signInWithIdToken({
    provider: 'apple',
    token: authorization.identityToken,
    nonce: authorization.nonce,
  });
  if (error) throw error;
  const appleProvider =
    data?.user?.app_metadata?.provider === 'apple' ||
    data?.user?.app_metadata?.providers?.includes?.('apple') ||
    data?.user?.identities?.some(identity => identity?.provider === 'apple');
  if (!data?.user || isAnonymousAuthUser(data.user) || !appleProvider) {
    throw new Error('Apple sign-in did not create an authenticated Apple session');
  }

  const givenName = String(authorization.givenName || '').trim();
  const familyName = String(authorization.familyName || '').trim();
  const fullName = [givenName, familyName].filter(Boolean).join(' ');
  if (fullName && !data?.user?.user_metadata?.full_name) {
    const { error: profileError } = await db.auth.updateUser({
      data: { full_name: fullName, given_name: givenName, family_name: familyName },
    });
    // A profile-name failure must not invalidate the completed Apple session.
    if (profileError) return;
  }
}
const authTurnstileActions = {
  login: 'login',
  register: 'signup',
  guest: 'guest',
  recovery: 'recovery',
  reauth: 'reauth',
};

function isNativeAuthRuntime() {
  return Boolean(window.Capacitor?.isNativePlatform?.()) || location.protocol === 'capacitor:';
}

function isAnonymousAuthUser(user) {
  if (!user) return false;
  if (user.is_anonymous === true || user.app_metadata?.provider === 'anonymous') return true;
  if (
    user.is_anonymous === false ||
    user.app_metadata?.provider ||
    user.identities?.some(identity => identity?.provider && identity.provider !== 'anonymous')
  )
    return false;
  // Compatibility fallback for cached users created before Supabase exposed
  // is_anonymous. Provider-backed users must never be inferred from email alone.
  return !user.email;
}

window.addEventListener?.('message', event => {
  if (event.origin !== 'https://tripcash.de') return;
  const message = event.data;
  if (!message || message.source !== 'tripcash-native-turnstile') return;
  const state = nativeTurnstileWidgets.get(message.flow);
  if (!state || event.source !== state.frame.contentWindow || message.channel !== state.channel) return;
  if (message.type === 'token' && typeof message.token === 'string' && message.token) {
    state.token = message.token;
  } else if (message.type === 'expired') {
    state.token = '';
  } else if (message.type === 'error') {
    state.token = '';
    showToast('Bot protection could not complete. Please try again.', 'error');
  }
});
const recoveryCallbackInUrl = new URLSearchParams(location.hash.replace(/^#/, '')).get('type') === 'recovery';
window._passwordRecoveryPending = localStorage.getItem(PASSWORD_RECOVERY_KEY) === 'true' || recoveryCallbackInUrl;
if (recoveryCallbackInUrl) localStorage.setItem(PASSWORD_RECOVERY_KEY, 'true');

function setPasswordRecoveryPending(pending) {
  window._passwordRecoveryPending = Boolean(pending);
  if (pending) localStorage.setItem(PASSWORD_RECOVERY_KEY, 'true');
  else localStorage.removeItem(PASSWORD_RECOVERY_KEY);
}

function passwordRecoveryPending() {
  return window._passwordRecoveryPending === true;
}

function configureNewPasswordModal(mode) {
  const modal = document.getElementById('modal-new-password');
  const form = document.getElementById('form-new-password');
  const currentGroup = document.getElementById('current-password-group');
  const currentInput = document.getElementById('current-password');
  const reauthCaptcha = document.getElementById('auth-turnstile-reauth');
  const close = document.getElementById('btn-close-new-password');
  const cancel = document.getElementById('btn-cancel-password-recovery');
  const title = modal?.querySelector('.modal-title');
  const titles = {
    change: 'Change password',
    recovery: 'Choose a new password',
    'guest-upgrade': 'Finish saving your account',
  };

  form?.reset();
  authInlineValidators.get('form-new-password')?.clear();
  if (modal) modal.dataset.passwordMode = mode;
  if (title) title.textContent = titles[mode] || titles.recovery;
  if (currentGroup) currentGroup.hidden = mode !== 'change';
  if (currentInput) currentInput.required = mode === 'change';
  if (reauthCaptcha) reauthCaptcha.hidden = mode !== 'change';
  if (close) close.hidden = mode !== 'change';
  if (cancel) cancel.hidden = mode !== 'recovery';
}

function openPasswordRecoveryGate() {
  showScreen('auth');
  setTimeout(() => {
    configureNewPasswordModal('recovery');
    openModal('modal-new-password');
    document.getElementById('new-password')?.focus();
  }, 0);
}

async function handleAuthSession(event, session) {
  const sequence = ++authSessionSequence;
  authBooted = true;
  moveWebIntentToAppPath();
  if (session) {
    if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryPending(true);
    // Force-refresh on initial load so an asymmetric-key rotation never
    // leaves a stale token that PostgREST can't verify (auth.uid() → null).
    if (event === 'INITIAL_SESSION') {
      const refreshAttempt = db.auth.refreshSession().catch(() => null);
      const refreshGate = Promise.race([refreshAttempt, new Promise(resolve => setTimeout(() => resolve(null), 1500))]);
      initialSessionRefreshPromise = refreshGate;
      const refreshed = await refreshGate;
      if (initialSessionRefreshPromise === refreshGate) initialSessionRefreshPromise = null;
      // A native provider can finish while the initial guest refresh is still
      // pending. Never let that older callback replace the new signed-in user.
      if (sequence !== authSessionSequence) return;
      session = refreshed?.data?.session || session;
    }
    window._tcAccessToken = session.access_token || null;
    window._currentUser = session.user;
    window.TripCashOffline?.cacheUser(session.user);
    restoreCachedProfile(session.user);
    const profileRefresh = ensureProfile(session.user)
      .then(() => refreshProfileIdentity(session.user))
      .catch(() => null);
    profileInitializationPromise = profileRefresh;
    if (passwordRecoveryPending()) {
      openPasswordRecoveryGate();
      return;
    }

    if (isWebLandingPath()) {
      showScreen('welcome');
      void profileRefresh;
      return;
    }

    onUserReady();
    showSignupConfirmationIfNeeded(session.user);
    if (session.user.email && session.user.user_metadata?.guest_upgrade_pending) {
      setTimeout(() => {
        configureNewPasswordModal('guest-upgrade');
        openModal('modal-new-password');
      }, 0);
    }
  } else {
    const offlineUser = navigator.onLine === false ? window.TripCashOffline?.restoreUser() : null;
    if (offlineUser) {
      window._tcAccessToken = null;
      window._currentUser = offlineUser;
      restoreCachedProfile(offlineUser);
      onUserReady();
      showToast('Offline mode: saved trips and changes remain available.', 'info');
      return;
    }
    setPasswordRecoveryPending(false);
    window.TripCashOffline?.clearUser();
    window._tcAccessToken = null;
    window._currentUser = null;
    window._currentProfile = null;
    const invite = new URLSearchParams(location.search).get('invite');
    if (invite) sessionStorage.setItem('pending_invite', invite);
    await showInvitePreview(invite);
    if (invite || isWebAppPath()) openAuthMode('login');
    else showScreen('welcome');
  }
}

function profileCacheKey(user) {
  return user?.id ? `${PROFILE_CACHE_PREFIX}${user.id}` : null;
}

function restoreCachedProfile(user) {
  const pendingName = sessionStorage.getItem('pending_display_name');
  const fallbackName = user.user_metadata?.display_name || (user.email ? user.email.split('@')[0] : 'Guest');
  const hadLocalPreferences = ['tc-home-currency', 'tc-default-split', 'tc-theme'].some(
    key => localStorage.getItem(key) !== null,
  );
  let cached = null;
  try {
    const key = profileCacheKey(user);
    cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && !Number.isFinite(cached.savedAt)) {
      // Caches from before expiry existed start their week now.
      cached.savedAt = Date.now();
      localStorage.setItem(key, JSON.stringify(cached));
    } else if (cached && Date.now() - cached.savedAt > PROFILE_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(key);
      cached = null;
    }
    if (cached && typeof cached === 'object') delete cached.savedAt;
  } catch (_) {}
  const cacheHasPreferences =
    cached && ['home_currency', 'default_split', 'theme_preference'].every(field => typeof cached[field] === 'string');
  window._pendingProfilePreferenceMigration =
    hadLocalPreferences && !cacheHasPreferences ? localProfilePreferences() : null;
  window._currentProfile = {
    ...(cached && typeof cached === 'object' ? cached : {}),
    id: user.id,
    display_name: pendingName || cached?.display_name || fallbackName,
    is_anonymous: isAnonymousAuthUser(user),
  };
}

function cacheProfile(user, profile) {
  const key = profileCacheKey(user);
  if (!key || !profile) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        id: user.id,
        display_name: profile.display_name || '',
        paypal_link: profile.paypal_link || null,
        home_currency: profile.home_currency || 'EUR',
        default_split: profile.default_split || 'equal',
        theme_preference: profile.theme_preference || 'system',
        is_anonymous: Boolean(profile.is_anonymous),
        savedAt: Date.now(),
      }),
    );
  } catch (_) {}
}

function refreshProfileIdentity(user) {
  if (window._currentUser?.id !== user.id || !window._currentProfile) return;
  const name = window._currentProfile.display_name || user.email?.split('@')[0] || 'Guest';
  const label = document.getElementById('header-user-label');
  if (label) label.textContent = name;
  const greeting = document.getElementById('trips-greeting');
  if (greeting)
    greeting.innerHTML = `<div><div class="greeting-title">Hello, <span>${esc(name)}</span></div><div class="greeting-sub">Where to next?</div></div>`;
  if (document.body?.dataset?.screen === 'profile') renderProfileScreen();
}

db.auth.onAuthStateChange(handleAuthSession);

document.addEventListener('DOMContentLoaded', async () => {
  setTimeout(async () => {
    if (authBooted) return;
    const { data } = await db.auth.getSession();
    await handleAuthSession('INITIAL_SESSION', data.session);
  }, 300);
});

async function showInvitePreview(invite) {
  const el = document.getElementById('invite-preview');
  if (!el) return;
  if (!invite) {
    el.hidden = true;
    el.textContent = '';
    return;
  }

  const { data } = await db.rpc('get_trip_preview', { p_invite_token: invite }).maybeSingle();
  if (!data) {
    el.hidden = true;
    el.textContent = '';
    return;
  }

  el.textContent = `You are joining ${data.emoji || ''} ${data.name}`;
  el.hidden = false;
}

// Create or refresh the caller's own profile without updating immutable columns.
async function ensureProfile(user) {
  const pendingName = sessionStorage.getItem('pending_display_name');
  const pendingPreferences = window._pendingProfilePreferenceMigration;
  const fallbackName =
    window._currentProfile?.display_name ||
    user.user_metadata?.display_name ||
    (user.email ? user.email.split('@')[0] : 'Guest');
  const { data: existing, error: lookupError } = await db
    .from('profiles')
    .select('id,is_anonymous')
    .eq('id', user.id)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const expectedAnonymous = isAnonymousAuthUser(user);
    const staleGuestName =
      Boolean(existing.is_anonymous) &&
      !expectedAnonymous &&
      String(window._currentProfile?.display_name || '')
        .trim()
        .toLowerCase() === 'guest';
    const repairedName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Traveller';
    if (pendingName || staleGuestName || Boolean(existing.is_anonymous) !== expectedAnonymous) {
      const { error } = await db
        .from('profiles')
        .update({
          ...(pendingName || staleGuestName ? { display_name: pendingName || repairedName } : {}),
          is_anonymous: expectedAnonymous,
        })
        .eq('id', user.id);
      if (error) throw error;
    }
    if (pendingPreferences) {
      const { error } = await db
        .from('profiles')
        .update({ ...pendingPreferences, preferences_initialized: true })
        .eq('id', user.id)
        .eq('preferences_initialized', false);
      if (error) throw error;
    }
  } else {
    const { error } = await db.from('profiles').insert({
      id: user.id,
      display_name: pendingName || fallbackName,
      is_anonymous: isAnonymousAuthUser(user),
      ...localProfilePreferences(),
      preferences_initialized: true,
    });
    if (error) throw error;
  }

  if (pendingName) {
    sessionStorage.removeItem('pending_display_name');
  }
  window._pendingProfilePreferenceMigration = null;

  // Always fetch and cache the current profile row
  const { data, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (data && window._currentUser?.id === user.id) {
    window._currentProfile = data;
    applyProfilePreferences(window._currentProfile);
    cacheProfile(user, data);
    if (user.email && user.email_confirmed_at) void requestWelcomeEmail();
  }
}

async function requestWelcomeEmail() {
  const token = window._tcAccessToken;
  if (!token || navigator.onLine === false) return;
  const endpoint = isNativeAuthRuntime() ? 'https://tripcash.de/api/welcome' : '/api/welcome';
  try {
    await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch (_) {
    /* Retried safely on the next authenticated launch. */
  }
}

function nativeOrWebAuthRedirect() {
  if (window.Capacitor?.isNativePlatform?.() || location.protocol === 'capacitor:') {
    return 'https://tripcash.de/auth-callback';
  }
  if (location.origin === 'https://tripcash.de') return 'https://tripcash.de/app';
  return undefined;
}

function showSignupConfirmationIfNeeded(user = window._currentUser) {
  if (signupConfirmationShownThisLoad) return false;
  const params = new URLSearchParams(location.search);
  if (!user?.email_confirmed_at) return false;

  // The production redirect allowlist may accept /app but not its ?intent=signup
  // variant. In that case, recognize a just-confirmed new account on the PKCE
  // callback rather than silently dropping the success message.
  const confirmedAt = Date.parse(user.email_confirmed_at);
  const createdAt = Date.parse(user.created_at);
  const now = Date.now();
  const freshSignupCallback =
    authCallbackHadCodeAtBoot &&
    Number.isFinite(confirmedAt) &&
    Number.isFinite(createdAt) &&
    confirmedAt >= createdAt &&
    now - confirmedAt >= 0 &&
    now - confirmedAt <= 10 * 60 * 1000 &&
    now - createdAt >= 0 &&
    now - createdAt <= 24 * 60 * 60 * 1000;
  if (params.get(AUTH_INTENT_PARAM) !== SIGNUP_CONFIRMATION_INTENT && !freshSignupCallback) return false;
  signupConfirmationShownThisLoad = true;

  params.delete(AUTH_INTENT_PARAM);
  params.delete('code');
  if (params.get('type') === SIGNUP_CONFIRMATION_INTENT) params.delete('type');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  setTimeout(() => openModal('modal-email-confirmed'), 0);
  return true;
}

function isStrongPassword(password) {
  return typeof password === 'string' && password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function userHasPasswordIdentity(user = window._currentUser) {
  const providers = user?.app_metadata?.providers;
  return Array.isArray(providers) ? providers.includes('email') : user?.app_metadata?.provider === 'email';
}

async function ensureAuthTurnstile(flow) {
  const containerId = `auth-turnstile-${flow}`;
  const container = document.getElementById(containerId);
  if (!container) return;
  if (isNativeAuthRuntime()) {
    if (nativeTurnstileWidgets.has(flow)) return;
    const action = authTurnstileActions[flow];
    if (!action) return;
    const channel = window.crypto?.randomUUID?.();
    if (!channel) {
      showToast('Secure bot protection is unavailable on this device.', 'error');
      return;
    }
    const frame = document.createElement('iframe');
    frame.className = 'native-turnstile-frame';
    frame.title = 'Bot protection';
    frame.referrerPolicy = 'no-referrer';
    frame.src = `${NATIVE_TURNSTILE_URL}?flow=${encodeURIComponent(flow)}&channel=${encodeURIComponent(channel)}`;
    const state = { channel, frame, token: '' };
    nativeTurnstileWidgets.set(flow, state);
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage(
        {
          source: 'tripcash-native-turnstile',
          type: 'init',
          flow,
          channel,
        },
        'https://tripcash.de',
      );
    });
    container.replaceChildren(frame);
    return;
  }
  if (authTurnstileWidgets.has(flow)) return;
  if (authTurnstilePromises.has(flow)) return authTurnstilePromises.get(flow);
  const pending = (async () => {
    try {
      await loadTurnstileApi();
      if (authTurnstileWidgets.has(flow)) return;
      const widgetId = window.turnstile.render(`#${containerId}`, {
        sitekey: TRIPCASH_TURNSTILE_SITE_KEY,
        action: authTurnstileActions[flow],
        theme: 'auto',
        callback: () => {
          failedAuthTurnstileFlows.delete(flow);
          setAuthTurnstileError(flow, '');
        },
        'error-callback': () => markAuthTurnstileFailed(flow),
        'unsupported-callback': () => markAuthTurnstileFailed(flow),
      });
      authTurnstileWidgets.set(flow, widgetId);
    } catch (_) {
      markAuthTurnstileFailed(flow);
    }
  })().finally(() => {
    authTurnstilePromises.delete(flow);
  });
  authTurnstilePromises.set(flow, pending);
  return pending;
}

// Blockers usually stop Turnstile silently, so say how to fix it. The note stays
// under the check (a toast is too brief to read), and Turnstile's automatic
// retries do not repeat it.
function markAuthTurnstileFailed(flow) {
  if (failedAuthTurnstileFlows.has(flow)) return;
  failedAuthTurnstileFlows.add(flow);
  setAuthTurnstileError(flow, TURNSTILE_BLOCKED_MESSAGE);
}

function setAuthTurnstileError(flow, message) {
  const container = document.getElementById(`auth-turnstile-${flow}`);
  if (!container) return;
  let error = container.querySelector('.auth-turnstile-error');
  if (!message) {
    error?.remove();
    return;
  }
  if (!error) {
    error = document.createElement('p');
    error.className = 'form-inline-error auth-turnstile-error';
    error.setAttribute('role', 'alert');
    container.append(error);
  }
  error.textContent = `⚠ ${message}`;
}

async function getAuthCaptchaToken(flow) {
  await ensureAuthTurnstile(flow);
  const nativeWidget = nativeTurnstileWidgets.get(flow);
  const widgetId = authTurnstileWidgets.get(flow);
  const token = isNativeAuthRuntime()
    ? nativeWidget?.token || ''
    : widgetId === undefined
      ? ''
      : window.turnstile?.getResponse(widgetId);
  if (!token) {
    showToast(
      failedAuthTurnstileFlows.has(flow)
        ? 'Bot protection couldn’t run. See the note on the form.'
        : 'Please complete the bot-protection check.',
      'error',
    );
  }
  return token || '';
}

function resetAuthTurnstile(flow) {
  const nativeWidget = nativeTurnstileWidgets.get(flow);
  if (nativeWidget) {
    nativeTurnstileWidgets.delete(flow);
    nativeWidget.frame.remove();
    void ensureAuthTurnstile(flow);
    return;
  }
  const widgetId = authTurnstileWidgets.get(flow);
  if (widgetId !== undefined) window.turnstile?.reset(widgetId);
}

// Keep authentication feedback beside the field that needs attention. This is
// deliberately client-only: authentication responses remain handled below so
// we do not change the existing non-enumerating server behaviour.
const authInlineValidators = new Map();

function attachAuthInlineValidation(formId, fieldIds, messageFor) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.noValidate = true;
  const touched = new Set();
  const fields = new Map();

  for (const id of fieldIds) {
    const input = document.getElementById(id);
    const group = input?.type === 'checkbox' ? input.closest('.terms-check') : input?.closest('.form-group');
    if (!input || !group) continue;
    const error = document.createElement('p');
    error.id = `${id}-error`;
    error.className = 'form-inline-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    group.append(error);
    input.setAttribute(
      'aria-describedby',
      [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '),
    );
    fields.set(id, { input, group, error });
  }

  function render(id) {
    const field = fields.get(id);
    if (!field) return '';
    const message = messageFor(id);
    const shown = touched.has(id) && !!message;
    field.error.textContent = shown ? `⚠ ${message}` : '';
    field.error.hidden = !shown;
    field.group.classList.toggle('has-error', shown);
    field.input.setAttribute('aria-invalid', String(shown));
    return message;
  }

  form.addEventListener('focusout', event => {
    if (!fields.has(event.target.id)) return;
    const id = event.target.id;
    // Let the pending tap/click finish before an error changes the form height.
    // Otherwise a newly wrapped message can move the intended target away
    // between pointer-down and click, especially on a phone.
    setTimeout(() => {
      // Empty fields are flagged on submit, not on leaving them: password
      // managers often fill a field after focus moves on, without an input event.
      const input = fields.get(id).input;
      if (!touched.has(id) && input.type !== 'checkbox' && !input.value.trim()) return;
      touched.add(id);
      render(id);
    }, 0);
  });
  // Browser autofill starts this CSS animation; re-check so stale errors clear.
  form.addEventListener('animationstart', event => {
    if (event.animationName === 'tc-autofill' && touched.has(event.target.id)) render(event.target.id);
  });
  form.addEventListener('input', event => {
    if (touched.has(event.target.id)) render(event.target.id);
    const dependent =
      event.target.id === 'reg-pass'
        ? 'reg-pass-confirm'
        : event.target.id === 'new-password'
          ? 'new-password-confirm'
          : '';
    if (dependent && touched.has(dependent)) render(dependent);
  });
  form.addEventListener('change', event => {
    if (touched.has(event.target.id)) render(event.target.id);
  });
  authInlineValidators.set(formId, {
    validateAll() {
      fieldIds.forEach(id => touched.add(id));
      const invalid = fieldIds.find(id => render(id));
      if (invalid) fields.get(invalid)?.input.focus();
      return !invalid;
    },
    clear() {
      touched.clear();
      fieldIds.forEach(render);
    },
  });
}

function authFieldMessage(id) {
  const input = document.getElementById(id);
  const value = input?.value.trim() || '';
  if (id.endsWith('email') || id === 'forgot-email') {
    return !value ? 'Enter your email address.' : input.validity.valid ? '' : 'Enter a valid email address.';
  }
  if (id === 'login-pass') return value ? '' : 'Enter your password.';
  if (id === 'reg-name') return value ? '' : 'Enter your name.';
  if (id === 'reg-pass' || id === 'new-password')
    return isStrongPassword(value) ? '' : 'Use 8+ characters with a letter and number.';
  if (id === 'reg-pass-confirm')
    return value === document.getElementById('reg-pass')?.value ? '' : 'Passwords do not match.';
  if (id === 'new-password-confirm')
    return value === document.getElementById('new-password')?.value ? '' : 'Passwords do not match.';
  if (id === 'current-password') {
    return document.getElementById('modal-new-password')?.dataset.passwordMode === 'change' && !value
      ? 'Enter your current password.'
      : '';
  }
  if (id === 'reg-terms')
    return input.checked ? '' : 'Confirm that you are at least 16 and accept the Terms and Privacy Policy.';
  return '';
}

// ── Login ─────────────────────────────────────────────────────
let loginPending = false;
async function handleLogin(e) {
  e.preventDefault();
  if (loginPending) return;
  if (authInlineValidators.get('form-login')?.validateAll() === false) return;
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) return;
  loginPending = true;
  setLoading('btn-login', true);
  try {
    const captchaToken = await getAuthCaptchaToken('login');
    if (!captchaToken) return;
    const { error } = await db.auth.signInWithPassword({ email, password: pass, options: { captchaToken } });
    resetAuthTurnstile('login');
    if (error) showToast(friendlyAuthError(error.message), 'error');
  } catch (_) {
    showToast('Could not log in right now. Please try again.', 'error');
  } finally {
    loginPending = false;
    setLoading('btn-login', false);
  }
}

const LOGIN_CODE_RESEND_SECONDS = 60;
let loginCodeRequestPending = false;
let loginCodeVerifyPending = false;
let loginCodeCountdownTimer = null;

function normalizeLoginCode(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

function renderLoginCode(value = document.getElementById('login-code')?.value) {
  const input = document.getElementById('login-code');
  const digits = normalizeLoginCode(value);
  if (input) input.value = digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
  document.querySelectorAll('.login-code-boxes span').forEach((box, index) => {
    box.textContent = digits[index] || '';
    box.classList.toggle('filled', index < digits.length);
  });
  return digits;
}

function setLoginCodeError(message = '') {
  const error = document.getElementById('login-code-error');
  const control = document.querySelector('.auth-code-control');
  if (!error) return;
  error.textContent = message ? `⚠ ${message}` : '';
  error.hidden = !message;
  control?.classList.toggle('has-error', Boolean(message));
  document.getElementById('login-code')?.setAttribute('aria-invalid', String(Boolean(message)));
}

function clearLoginCodeCountdown() {
  if (loginCodeCountdownTimer) clearInterval(loginCodeCountdownTimer);
  loginCodeCountdownTimer = null;
}

function startLoginCodeCountdown() {
  clearLoginCodeCountdown();
  const countdown = document.getElementById('login-code-countdown');
  const resend = document.getElementById('btn-resend-login-code');
  const turnstile = document.getElementById('auth-turnstile-login');
  let remaining = LOGIN_CODE_RESEND_SECONDS;
  if (countdown) {
    countdown.hidden = false;
    countdown.textContent = `Resend in ${remaining} seconds`;
  }
  if (resend) resend.hidden = true;
  if (turnstile) turnstile.hidden = true;
  loginCodeCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      if (countdown) countdown.textContent = `Resend in ${remaining} seconds`;
      return;
    }
    clearLoginCodeCountdown();
    if (countdown) countdown.hidden = true;
    if (resend) {
      resend.hidden = false;
      if (turnstile) resend.before(turnstile);
    }
    if (turnstile) turnstile.hidden = false;
  }, 1000);
}

function showLoginCodeEntry(email, resent = false) {
  const requestForm = document.getElementById('form-login-code-request');
  const verifyForm = document.getElementById('form-login-code-verify');
  const resend = document.getElementById('login-code-resend');
  const status = document.getElementById('login-code-request-status');
  if (requestForm) requestForm.hidden = true;
  if (verifyForm) verifyForm.hidden = false;
  if (resend) resend.hidden = false;
  if (status) {
    status.textContent = `${resent ? 'A new email is' : 'An email is'} on the way to ${email}. Enter its six-digit code or use its login link.`;
    status.hidden = false;
  }
  setLoginCodeError();
  renderLoginCode('');
  startLoginCodeCountdown();
  document.getElementById('login-code')?.focus();
}

function resetLoginCodeEntry() {
  clearLoginCodeCountdown();
  const requestForm = document.getElementById('form-login-code-request');
  const verifyForm = document.getElementById('form-login-code-verify');
  const resend = document.getElementById('login-code-resend');
  const status = document.getElementById('login-code-request-status');
  if (requestForm) requestForm.hidden = false;
  if (verifyForm) verifyForm.hidden = true;
  if (resend) resend.hidden = true;
  if (status) status.hidden = true;
  setLoginCodeError();
  renderLoginCode('');
}

async function requestLoginCode(buttonId, resent = false) {
  if (loginCodeRequestPending) return;
  const email = document.getElementById('login-email')?.value.trim();
  if (!email) {
    switchAuthTab('login');
    document.getElementById('login-email')?.focus();
    return;
  }
  loginCodeRequestPending = true;
  setLoading(buttonId, true);
  try {
    const captchaToken = await getAuthCaptchaToken('login');
    if (!captchaToken) return;
    const emailRedirectTo = nativeOrWebAuthRedirect();
    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        captchaToken,
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
    resetAuthTurnstile('login');
    if (
      error &&
      !/user.*not found|email.*not found|not registered/i.test(`${error.code || ''} ${error.message || ''}`)
    ) {
      showToast(friendlyAuthError(error), 'error');
      return;
    }
    showLoginCodeEntry(email, resent);
  } catch (_) {
    showToast('Could not send the login email right now. Please try again.', 'error');
  } finally {
    loginCodeRequestPending = false;
    setLoading(buttonId, false);
  }
}

function handleLoginCodeRequest(event) {
  event.preventDefault();
  return requestLoginCode('btn-send-login-code');
}

function handleLoginCodeResend() {
  return requestLoginCode('btn-resend-login-code', true);
}

function friendlyLoginCodeError(error) {
  const message = `${error?.code || ''} ${error?.message || error || ''}`.toLowerCase();
  if (message.includes('expired')) return 'This code is invalid or expired. Request a new code.';
  if (message.includes('rate') || message.includes('too many'))
    return 'Too many attempts. Wait a minute and try again.';
  if (message.includes('invalid') || message.includes('token'))
    return 'That code is incorrect. Check the email and try again.';
  return 'Could not verify this code. Please try again.';
}

async function handleLoginCodeVerify(event) {
  event.preventDefault();
  if (loginCodeVerifyPending) return;
  const email = document.getElementById('login-email')?.value.trim();
  const token = renderLoginCode();
  if (token.length !== 6) {
    setLoginCodeError('Enter all six digits.');
    document.getElementById('login-code')?.focus();
    return;
  }
  loginCodeVerifyPending = true;
  setLoading('btn-verify-login-code', true);
  setLoginCodeError();
  try {
    const { data, error } = await db.auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data?.session) {
      setLoginCodeError(friendlyLoginCodeError(error));
      return;
    }
    clearLoginCodeCountdown();
  } catch (_) {
    setLoginCodeError('Could not verify this code. Please try again.');
  } finally {
    loginCodeVerifyPending = false;
    setLoading('btn-verify-login-code', false);
  }
}

// ── Register ──────────────────────────────────────────────────
let pendingSignupEmail = '';
let registerCodeCountdownTimer = null;
let registerCodeVerifyPending = false;
let registerCodeResendPending = false;

function renderRegisterCode(value = document.getElementById('register-code')?.value) {
  const input = document.getElementById('register-code');
  const digits = normalizeLoginCode(value);
  if (input) input.value = digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
  document.querySelectorAll('.signup-code-boxes span').forEach((box, index) => {
    box.textContent = digits[index] || '';
    box.classList.toggle('filled', index < digits.length);
  });
  return digits;
}

function setRegisterCodeError(message = '') {
  const error = document.getElementById('register-code-error');
  const control = document.getElementById('register-code')?.closest('.auth-code-control');
  if (!error) return;
  error.textContent = message ? `⚠ ${message}` : '';
  error.hidden = !message;
  control?.classList.toggle('has-error', Boolean(message));
  document.getElementById('register-code')?.setAttribute('aria-invalid', String(Boolean(message)));
}

function clearRegisterCodeCountdown() {
  if (registerCodeCountdownTimer) clearInterval(registerCodeCountdownTimer);
  registerCodeCountdownTimer = null;
}

function startRegisterCodeCountdown() {
  clearRegisterCodeCountdown();
  const countdown = document.getElementById('register-code-countdown');
  const resend = document.getElementById('btn-resend-register-code');
  const turnstile = document.getElementById('auth-turnstile-register');
  let remaining = LOGIN_CODE_RESEND_SECONDS;
  if (countdown) {
    countdown.hidden = false;
    countdown.textContent = `Resend in ${remaining} seconds`;
  }
  if (resend) resend.hidden = true;
  if (turnstile) turnstile.hidden = true;
  registerCodeCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      if (countdown) countdown.textContent = `Resend in ${remaining} seconds`;
      return;
    }
    clearRegisterCodeCountdown();
    if (countdown) countdown.hidden = true;
    if (resend) {
      resend.hidden = false;
      if (turnstile) resend.before(turnstile);
    }
    if (turnstile) turnstile.hidden = false;
  }, 1000);
}

function showRegistrationConfirmation(email) {
  pendingSignupEmail = email;
  const feedback = document.getElementById('register-feedback');
  const form = document.getElementById('form-register');
  const confirmation = document.getElementById('register-confirmation');
  const preview = document.getElementById('register-code-email-preview');
  if (feedback) feedback.hidden = true;
  if (form) form.hidden = true;
  if (confirmation) confirmation.hidden = false;
  if (preview) preview.textContent = email;
  setRegisterCodeError();
  renderRegisterCode('');
  startRegisterCodeCountdown();
  document.getElementById('register-code')?.focus();
}

async function handleRegisterCodeVerify(event) {
  event.preventDefault();
  if (registerCodeVerifyPending) return;
  const token = renderRegisterCode();
  if (token.length !== 6) {
    setRegisterCodeError('Enter all six digits.');
    document.getElementById('register-code')?.focus();
    return;
  }
  registerCodeVerifyPending = true;
  setLoading('btn-verify-register-code', true);
  setRegisterCodeError();
  try {
    const { data, error } = await db.auth.verifyOtp({ email: pendingSignupEmail, token, type: 'signup' });
    if (error || !data?.session) {
      setRegisterCodeError(friendlyLoginCodeError(error));
      return;
    }
    clearRegisterCodeCountdown();
  } catch (_) {
    setRegisterCodeError('Could not verify this code. Please try again.');
  } finally {
    registerCodeVerifyPending = false;
    setLoading('btn-verify-register-code', false);
  }
}

async function handleRegisterCodeResend() {
  if (registerCodeResendPending || !pendingSignupEmail) return;
  registerCodeResendPending = true;
  setLoading('btn-resend-register-code', true);
  try {
    const captchaToken = await getAuthCaptchaToken('register');
    if (!captchaToken) return;
    const emailRedirectTo = nativeOrWebAuthRedirect();
    const { error } = await db.auth.resend({
      type: 'signup',
      email: pendingSignupEmail,
      options: {
        captchaToken,
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
    resetAuthTurnstile('register');
    if (error) {
      showToast(friendlyAuthError(error), 'error');
      return;
    }
    renderRegisterCode('');
    setRegisterCodeError();
    startRegisterCodeCountdown();
    showToast('A new confirmation email is on the way.');
  } catch (_) {
    showToast('Could not resend the confirmation email right now. Please try again.', 'error');
  } finally {
    registerCodeResendPending = false;
    setLoading('btn-resend-register-code', false);
  }
}

function setRegistrationStatus(message = '', tone = 'success', { completed = false } = {}) {
  const feedback = document.getElementById('register-feedback');
  const status = document.getElementById('register-status');
  const title = document.getElementById('register-feedback-title');
  const actions = document.getElementById('register-feedback-actions');
  const form = document.getElementById('form-register');
  if (!feedback || !status) return;
  status.textContent = message;
  feedback.dataset.tone = tone;
  feedback.hidden = !message;
  if (title) title.textContent = tone === 'error' ? 'Signup needs attention' : 'Check your inbox or sign in';
  if (actions) actions.hidden = !completed;
  if (form) form.hidden = completed;
  if (message)
    requestAnimationFrame(() => {
      feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
      feedback.focus({ preventScroll: true });
    });
}

function resetRegistrationForm() {
  clearRegisterCodeCountdown();
  pendingSignupEmail = '';
  setRegistrationStatus();
  const form = document.getElementById('form-register');
  const confirmation = document.getElementById('register-confirmation');
  const turnstile = document.getElementById('auth-turnstile-register');
  const submit = document.getElementById('btn-register');
  form?.reset();
  if (form) form.hidden = false;
  if (confirmation) confirmation.hidden = true;
  if (turnstile && submit) {
    submit.before(turnstile);
    turnstile.hidden = false;
  }
  setRegisterCodeError();
  renderRegisterCode('');
  authInlineValidators.get('form-register')?.clear();
  document.getElementById('reg-email')?.focus();
}

function friendlyRegistrationError(error) {
  const message = friendlyAuthError(error);
  if (
    message === 'Authentication failed. Please try again.' ||
    message === 'Unable to use this email. Try logging in or resetting the password.'
  ) {
    return 'This email may already have an account or be awaiting confirmation. Check your inbox, sign in, or reset your password.';
  }
  return message;
}

let registrationPending = false;
async function handleRegister(e) {
  e.preventDefault();
  if (registrationPending) return;
  setRegistrationStatus();
  if (authInlineValidators.get('form-register')?.validateAll() === false) return;
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const confirm = document.getElementById('reg-pass-confirm').value;
  const terms = document.getElementById('reg-terms').checked;

  if (!name || !email || !isStrongPassword(pass) || confirm !== pass || !terms) return;
  registrationPending = true;
  setLoading('btn-register', true);
  try {
    const captchaToken = await getAuthCaptchaToken('register');
    if (!captchaToken) return;
    sessionStorage.setItem('pending_display_name', name);
    // Use the exact production allowlisted URL. The confirmation callback is
    // recognized from its PKCE code and fresh user timestamps instead of a
    // query parameter that Supabase may discard when checking redirect URLs.
    const emailRedirectTo = nativeOrWebAuthRedirect();
    const { data, error } = await db.auth.signUp({
      email,
      password: pass,
      options: {
        data: { display_name: name },
        captchaToken,
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
    resetAuthTurnstile('register');
    if (error) {
      sessionStorage.removeItem('pending_display_name');
      const message = friendlyRegistrationError(error);
      setRegistrationStatus(message, 'error');
      showToast(message, 'error');
    } else if (!data?.session) {
      document.getElementById('login-email').value = email;
      document.getElementById('form-register')?.reset();
      showRegistrationConfirmation(email);
      showToast('Check your inbox for the confirmation code.');
    }
  } catch (_) {
    sessionStorage.removeItem('pending_display_name');
    const message = 'Could not create the account right now. Please try again.';
    setRegistrationStatus(message, 'error');
    showToast(message, 'error');
  } finally {
    registrationPending = false;
    setLoading('btn-register', false);
  }
}

// ── Guest mode (Supabase anonymous auth) ──────────────────────
let guestStartPending = false;
async function handleGuestStart() {
  if (guestStartPending) return;
  const nameEl = document.getElementById('guest-name');
  const name = nameEl.value.trim();
  if (!name) {
    shake(nameEl);
    return;
  }
  guestStartPending = true;
  setLoading('btn-guest', true);
  try {
    const captchaToken = await getAuthCaptchaToken('guest');
    if (!captchaToken) return;
    sessionStorage.setItem('pending_display_name', name);
    const { data, error } = await db.auth.signInAnonymously({ options: { captchaToken } });
    resetAuthTurnstile('guest');
    if (error) {
      sessionStorage.removeItem('pending_display_name');
      const msg = error.message.includes('not enabled')
        ? 'Guest access is unavailable right now. Please create an account instead.'
        : friendlyAuthError(error.message);
      showToast(msg, 'error');
      return;
    }
    if (data?.user) {
      cacheProfile(data.user, {
        id: data.user.id,
        display_name: name,
        is_anonymous: true,
      });
    }
  } catch (_) {
    sessionStorage.removeItem('pending_display_name');
    showToast('Could not start guest access right now. Please try again.', 'error');
  } finally {
    guestStartPending = false;
    setLoading('btn-guest', false);
  }
}

// ── Upgrade guest account to real account ─────────────────────
async function handleGuestUpgrade(e) {
  e.preventDefault();
  const name = document.getElementById('upgrade-name').value.trim();
  const email = document.getElementById('upgrade-email').value.trim();

  if (!name) {
    shake(document.getElementById('upgrade-name'));
    return;
  }
  if (!email) {
    shake(document.getElementById('upgrade-email'));
    return;
  }

  setLoading('btn-upgrade', true);
  // Supabase requires an anonymous user to verify the linked email before a
  // password can be added. The UUID stays the same, preserving guest trips.
  const emailRedirectTo = nativeOrWebAuthRedirect();
  const { error } = await db.auth.updateUser(
    {
      email,
      data: { display_name: name, guest_upgrade_pending: true },
    },
    emailRedirectTo ? { emailRedirectTo } : undefined,
  );
  setLoading('btn-upgrade', false);

  if (error) {
    showToast('Unable to use this address. If you already have an account, log in or reset its password.', 'error');
    return;
  }

  // Keep the profile anonymous until the email callback is complete and the
  // user has chosen a password.
  if (window._currentUser) {
    await db.from('profiles').update({ display_name: name }).eq('id', window._currentUser.id);
    if (window._currentProfile) {
      window._currentProfile.display_name = name;
      cacheProfile(window._currentUser, window._currentProfile);
    }
  }

  closeModal('modal-guest-upgrade');
  showToast('Check your email to verify it, then choose your password.');
}

// ── Logout ────────────────────────────────────────────────────
async function handleLogout() {
  const userId = window._currentUser?.id;
  const pendingChanges = window.TripCashOffline?.pendingCount(userId) || 0;
  const isGuest = isAnonymousAuthUser(window._currentUser);
  const confirmed = await appConfirm({
    title: pendingChanges ? 'Discard offline changes?' : isGuest ? 'Leave guest session?' : 'Log out?',
    message: pendingChanges
      ? `Signing out will discard ${pendingChanges} unsynced change${pendingChanges === 1 ? '' : 's'} from this device.`
      : isGuest
        ? 'Guest trips cannot be recovered after signing out unless you save the account first.'
        : 'Are you sure you want to log out?',
    okText: pendingChanges || isGuest ? 'Sign out anyway' : 'Log out',
    danger: true,
  });
  if (!confirmed) return;
  const { error } = await db.auth.signOut();
  if (!error) {
    window.TripCashOffline?.clearUser();
    window.TripCashOffline?.clearQueue(userId);
    clearUserTripCaches(userId);
    localStorage.removeItem(`${PROFILE_CACHE_PREFIX}${userId}`);
  }
}

// ── Password recovery ─────────────────────────────────────────
function openForgotPassword() {
  const email = document.getElementById('login-email')?.value.trim();
  const input = document.getElementById('forgot-email');
  if (input) input.value = email || '';
  authInlineValidators.get('form-forgot-password')?.clear();
  openModal('modal-forgot-password');
  void ensureAuthTurnstile('recovery');
  input?.focus();
}

let passwordResetPending = false;
async function handleForgotPassword(e) {
  e.preventDefault();
  if (passwordResetPending) return;
  if (authInlineValidators.get('form-forgot-password')?.validateAll() === false) return;
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return;
  passwordResetPending = true;
  setLoading('btn-forgot-password', true);
  try {
    const captchaToken = await getAuthCaptchaToken('recovery');
    if (!captchaToken) return;
    const redirectTo = nativeOrWebAuthRedirect();
    const options = { captchaToken, ...(redirectTo ? { redirectTo } : {}) };
    const { error } = await db.auth.resetPasswordForEmail(email, options);
    resetAuthTurnstile('recovery');
    if (error) {
      const detail = `${error.code || ''} ${error.message || ''}`.toLowerCase();
      if (/user.*not found|email.*not found|unknown email|not registered|no user/.test(detail)) {
        closeModal('modal-forgot-password');
        showToast('If an account exists for this email, we sent a reset link.');
        return;
      }
      showToast(
        error.message?.toLowerCase().includes('rate limit')
          ? 'Too many reset requests. Please wait a minute and try again.'
          : 'Could not send a reset link right now. Please try again later.',
        'error',
      );
      return;
    }
    closeModal('modal-forgot-password');
    showToast('If an account exists for this email, we sent a reset link.');
  } catch (_) {
    showToast('Could not send a reset link right now. Please try again later.', 'error');
  } finally {
    passwordResetPending = false;
    setLoading('btn-forgot-password', false);
  }
}

async function handleNewPassword(e) {
  e.preventDefault();
  const mode = document.getElementById('modal-new-password')?.dataset.passwordMode;
  const passwordValidator = authInlineValidators.get('form-new-password');
  if (passwordValidator?.validateAll() === false) return;
  const currentPassword = document.getElementById('current-password')?.value || '';
  const password = document.getElementById('new-password').value;
  const confirmation = document.getElementById('new-password-confirm').value;

  if ((mode === 'change' && !currentPassword) || !isStrongPassword(password) || password !== confirmation) return;

  if (mode === 'change') {
    const captchaToken = await getAuthCaptchaToken('reauth');
    if (!captchaToken) return;
    setLoading('btn-new-password', true);
    const reauth = await db.auth.signInWithPassword({
      email: window._currentUser?.email || '',
      password: currentPassword,
      options: { captchaToken },
    });
    resetAuthTurnstile('reauth');
    if (reauth.error) {
      setLoading('btn-new-password', false);
      showToast('Current password is incorrect.', 'error');
      return;
    }
  }

  const completingGuestUpgrade = Boolean(window._currentUser?.user_metadata?.guest_upgrade_pending);
  const completingRecovery = passwordRecoveryPending();
  if (completingRecovery) setPasswordRecoveryPending(false);
  setLoading('btn-new-password', true);
  const { error } = await db.auth.updateUser(
    completingGuestUpgrade
      ? {
          password,
          data: {
            ...window._currentUser.user_metadata,
            guest_upgrade_pending: false,
          },
        }
      : mode === 'change'
        ? { password }
        : { password },
  );
  setLoading('btn-new-password', false);

  if (error) {
    if (completingRecovery) setPasswordRecoveryPending(true);
    showToast(friendlyAuthError(error.message), 'error');
    return;
  }

  document.getElementById('form-new-password').reset();
  const cancel = document.getElementById('btn-cancel-password-recovery');
  if (cancel) cancel.hidden = true;
  const close = document.getElementById('btn-close-new-password');
  if (close) close.hidden = true;
  closeModal('modal-new-password');
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  if (completingGuestUpgrade && window._currentUser) {
    await db.from('profiles').update({ is_anonymous: false }).eq('id', window._currentUser.id);
    if (window._currentProfile) window._currentProfile.is_anonymous = false;
    document.getElementById('guest-banner')?.remove();
    showToast('Account saved! Welcome to TripCash.');
  } else {
    showToast('Password updated.');
  }
  if (completingRecovery) onUserReady();
}

function openChangePassword() {
  if (!window._currentUser?.email || !userHasPasswordIdentity()) {
    showToast('Password changes are available only for email-and-password accounts.', 'error');
    return;
  }
  closeModal('modal-account');
  configureNewPasswordModal('change');
  openModal('modal-new-password');
  void ensureAuthTurnstile('reauth');
  document.getElementById('current-password')?.focus();
}

async function cancelPasswordRecovery() {
  if (!passwordRecoveryPending()) return;
  const userId = window._currentUser?.id;
  const button = document.getElementById('btn-cancel-password-recovery');
  if (button) button.disabled = true;
  setPasswordRecoveryPending(false);
  if (button) button.hidden = true;
  closeModal('modal-new-password');
  await db.auth.signOut();
  window.TripCashOffline?.clearUser();
  window.TripCashOffline?.clearQueue(userId);
  clearUserTripCaches(userId);
  localStorage.removeItem(`${PROFILE_CACHE_PREFIX}${userId}`);
  if (button) button.disabled = false;
  openAuthMode('login');
}

function handleLoginEmailContinue(event) {
  event?.preventDefault();
  if (authInlineValidators.get('form-login-email')?.validateAll() === false) return;
  switchAuthTab('login-password');
  document.getElementById('login-pass')?.focus();
}

// ── Auth screen switching ─────────────────────────────────────
function switchAuthTab(tab) {
  const mode = ['login', 'login-password', 'login-code', 'register', 'guest'].includes(tab) ? tab : 'login';
  const screen = document.getElementById('screen-auth');
  const previous = screen?.dataset.authMode || 'login';
  if (mode === 'login' && previous === 'login-code') resetLoginCodeEntry();
  if (
    previous !== mode &&
    ['login', 'login-password', 'register'].includes(previous) &&
    ['login', 'login-password', 'register'].includes(mode)
  ) {
    const source = document.getElementById(previous === 'register' ? 'reg-email' : 'login-email');
    const destination = document.getElementById(mode === 'register' ? 'reg-email' : 'login-email');
    if (source?.value.trim() && destination && source !== destination) destination.value = source.value;
  }
  if (screen) screen.dataset.authMode = mode;
  document.getElementById('auth-login-start').hidden = mode !== 'login';
  document.getElementById('auth-login').hidden = mode !== 'login-password';
  document.getElementById('auth-login-code').hidden = mode !== 'login-code';
  document.getElementById('auth-register').hidden = mode !== 'register';
  document.getElementById('auth-guest').hidden = mode !== 'guest';
  const email = document.getElementById('login-email')?.value.trim();
  const preview = document.getElementById('login-email-preview');
  if (preview) preview.textContent = email || '';
  const codePreview = document.getElementById('login-code-email-preview');
  if (codePreview) codePreview.textContent = email || '';
  const turnstile = document.getElementById('auth-turnstile-login');
  const targetButton = document.getElementById(mode === 'login-code' ? 'btn-send-login-code' : 'btn-login');
  if (turnstile && targetButton && ['login-password', 'login-code'].includes(mode)) {
    targetButton.before(turnstile);
    turnstile.hidden = false;
  }
  updateSocialLoginVisibility();
}

function warmAuthTurnstileFromInteraction(event) {
  const flow = event.target?.closest?.('#form-login, #form-login-email, #form-login-code-request')
    ? 'login'
    : event.target?.closest?.('#form-register, #register-confirmation')
      ? 'register'
      : event.target?.closest?.('#auth-guest')
        ? 'guest'
        : '';
  if (flow) void ensureAuthTurnstile(flow);
}

function togglePasswordVisibility(button) {
  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  button.setAttribute('aria-pressed', String(visible));
  input.focus({ preventScroll: true });
}

function friendlyAuthError(error) {
  const msg = typeof error === 'string' ? error : `${error?.code || ''} ${error?.message || ''}`;
  if (!msg.trim()) return 'Something went wrong.';
  const normalized = msg.toLowerCase();
  if (normalized.includes('current password')) return 'Current password is incorrect.';
  if (normalized.includes('different from the old password'))
    return 'Choose a password different from your current password.';
  if (normalized.includes('invalid login credentials'))
    return 'That email or password is not right. Try again or reset your password.';
  if (normalized.includes('email not confirmed')) return 'Please confirm your email first.';
  if (
    normalized.includes('email_exists') ||
    normalized.includes('already registered') ||
    normalized.includes('already exists')
  ) {
    return 'Unable to use this email. Try logging in or resetting the password.';
  }
  if (normalized.includes('password should be')) return 'Use 8+ characters with a letter and number.';
  if (normalized.includes('rate limit')) return 'Too many email requests. Please wait a minute and try again.';
  if (normalized.includes('manual linking')) return 'Account linking is not enabled. Please contact support.';
  return 'Authentication failed. Please try again.';
}

// ── DOM ready ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  arrangeAuthEntry();
  void loadSocialProviders();
  // Keep the initial auth screen fast. The reserved container prevents layout
  // shift, while the challenge starts warming as soon as the user interacts.
  document.addEventListener('focusin', warmAuthTurnstileFromInteraction);
  document.addEventListener('pointerdown', warmAuthTurnstileFromInteraction);
  attachAuthInlineValidation('form-login-email', ['login-email'], authFieldMessage);
  attachAuthInlineValidation('form-login', ['login-pass'], authFieldMessage);
  attachAuthInlineValidation(
    'form-register',
    ['reg-name', 'reg-email', 'reg-pass', 'reg-pass-confirm', 'reg-terms'],
    authFieldMessage,
  );
  attachAuthInlineValidation('form-forgot-password', ['forgot-email'], authFieldMessage);
  attachAuthInlineValidation(
    'form-new-password',
    ['current-password', 'new-password', 'new-password-confirm'],
    authFieldMessage,
  );
  document
    .querySelectorAll('[data-password-toggle]')
    .forEach(button => button.addEventListener('click', () => togglePasswordVisibility(button)));
  document.querySelectorAll('[data-auth-switch]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      switchAuthTab(link.dataset.authSwitch);
    });
  });
  for (const [from, to] of [
    ['reg-name', 'reg-email'],
    ['reg-email', 'reg-pass'],
    ['reg-pass', 'reg-pass-confirm'],
  ]) {
    document.getElementById(from)?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      document.getElementById(to)?.focus();
    });
  }
  document.getElementById('form-login-email')?.addEventListener('submit', handleLoginEmailContinue);
  document.getElementById('form-login')?.addEventListener('submit', handleLogin);
  document.getElementById('form-login-code-request')?.addEventListener('submit', handleLoginCodeRequest);
  document.getElementById('form-login-code-verify')?.addEventListener('submit', handleLoginCodeVerify);
  document.getElementById('btn-resend-login-code')?.addEventListener('click', handleLoginCodeResend);
  document.getElementById('login-code')?.addEventListener('input', event => {
    renderLoginCode(event.target.value);
    setLoginCodeError();
  });
  document.getElementById('form-register-code-verify')?.addEventListener('submit', handleRegisterCodeVerify);
  document.getElementById('btn-resend-register-code')?.addEventListener('click', handleRegisterCodeResend);
  document.getElementById('register-code')?.addEventListener('input', event => {
    renderRegisterCode(event.target.value);
    setRegisterCodeError();
  });
  document.getElementById('form-register')?.addEventListener('submit', handleRegister);
  document.getElementById('form-guest-upgrade')?.addEventListener('submit', handleGuestUpgrade);
  document.getElementById('form-forgot-password')?.addEventListener('submit', handleForgotPassword);
  document.getElementById('form-new-password')?.addEventListener('submit', handleNewPassword);
});
