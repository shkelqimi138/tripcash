// admin.js — TripCash admin panel with its own sign-in, separate from the app

const ADMIN_IDLE_LIMIT_MS = 15 * 60 * 1000;
const ADMIN_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll'];
let adminIdleTimer = null;
let adminTurnstileWidget;
let adminTurnstileApiPromise;
let adminLoginPending = false;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-logout')?.addEventListener('click', () => {
    void signOutAdmin();
  });
  // Capture phase also sees scrolls inside admin tables, which do not bubble.
  ADMIN_ACTIVITY_EVENTS.forEach(type =>
    document.addEventListener(type, resetAdminIdleTimer, { capture: true, passive: true }),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resetAdminIdleTimer();
  });
  void startAdmin();
});

async function startAdmin(notice = '') {
  let session;
  try {
    ({
      data: { session },
    } = await db.auth.getSession());
  } catch (_) {
    showAdminError('Unable to verify this session.');
    return;
  }

  if (!session) {
    renderAdminLogin(notice);
    return;
  }
  setAdminSignedIn(true);

  let profileResult;
  try {
    profileResult = await db.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle();
  } catch (_) {
    showAdminError('Unable to verify administrator access.');
    return;
  }
  const { data: profile, error: profileError } = profileResult;
  if (profileError || !profile?.is_admin) {
    // Never leave a non-admin session signed in on the admin page.
    await signOutAdmin('This account does not have admin access.');
    return;
  }

  const aal = await db.auth.mfa.getAuthenticatorAssuranceLevel().catch(() => ({ error: true }));
  if (aal.error || aal.data?.currentLevel !== 'aal2') {
    await showAdminMfaGate();
    return;
  }

  loadAdmin();
}

function setAdminSignedIn(signedIn) {
  const logout = document.getElementById('admin-logout');
  if (logout) logout.hidden = !signedIn;
  clearTimeout(adminIdleTimer);
  adminIdleTimer = signedIn ? setTimeout(expireAdminSession, ADMIN_IDLE_LIMIT_MS) : null;
}

function resetAdminIdleTimer() {
  if (adminIdleTimer === null) return;
  clearTimeout(adminIdleTimer);
  adminIdleTimer = setTimeout(expireAdminSession, ADMIN_IDLE_LIMIT_MS);
}

function expireAdminSession() {
  void signOutAdmin('You were signed out after 15 minutes without activity.');
}

async function signOutAdmin(message = '') {
  setAdminSignedIn(false);
  // Local scope ends only this admin tab's session, never the app's.
  await db.auth.signOut({ scope: 'local' }).catch(() => null);
  renderAdminLogin(message);
}

function renderAdminLogin(message = '') {
  setAdminSignedIn(false);
  const loading = document.getElementById('admin-loading');
  if (loading) loading.hidden = true;
  if (adminTurnstileWidget !== undefined) window.turnstile?.remove(adminTurnstileWidget);
  adminTurnstileWidget = undefined;
  document.getElementById('admin-body').innerHTML = `
    <section class="card admin-mfa-card admin-login-card">
      <h2>Admin sign-in</h2>
      <p>Use the TripCash administrator account. This sign-in is separate from the app.</p>
      <p id="admin-login-message" class="admin-notice" hidden></p>
      <form id="admin-login-form" novalidate>
        <label for="admin-login-email">Email</label>
        <input id="admin-login-email" type="email" autocomplete="username" maxlength="254" required />
        <label for="admin-login-password">Password</label>
        <input id="admin-login-password" type="password" autocomplete="current-password" required />
        <div id="admin-turnstile" class="admin-turnstile"></div>
        <button id="admin-login-submit" class="btn btn-primary" type="submit">Sign in</button>
      </form>
      <p id="admin-login-error" class="admin-notice error" hidden></p>
    </section>`;
  if (message) {
    const notice = document.getElementById('admin-login-message');
    notice.textContent = message;
    notice.hidden = false;
  }
  document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
  void renderAdminTurnstile();
}

function showAdminLoginError(message) {
  const error = document.getElementById('admin-login-error');
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function loadAdminTurnstileApi() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (adminTurnstileApiPromise) return adminTurnstileApiPromise;
  adminTurnstileApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => {
      adminTurnstileApiPromise = null;
      reject(new Error('Bot protection could not load.'));
    };
    document.head.append(script);
  });
  return adminTurnstileApiPromise;
}

async function renderAdminTurnstile() {
  try {
    await loadAdminTurnstileApi();
    if (!document.getElementById('admin-turnstile') || adminTurnstileWidget !== undefined) return;
    adminTurnstileWidget = window.turnstile.render('#admin-turnstile', {
      sitekey: ADMIN_TURNSTILE_SITE_KEY,
      action: 'admin_login',
      theme: 'auto',
    });
  } catch (_) {
    showAdminLoginError(
      'Bot protection couldn’t run. If you use an ad or privacy blocker, allow tripcash.de and challenges.cloudflare.com, then reload.',
    );
  }
}

async function handleAdminLogin(event) {
  event.preventDefault();
  if (adminLoginPending) return;
  showAdminLoginError('');
  const email = document.getElementById('admin-login-email').value.trim();
  const password = document.getElementById('admin-login-password').value;
  if (!email || !password) {
    showAdminLoginError('Enter the admin email and password.');
    return;
  }
  const captchaToken =
    adminTurnstileWidget === undefined ? '' : window.turnstile?.getResponse(adminTurnstileWidget) || '';
  if (!captchaToken) {
    showAdminLoginError('Complete the bot-protection check first.');
    return;
  }

  adminLoginPending = true;
  const submit = document.getElementById('admin-login-submit');
  submit.disabled = true;
  let signInError = true;
  try {
    const { error } = await db.auth.signInWithPassword({ email, password, options: { captchaToken } });
    signInError = Boolean(error);
  } catch (_) {
    /* Reported below without revealing which credential failed. */
  }
  adminLoginPending = false;
  if (signInError) {
    submit.disabled = false;
    if (adminTurnstileWidget !== undefined) window.turnstile?.reset(adminTurnstileWidget);
    showAdminLoginError('Sign-in failed. Check the email and password and try again.');
    return;
  }
  await startAdmin();
}

let pendingAdminFactorId = null;

function showAdminError(message) {
  const loading = document.getElementById('admin-loading');
  if (loading) loading.hidden = true;
  const body = document.getElementById('admin-body');
  if (body) {
    body.replaceChildren();
    const notice = document.createElement('p');
    notice.className = 'admin-notice error';
    notice.textContent = message;
    body.append(notice);
  }
}

function safeAdminQrCode(value) {
  const qr = String(value || '');
  return /^data:image\/svg\+xml;(?:utf-8|charset=utf-8|base64),/i.test(qr) ? qr : '';
}

async function showAdminMfaGate() {
  const factors = await db.auth.mfa.listFactors().catch(() => ({ error: true }));
  if (factors.error) {
    showAdminError('Unable to load authenticator settings.');
    return;
  }
  const verified = factors.data?.totp?.find(factor => factor.status === 'verified');
  document.getElementById('admin-loading').hidden = true;
  if (verified) {
    pendingAdminFactorId = verified.id;
    renderAdminMfaCodeForm('Enter the six-digit code from your authenticator app.');
    return;
  }
  document.getElementById('admin-body').innerHTML = `
    <section class="card admin-mfa-card admin-mfa-intro">
      <div class="admin-mfa-icon" aria-hidden="true">2</div>
      <p class="admin-mfa-eyebrow">Account security</p>
      <h2>Protect your admin account</h2>
      <p>Use an authenticator app to add a second security check when you sign in.</p>
      <ul class="admin-mfa-benefits">
        <li>Works with Google Authenticator, Authy, 1Password, and similar apps</li>
        <li>Required before sensitive TripCash administration is available</li>
      </ul>
      <button id="admin-mfa-enroll" class="btn btn-primary" type="button">Continue setup</button>
    </section>`;
  document.getElementById('admin-mfa-enroll').addEventListener('click', enrollAdminMfa);
}

async function enrollAdminMfa() {
  const button = document.getElementById('admin-mfa-enroll');
  if (button) button.disabled = true;
  const enrolled = await db.auth.mfa
    .enroll({ factorType: 'totp', friendlyName: 'TripCash Admin' })
    .catch(() => ({ error: true }));
  if (enrolled.error || !enrolled.data?.id || !enrolled.data?.totp?.qr_code) {
    document.getElementById('admin-body').innerHTML = '<p class="admin-notice error">Authenticator setup failed.</p>';
    return;
  }
  pendingAdminFactorId = enrolled.data.id;
  renderAdminMfaCodeForm(
    'Scan the QR code with your authenticator app, then enter the code it shows.',
    enrolled.data.totp.qr_code,
    enrolled.data.totp.secret,
  );
}

function renderAdminMfaCodeForm(message, qrCode = '', setupSecret = '') {
  const safeQrCode = safeAdminQrCode(qrCode);
  const secret = String(setupSecret || '')
    .replace(/[^A-Z2-7]/gi, '')
    .toUpperCase()
    .slice(0, 128);
  const isEnrollment = Boolean(safeQrCode || secret);
  document.getElementById('admin-body').innerHTML = `
    <section class="card admin-mfa-card admin-mfa-verify-card">
      <p class="admin-mfa-eyebrow">Two-factor authentication</p>
      <h2>${isEnrollment ? 'Connect your authenticator' : 'Verify it’s you'}</h2>
      <p class="admin-mfa-copy">${esc(message)}</p>
      ${
        isEnrollment
          ? `
        <ol class="admin-mfa-steps" aria-label="Authenticator setup steps">
          <li><span>1</span><div><strong>Open your authenticator app</strong><small>Add a new account and choose Scan QR code.</small></div></li>
          <li><span>2</span><div><strong>Scan this code</strong><small>The code stays on this screen until setup is complete.</small></div></li>
        </ol>`
          : ''
      }
      ${safeQrCode ? `<div class="admin-mfa-qr-frame"><img class="admin-mfa-qr" src="${esc(safeQrCode)}" alt="QR code for TripCash Admin two-factor authentication" /></div>` : ''}
      ${
        secret
          ? `
        <details class="admin-mfa-manual">
          <summary>Can’t scan the QR code?</summary>
          <p>Enter this setup key manually in your authenticator app.</p>
          <div class="admin-mfa-secret-row">
            <code id="admin-mfa-secret"></code>
            <button id="admin-mfa-copy-secret" class="btn btn-secondary btn-sm" type="button">Copy</button>
          </div>
          <p id="admin-mfa-copy-status" class="admin-mfa-copy-status" role="status" aria-live="polite"></p>
        </details>`
          : ''
      }
      <form id="admin-mfa-form" novalidate>
        <label for="admin-mfa-code">Six-digit code</label>
        <input id="admin-mfa-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" maxlength="7" aria-describedby="admin-mfa-code-help admin-mfa-error" required />
        <small id="admin-mfa-code-help">Enter the current code from your authenticator app.</small>
        <button class="btn btn-primary" type="submit">${isEnrollment ? 'Finish setup' : 'Verify and continue'}</button>
      </form>
      <p id="admin-mfa-error" class="admin-notice error" role="alert" hidden></p>
    </section>`;
  const input = document.getElementById('admin-mfa-code');
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
    const error = document.getElementById('admin-mfa-error');
    error.hidden = true;
    input.removeAttribute('aria-invalid');
  });
  document.getElementById('admin-mfa-form').addEventListener('submit', verifyAdminMfa);
  if (secret) {
    document.getElementById('admin-mfa-secret').textContent = secret.match(/.{1,4}/g)?.join(' ') || secret;
    document.getElementById('admin-mfa-copy-secret').addEventListener('click', async () => {
      const status = document.getElementById('admin-mfa-copy-status');
      try {
        await navigator.clipboard.writeText(secret);
        status.textContent = 'Setup key copied.';
      } catch (_) {
        status.textContent = 'Copy was unavailable. Select the key and copy it manually.';
      }
    });
  }
  input.focus();
}

async function verifyAdminMfa(event) {
  event.preventDefault();
  const input = document.getElementById('admin-mfa-code');
  const code = input.value.replace(/\D/g, '');
  const error = document.getElementById('admin-mfa-error');
  if (!pendingAdminFactorId || !/^[0-9]{6}$/.test(code)) {
    error.textContent = 'Enter the complete six-digit code.';
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  const result = await db.auth.mfa
    .challengeAndVerify({ factorId: pendingAdminFactorId, code })
    .catch(() => ({ error: true }));
  if (result.error) {
    error.textContent = 'The authentication code is invalid.';
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.select();
    return;
  }
  document.getElementById('admin-body').replaceChildren();
  await loadAdmin();
}

async function loadAdmin() {
  document.getElementById('admin-loading').hidden = false;

  let statsRes;
  try {
    statsRes = await db.rpc('admin_stats');
  } catch (_) {
    statsRes = { error: true };
  }

  document.getElementById('admin-loading').hidden = true;

  if (
    statsRes.error ||
    !statsRes.data ||
    !Array.isArray(statsRes.data.trips) ||
    !Array.isArray(statsRes.data.profiles) ||
    !Array.isArray(statsRes.data.trip_members)
  ) {
    document.getElementById('admin-body').innerHTML = '<p class="admin-notice error">Unable to load admin data.</p>';
    return;
  }

  const { trips, profiles, trip_members, total_expenses, total_amount } = statsRes.data;

  document.getElementById('admin-body').innerHTML =
    renderStats(trips, profiles, total_expenses, total_amount) +
    renderTripsTable(trips, trip_members) +
    renderUsersTable(profiles, trip_members);
}

function renderStats(trips, profiles, total_expenses, total_amount) {
  return `
    <div class="admin-stats">
      <div class="stat-card"><div class="stat-num">${trips.length}</div><div class="stat-label">Trips</div></div>
      <div class="stat-card"><div class="stat-num">${profiles.length}</div><div class="stat-label">Users</div></div>
      <div class="stat-card"><div class="stat-num">${total_expenses}</div><div class="stat-label">Expenses</div></div>
      <div class="stat-card"><div class="stat-num">€${parseFloat(total_amount).toFixed(2)}</div><div class="stat-label">Total spent</div></div>
    </div>`;
}

function renderTripsTable(trips, trip_members) {
  return `
    <h2 class="admin-section-title">All trips</h2>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Trip</th><th>Status</th><th>Currency</th><th>Day</th><th>Members</th><th>Created</th></tr></thead>
        <tbody>
          ${trips
            .map(t => {
              const count = trip_members.filter(m => m.trip_id === t.id).length;
              const date = new Date(t.created_at).toLocaleDateString('en-GB');
              const badge =
                t.status === 'ended'
                  ? '<span class="admin-badge ended">Ended</span>'
                  : '<span class="admin-badge active">Active</span>';
              return `<tr>
              <td><strong>${esc(t.emoji || '✈️')} ${esc(t.name)}</strong></td>
              <td>${badge}</td>
              <td>${esc(t.currency)}</td>
              <td>${t.current_day}</td>
              <td>${count}</td>
              <td>${date}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function renderUsersTable(profiles, trip_members) {
  return `
    <h2 class="admin-section-title">All users</h2>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Name</th><th>Type</th><th>Trips</th><th>Joined</th></tr></thead>
        <tbody>
          ${profiles
            .map(p => {
              const count = trip_members.filter(m => m.user_id === p.id).length;
              const date = new Date(p.created_at).toLocaleDateString('en-GB');
              const type = p.is_anonymous
                ? '<span class="admin-badge guest">Guest</span>'
                : '<span class="admin-badge active">Registered</span>';
              return `<tr>
              <td><strong>${esc(p.display_name)}</strong></td>
              <td>${type}</td>
              <td>${count}</td>
              <td>${date}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
