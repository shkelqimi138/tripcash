// Authenticated account closure: delete through the user's own session, then notify them.

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const ALLOWED_ORIGINS = new Set([
  'https://tripcash.de',
  'https://www.tripcash.de',
  'capacitor://localhost',
  'https://localhost',
]);
const UPSTREAM_TIMEOUT_MS = 8000;
const RECENT_SIGN_IN_MS = 60 * 60 * 1000;
const APPLE_AUDIENCE = 'https://appleid.apple.com';
const json = (body, status = 200, origin = '') =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });

function decodeBase64Url(value) {
  if (typeof value !== 'string' || value.length > 16384) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch (_) {
    return null;
  }
}

function encodeBase64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function appleConfiguration(env) {
  const privateKey = String(env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const clientId = String(env.APPLE_CLIENT_ID || '');
  const teamId = String(env.APPLE_TEAM_ID || '');
  const keyId = String(env.APPLE_KEY_ID || '');
  if (
    !/^-----BEGIN PRIVATE KEY-{5}[\s\S]+-----END PRIVATE KEY-{5}\s*$/.test(privateKey) ||
    !/^[A-Za-z0-9.-]{3,255}$/.test(clientId) ||
    !/^[A-Z0-9]{10}$/.test(teamId) ||
    !/^[A-Z0-9]{10}$/.test(keyId)
  )
    return null;
  return { privateKey, clientId, teamId, keyId };
}

async function createAppleClientSecret(configuration) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'ES256', kid: configuration.keyId }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: configuration.teamId,
      iat: now,
      exp: now + 300,
      aud: APPLE_AUDIENCE,
      sub: configuration.clientId,
    }),
  );
  const pemBody = configuration.privateKey.replace(/-----BEGIN PRIVATE KEY-{5}|-----END PRIVATE KEY-{5}|\s/g, '');
  const privateKeyBytes = decodeBase64Url(pemBody.replace(/\+/g, '-').replace(/\//g, '_'));
  if (!privateKeyBytes) throw new Error('Invalid private key');
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function identityTokenSubject(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const payloadBytes = decodeBase64Url(parts[1]);
  if (!payloadBytes) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return typeof payload?.sub === 'string' ? payload.sub : null;
  } catch (_) {
    return null;
  }
}

function hasRecentSignIn(user) {
  const signedInAt = Date.parse(user?.last_sign_in_at || '');
  const age = Date.now() - signedInAt;
  return Number.isFinite(signedInAt) && age >= -60000 && age <= RECENT_SIGN_IN_MS;
}

function serviceRoleHeaders(serviceRoleKey) {
  const headers = {
    apikey: serviceRoleKey,
    'Content-Type': 'application/json',
  };
  // New sb_secret keys must never be sent as bearer tokens. Legacy service-role
  // JWTs still need Authorization so PostgREST assumes the service_role claim.
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(serviceRoleKey)) {
    headers.Authorization = `Bearer ${serviceRoleKey}`;
  }
  return headers;
}

async function exchangeAppleAuthorization({ authorizationCode, appleSubject }, env) {
  const configuration = appleConfiguration(env);
  if (!configuration || !authorizationCode || !appleSubject) return null;
  try {
    const clientSecret = await createAppleClientSecret(configuration);
    const tokenResponse = await fetch(`${APPLE_AUDIENCE}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || identityTokenSubject(tokens?.id_token) !== appleSubject) return null;

    const token = tokens?.refresh_token || tokens?.access_token;
    const tokenType = tokens?.refresh_token ? 'refresh_token' : 'access_token';
    if (!token) return null;
    return { configuration, clientSecret, token, tokenType };
  } catch (_) {
    return null;
  }
}

async function revokeAppleAuthorization(authorization) {
  if (!authorization) return false;
  try {
    const revokeResponse = await fetch(`${APPLE_AUDIENCE}/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      body: new URLSearchParams({
        client_id: authorization.configuration.clientId,
        client_secret: authorization.clientSecret,
        token: authorization.token,
        token_type_hint: authorization.tokenType,
      }),
    });
    return revokeResponse.ok;
  } catch (_) {
    return false;
  }
}

export function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Request rejected.' }, 403);
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Request rejected.' }, 403);
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.length > 4096 || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization))
    return json({ error: 'Authentication required.' }, 401, origin);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || ''))
    return json({ error: 'Invalid request.' }, 415, origin);
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 4096)
    return json({ error: 'Invalid request.' }, 413, origin);
  if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY)
    return json({ error: 'Account closure is not configured.' }, 503, origin);

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 4096) return json({ error: 'Invalid request.' }, 413, origin);
    body = JSON.parse(rawBody);
  } catch (_) {
    return json({ error: 'Invalid request.' }, 400, origin);
  }
  const confirmationEmail = String(body?.confirmationEmail || '')
    .trim()
    .toLowerCase();
  if (confirmationEmail.length > 254) return json({ error: 'Invalid email confirmation.' }, 400, origin);
  const rawAppleAuthorizationCode = body?.appleAuthorizationCode;
  const appleAuthorizationCode =
    typeof rawAppleAuthorizationCode === 'string' && /^[\w.-]{1,2048}$/.test(rawAppleAuthorizationCode)
      ? rawAppleAuthorizationCode
      : null;

  const supabaseUrl = 'https://msnholvugsehlxkvzlxp.supabase.co';
  const supabaseHeaders = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
  let userResponse;
  let user;
  try {
    userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: supabaseHeaders,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    user = await userResponse.json().catch(() => null);
  } catch (_) {
    return json({ error: 'Account verification is temporarily unavailable.' }, 502, origin);
  }
  if (!userResponse.ok || !user?.id) return json({ error: 'Confirmed account required.' }, 401, origin);
  const appleIdentity = Array.isArray(user.identities)
    ? user.identities.find(identity => identity?.provider === 'apple')
    : null;
  const appleSubject = appleIdentity?.identity_data?.sub || appleIdentity?.provider_id || appleIdentity?.id || null;
  const hasAppleIdentity = Boolean(appleIdentity);
  const hasConfirmedEmail = Boolean(user.email && user.email_confirmed_at);
  if (!hasAppleIdentity && !hasConfirmedEmail) return json({ error: 'Confirmed account required.' }, 401, origin);
  const verifiedAppleAuthorization =
    hasAppleIdentity && appleAuthorizationCode
      ? await exchangeAppleAuthorization({ authorizationCode: appleAuthorizationCode, appleSubject }, env)
      : null;
  const emailConfirmed =
    hasConfirmedEmail && Boolean(confirmationEmail) && user.email.trim().toLowerCase() === confirmationEmail;
  // Apple relay addresses are unknown to most users, so Apple-linked accounts
  // confirm with Apple or a fresh sign-in instead of typing an email. A typed
  // email that does not match is still rejected.
  const appleSessionConfirmed = hasAppleIdentity && !confirmationEmail;
  if (!emailConfirmed && !verifiedAppleAuthorization && !appleSessionConfirmed) {
    return json({ error: 'Account confirmation did not match.' }, 403, origin);
  }
  if (!verifiedAppleAuthorization && !hasRecentSignIn(user)) {
    return json(
      { error: 'Sign in again before deleting your account.', code: 'reauthentication_required' },
      403,
      origin,
    );
  }

  let deletionResponse;
  try {
    const serviceHeaders = serviceRoleHeaders(env.SUPABASE_SERVICE_ROLE_KEY);
    deletionResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_user_by_id`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_user_id: user.id }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (_) {
    return json({ error: 'Account closure is temporarily unavailable.' }, 502, origin);
  }
  if (!deletionResponse.ok) return json({ error: 'Account closure could not be completed.' }, 502, origin);

  // Never revoke Apple before TripCash deletion succeeds. A failed database
  // operation must leave the provider authorization intact so the user can retry.
  const appleRevoked = verifiedAppleAuthorization ? await revokeAppleAuthorization(verifiedAppleAuthorization) : false;
  const manualAppleRevocationRequired = hasAppleIdentity && !appleRevoked;

  const sender = env.CONTACT_FROM_EMAIL || 'TripCash <hello@send.tripcash.de>';
  let emailSent = false;
  try {
    if (!user.email || !env.RESEND_API_KEY) throw new Error('No closure-email configuration or destination');
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `tripcash-account-closed-${user.id}`,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      body: JSON.stringify({
        from: sender,
        to: [user.email],
        reply_to: 'support@tripcash.de',
        subject: 'Your TripCash account has been closed',
        text: `Your TripCash account has been closed and its personal data deleted. Shared trip records that must remain have been anonymized.${manualAppleRevocationRequired ? '\n\nBecause you used Sign in with Apple, remove TripCash from Settings > your name > Sign-In & Security > Sign in with Apple to revoke the remaining Apple authorization.' : ''}\n\nIf you did not request this, contact support@tripcash.de immediately.`,
        html: `<!doctype html><html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#173b3a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:#0ea5a0;padding:24px 32px;color:#fff;font-size:24px;font-weight:700">TripCash</td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 16px">Your account has been closed</h1><p style="line-height:1.6">Your personal account data has been deleted. Shared trip records that must remain have been anonymized.</p>${manualAppleRevocationRequired ? '<p style="line-height:1.6"><strong>Sign in with Apple:</strong> remove TripCash from Settings → your name → Sign-In &amp; Security → Sign in with Apple to revoke the remaining Apple authorization.</p>' : ''}<p style="color:#56706f;font-size:14px;line-height:1.5">If you did not request this, contact <a href="mailto:support@tripcash.de">TripCash Support</a> immediately.</p></td></tr></table></td></tr></table></body></html>`,
      }),
    });
    emailSent = emailResponse.ok;
  } catch (_) {
    /* The account is already closed; report notification status without undoing deletion. */
  }

  return json({ ok: true, emailSent, appleRevoked, manualAppleRevocationRequired }, 200, origin);
}
