// API route that validates contact requests and sends TripCash notification and receipt emails

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const MAX_BODY_BYTES = 16384;
const UPSTREAM_TIMEOUT_MS = 8000;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const clean = value => String(value || '').trim();
const cleanHeader = value =>
  clean(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ');
const sha256 = async value =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
const escapeHtml = value =>
  clean(value).replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character],
  );

export async function onRequestPost({ request, env }) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin !== 'https://tripcash.de' || requestUrl.origin !== 'https://tripcash.de') {
    return json({ error: 'Request rejected.' }, 403);
  }
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Invalid request.' }, 415);
  }
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Message is too large.' }, 413);
  }
  let payload;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return json({ error: 'Message is too large.' }, 413);
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch (_) {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return json({ error: 'Invalid request.' }, 400);
  const name = cleanHeader(payload.name);
  const email = clean(payload.email).toLowerCase();
  const subject = clean(payload.subject);
  const message = clean(payload.message);
  const turnstileToken = clean(payload['cf-turnstile-response']);
  const openedAt = Number(payload.openedAt || 0);
  const validTopics = new Set(['App support', 'Account or privacy', 'Feedback', 'Business enquiry', 'Other']);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (clean(payload.website)) return json({ ok: true });
  const formAge = Date.now() - openedAt;
  if (!Number.isFinite(openedAt) || openedAt <= 0 || formAge < 1500 || formAge > 86400000) {
    return json({ error: 'Please review your message and try again.' }, 400);
  }
  if (
    name.length < 2 ||
    name.length > 80 ||
    !validEmail ||
    email.length > 254 ||
    !validTopics.has(subject) ||
    message.length < 10 ||
    message.length > 3000
  ) {
    return json({ error: 'Please complete every field correctly.' }, 400);
  }
  if (turnstileToken.length < 20 || turnstileToken.length > 2048)
    return json({ error: 'Spam-protection check failed. Please try again.' }, 403);
  if (!env.TURNSTILE_SECRET_KEY) {
    return json({ error: 'Contact spam protection is not configured yet. Please email support@tripcash.de.' }, 503);
  }
  let turnstileResponse;
  let turnstileResult;
  try {
    turnstileResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: request.headers.get('CF-Connecting-IP') || undefined,
      }),
    });
    turnstileResult = await turnstileResponse.json().catch(() => null);
  } catch (_) {
    return json({ error: 'Spam protection is temporarily unavailable. Please try again.' }, 502);
  }
  if (
    !turnstileResponse.ok ||
    !turnstileResult?.success ||
    turnstileResult.hostname !== 'tripcash.de' ||
    turnstileResult.action !== 'contact'
  ) {
    return json({ error: 'Spam-protection check failed. Please try again.' }, 403);
  }
  const rateKey = await sha256(`contact:${email}`);
  // The rate-limit binding is optional: it is unavailable on the current Cloudflare
  // plan, and Turnstile, validation, and Resend idempotency already gate delivery.
  if (env.CONTACT_RATE_LIMITER) {
    const limit = await env.CONTACT_RATE_LIMITER.limit({ key: rateKey }).catch(() => null);
    if (!limit)
      return json({ error: 'Contact protection is temporarily unavailable. Please email support@tripcash.de.' }, 503);
    if (!limit.success) return json({ error: 'Too many messages. Please try again later.' }, 429);
  }
  if (!env.RESEND_API_KEY) {
    return json({ error: 'Contact email is not configured yet. Please email support@tripcash.de.' }, 503);
  }
  const sender = env.CONTACT_FROM_EMAIL || 'TripCash <website@send.tripcash.de>';
  const ownerText = `TripCash contact form\n\nName: ${name}\nEmail: ${email}\nTopic: ${subject}\n\n${message}`;
  const ownerHtml = `<h2>TripCash contact form</h2><p><strong>Name:</strong> ${escapeHtml(name)}<br><strong>Email:</strong> ${escapeHtml(email)}<br><strong>Topic:</strong> ${escapeHtml(subject)}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
  // The receipt goes to an unverified address, so it never repeats the sender's
  // name or message: otherwise the form could relay spam under TripCash's name.
  const receiptText = `Hi,\n\nThanks for contacting TripCash. We received your message about “${subject}” and will reply as soon as possible.\n\nIf you did not send this, you can ignore this email.\n\nTripCash Support\nhttps://tripcash.de/support`;
  const receiptHtml = `<!doctype html><html><body style="margin:0;background:#f4f8f7;font-family:Arial,sans-serif;color:#173b3a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8f7;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden"><tr><td style="background:#0ea5a0;padding:24px 32px;color:#ffffff;font-size:24px;font-weight:700">TripCash</td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:24px;color:#173b3a">Thanks for contacting us.</h1><p style="margin:0 0 16px;line-height:1.6">We received your message about <strong>${escapeHtml(subject)}</strong> and will reply as soon as possible.</p><p style="margin:0 0 16px;color:#56706f;line-height:1.6">If you did not send this, you can ignore this email.</p><p style="margin:24px 0 0;line-height:1.6">TripCash Support<br><a href="https://tripcash.de/support" style="color:#0b7f7b">tripcash.de/support</a></p></td></tr></table></td></tr></table></body></html>`;
  let response;
  try {
    response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `contact/${await sha256(`${turnstileToken}:${email}:${subject}:${message}`)}`,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      body: JSON.stringify([
        {
          to: ['support@tripcash.de'],
          from: sender,
          reply_to: email,
          subject: `[TripCash ${subject}] Message from ${name}`,
          text: ownerText,
          html: ownerHtml,
        },
        {
          to: [email],
          from: sender,
          reply_to: 'support@tripcash.de',
          subject: 'We received your TripCash message',
          text: receiptText,
          html: receiptHtml,
        },
      ]),
    });
  } catch (_) {
    return json({ error: 'Message delivery is temporarily unavailable. Please email support@tripcash.de.' }, 502);
  }
  if (!response.ok) return json({ error: 'Message could not be sent. Please email support@tripcash.de.' }, 502);
  return json({ ok: true });
}

export function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}
