// Authenticated receipt extraction. The browser never receives the OpenAI key.

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
const SUPABASE_URL = 'https://msnholvugsehlxkvzlxp.supabase.co';
const AUTH_TIMEOUT_MS = 8000;
// Keep this below the hosting gateway window so failures are returned as JSON
// instead of being replaced by a platform-generated HTML/text 502 response.
const OPENAI_TIMEOUT_MS = 15000;
const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CHF', 'ALL']);
const ACCEPTED_CATEGORIES = new Set(['food', 'drinks', 'transport', 'hotel', 'activities', 'other']);

const json = (body, status = 200, origin = '') =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });

function validOrigin(request) {
  return request.headers.get('Origin') || '';
}

function parseImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_REQUEST_BYTES) return null;
  // Match only the short prefix: a pattern over the whole ~1 MB string cost ~4 ms
  // of CPU, and the free plan allows ~10 ms. atob still rejects invalid base64.
  const match = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(dataUrl);
  if (!match || !ACCEPTED_IMAGE_TYPES.has(match[1])) return null;
  let byteLength = 0;
  try {
    byteLength = atob(dataUrl.slice(match[0].length)).length;
  } catch (_) {
    return null;
  }
  if (!byteLength || byteLength > MAX_IMAGE_BYTES) return null;
  return { dataUrl, mimeType: match[1], byteLength };
}

function nullable(type) {
  return { anyOf: [{ type }, { type: 'null' }] };
}

function validReceiptDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? value
    : null;
}

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'amount',
    'amountKind',
    'amountEvidence',
    'subtotal',
    'tax',
    'taxIncluded',
    'currency',
    'category',
    'receiptDate',
  ],
  properties: {
    title: nullable('string'),
    amount: nullable('number'),
    amountKind: { type: 'string', enum: ['final_total', 'outstanding_balance', 'unclear'] },
    amountEvidence: nullable('string'),
    subtotal: nullable('number'),
    tax: nullable('number'),
    taxIncluded: nullable('boolean'),
    currency: { anyOf: [{ type: 'string', enum: [...ACCEPTED_CURRENCIES] }, { type: 'null' }] },
    category: { anyOf: [{ type: 'string', enum: [...ACCEPTED_CATEGORIES] }, { type: 'null' }] },
    receiptDate: nullable('string'),
  },
};

// Each field is checked on its own: an invalid value becomes null for the user to
// fill in, instead of discarding a scan whose other fields (often the total) are fine.
// Returns the names of dropped fields so failures can be logged without receipt data.
function cleanSuggestions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dropped = [];
  const keep = (name, raw, cleaned) => {
    if (raw !== null && raw !== undefined && cleaned === null) dropped.push(name);
    return cleaned;
  };
  const cleanText = (text, max) =>
    typeof text === 'string'
      ? text
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, max) || null
      : null;
  const positive = number => (Number.isFinite(number) && number > 0 && number <= 1000000 ? number : null);
  const title = keep('title', value.title, cleanText(value.title, 80));
  let amount = keep('amount', value.amount, value.amount === null ? null : positive(Number(value.amount)));
  const amountEvidence = cleanText(value.amountEvidence, 120);
  const subtotal = keep('subtotal', value.subtotal, value.subtotal === null ? null : positive(Number(value.subtotal)));
  const rawTax = value.tax === null ? null : Number(value.tax);
  const tax = keep('tax', value.tax, Number.isFinite(rawTax) && rawTax >= 0 && rawTax <= 1000000 ? rawTax : null);
  const taxIncluded = value.taxIncluded === true;
  const supportedAmountKind = value.amountKind === 'final_total' || value.amountKind === 'outstanding_balance';
  const supportedAmountEvidence =
    /\b(?:grand\s*total|final\s*total|amount\s*(?:due|payable|paid)|balance\s*due|total(?:e|i)?|gesamt(?:betrag)?|endbetrag|zu\s*zahlen|summe|brutto|shuma|totali|p[ëe]r\s*pages[ëe]|paguar)\b/i.test(
      amountEvidence || '',
    );
  if (
    amount !== null &&
    (!supportedAmountKind ||
      !supportedAmountEvidence ||
      (!taxIncluded && subtotal !== null && tax !== null && tax > 0 && amount <= subtotal + 0.005))
  )
    amount = null;
  const currency = keep('currency', value.currency, ACCEPTED_CURRENCIES.has(value.currency) ? value.currency : null);
  const category = keep('category', value.category, ACCEPTED_CATEGORIES.has(value.category) ? value.category : null);
  const receiptDate = keep('receiptDate', value.receiptDate, validReceiptDate(value.receiptDate));
  return { suggestions: { title, amount, currency, category, receiptDate }, dropped };
}

function responseOutputText(response) {
  if (!Array.isArray(response?.output)) return '';
  return response.output
    .filter(item => item?.type === 'message' && Array.isArray(item.content))
    .flatMap(item => item.content)
    .filter(content => content?.type === 'output_text' && typeof content.text === 'string')
    .map(content => content.text)
    .join('');
}

function openAIErrorMessage(response, body) {
  const status = Number(response?.status || 0);
  const code = String(body?.error?.code || '').toLowerCase();
  const type = String(body?.error?.type || '').toLowerCase();
  if (status === 429) return 'Receipt scanning is busy. Try again shortly.';
  if (status === 401 || code === 'invalid_api_key') return 'Receipt scanning server authentication failed.';
  if (status === 403) return 'Receipt scanning server does not have access to the configured model.';
  if (status === 404 || code === 'model_not_found') return 'Receipt scanning model is unavailable.';
  if (status === 400 || type === 'invalid_request_error') return 'Receipt scanning request configuration was rejected.';
  return 'Receipt scanning is temporarily unavailable. Try again.';
}

export function onRequestOptions({ request }) {
  const origin = validOrigin(request);
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
  const origin = validOrigin(request);
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Request rejected.' }, 403);
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.length > 4096 || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization))
    return json({ error: 'Authentication required.' }, 401, origin);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || ''))
    return json({ error: 'Invalid request.' }, 415, origin);
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_REQUEST_BYTES)
    return json({ error: 'Receipt image is too large.' }, 413, origin);

  let rawBody;
  let body;
  try {
    rawBody = await request.text();
    // Character length is enough here (the image is ASCII base64) and avoids copying
    // ~1 MB through TextEncoder; Content-Length was already bounded above.
    if (rawBody.length > MAX_REQUEST_BYTES) return json({ error: 'Receipt image is too large.' }, 413, origin);
    body = JSON.parse(rawBody);
  } catch (_) {
    return json({ error: 'Invalid request.' }, 400, origin);
  }
  const image = parseImage(body?.image?.dataUrl);
  if (!image) return json({ error: 'Use a JPG, PNG, or WebP receipt under 2 MB.' }, 400, origin);
  if (!env.SUPABASE_ANON_KEY || !env.OPENAI_API_KEY) {
    return json({ error: 'Receipt scanning is not configured.' }, 503, origin);
  }

  const supabaseHeaders = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
  let verifiedUser;
  try {
    const verification = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: supabaseHeaders,
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    verifiedUser = await verification.json().catch(() => null);
    if (!verification.ok) verifiedUser = null;
  } catch (_) {
    console.warn('Receipt scan rejected', { reason: 'auth_unavailable' });
    return json({ error: 'Account verification is temporarily unavailable.' }, 502, origin);
  }
  if (!verifiedUser?.id || !verifiedUser.email_confirmed_at)
    return json({ error: 'Confirmed account required.' }, 401, origin);

  let quotaAllowed;
  try {
    const quota = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_receipt_scan_quota`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: '{}',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    quotaAllowed = await quota.json().catch(() => null);
    if (!quota.ok) throw new Error('Receipt scan quota unavailable.');
  } catch (_) {
    console.warn('Receipt scan rejected', { reason: 'quota_unavailable' });
    return json({ error: 'Receipt scanning is temporarily unavailable. Try again.' }, 502, origin);
  }
  if (quotaAllowed !== true) return json({ error: 'Too many receipt scans. Try again in a minute.' }, 429, origin);

  let aiResponse;
  let aiBody;
  try {
    aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      body: JSON.stringify({
        model: env.OPENAI_RECEIPT_MODEL || 'gpt-5.4-mini',
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: 300,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Read only what is visibly printed on this receipt or invoice. Do not calculate, estimate, reconstruct, or invent an amount. First identify subtotal/net, tax/VAT, discounts, prior payments, and the final total independently. For a receipt, amount must be the visibly labelled final total actually paid after VAT/tax and discounts. For an invoice, amount must be the visibly labelled final total due/payable, or the outstanding balance when prior payments or credits are shown. Copy the complete printed line containing that final label and number into amountEvidence. Set amountKind to final_total or outstanding_balance only when amountEvidence visibly supports it; otherwise set amountKind to unclear, amountEvidence to null, and amount to null. Return visible subtotal and tax separately when present. Set taxIncluded to true only when the receipt explicitly states that VAT/tax is included in the total, false only when it explicitly states that VAT/tax is added or excluded, and null otherwise. Never use a subtotal/net amount when VAT/tax appears below it. Never use a tax amount, cash received, change, tip suggestion, unit price, card pre-authorisation, invoice number, or unrelated account balance. Use the visible merchant, supplier, or invoice issuer as a short title. Do not infer payer, split, trip day, or anything about people. Use an ISO currency code only when visible or unambiguously represented by a currency symbol and locale. Use the issue/transaction date, not a due date, service period, or payment deadline. If any value is unclear, return null.',
              },
              { type: 'input_image', image_url: image.dataUrl, detail: 'high' },
            ],
          },
        ],
        text: { format: { type: 'json_schema', name: 'receipt_expense', strict: true, schema: RECEIPT_SCHEMA } },
      }),
    });
    aiBody = await aiResponse.json().catch(() => null);
  } catch (error) {
    console.warn('Receipt scan rejected', {
      reason: error?.name === 'TimeoutError' ? 'openai_timeout' : 'openai_unreachable',
    });
    return json({ error: 'Receipt scanning is temporarily unavailable. Try again.' }, 502, origin);
  }
  if (!aiResponse.ok) {
    const status = aiResponse.status === 429 ? 429 : 502;
    console.error('Receipt scan upstream failure', {
      status: aiResponse.status,
      type: String(aiBody?.error?.type || '').slice(0, 80),
      code: String(aiBody?.error?.code || '').slice(0, 80),
    });
    return json({ error: openAIErrorMessage(aiResponse, aiBody) }, status, origin);
  }
  let cleaned;
  try {
    cleaned = cleanSuggestions(JSON.parse(responseOutputText(aiBody)));
  } catch (_) {
    cleaned = null;
  }
  if (!cleaned) {
    console.warn('Receipt scan rejected', { reason: 'unreadable_model_output' });
    // 422, not 502: the service worked, but this photo gave no usable answer.
    return json({ error: 'Receipt scanning could not read a usable result. Try another photo.' }, 422, origin);
  }
  if (cleaned.dropped.length) console.warn('Receipt scan fields dropped', { fields: cleaned.dropped });
  return json({ ok: true, suggestions: cleaned.suggestions }, 200, origin);
}
