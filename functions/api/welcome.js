// Sends one welcome email after confirmation. Supabase atomically claims each user.

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
const json = (body, status = 200, origin = '') =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });

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
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 1024)
    return json({ error: 'Invalid request.' }, 413, origin);
  if (!env.SUPABASE_ANON_KEY || !env.RESEND_API_KEY) return json({ error: 'Email is not configured.' }, 503, origin);
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
  if (!userResponse.ok || !user?.id || !user.email || !user.email_confirmed_at)
    return json({ error: 'Confirmed account required.' }, 401, origin);

  let claimResponse;
  let claimed;
  try {
    claimResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_welcome_email`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: '{}',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    claimed = await claimResponse.json().catch(() => false);
  } catch (_) {
    return json({ error: 'Welcome email state is unavailable.' }, 502, origin);
  }
  if (!claimResponse.ok) return json({ error: 'Welcome email state is unavailable.' }, 502, origin);
  if (claimed !== true) return json({ ok: true, sent: false }, 200, origin);

  const name =
    String(user.user_metadata?.display_name || user.email.split('@')[0] || 'Traveller')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Traveller';
  const safeName = name.replace(
    /[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character],
  );
  const sender = env.CONTACT_FROM_EMAIL || 'TripCash <hello@send.tripcash.de>';
  let emailResponse;
  try {
    emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `tripcash-welcome-${user.id}`,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      body: JSON.stringify({
        from: sender,
        to: [user.email],
        reply_to: 'support@tripcash.de',
        subject: 'Welcome to TripCash',
        text: `Hi ${name},\n\nWelcome to TripCash. Your account is ready.\n\nStart planning: https://tripcash.de/app\n\nTripCash Support`,
        html: `<!doctype html><html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#173b3a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:#0ea5a0;padding:24px 32px;color:#fff;font-size:24px;font-weight:700">TripCash</td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 16px">Welcome, ${safeName}.</h1><p style="line-height:1.6">Your account is ready. Create a trip, invite your group and keep every shared cost clear.</p><p style="margin:28px 0"><a href="https://tripcash.de/app" style="display:inline-block;background:#0ea5a0;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Start using TripCash</a></p></td></tr></table></td></tr></table></body></html>`,
      }),
    });
  } catch (_) {
    return json({ error: 'Welcome email could not be sent.' }, 502, origin);
  }
  if (!emailResponse.ok) return json({ error: 'Welcome email could not be sent.' }, 502, origin);

  let completeResponse;
  try {
    completeResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/complete_welcome_email`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: '{}',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (_) {
    return json({ error: 'Welcome email state could not be completed.' }, 502, origin);
  }
  if (!completeResponse.ok) return json({ error: 'Welcome email state could not be completed.' }, 502, origin);
  return json({ ok: true, sent: true }, 200, origin);
}
