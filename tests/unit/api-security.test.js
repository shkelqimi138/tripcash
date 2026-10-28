// Behavioral security checks for Cloudflare API routes

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
let routeVersion = 0;

async function loadRoute(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  routeVersion += 1;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${routeVersion}`);
}

function contactRequest(body, origin = 'https://tripcash.de') {
  return new Request('https://tripcash.de/api/contact', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const base64Url = value => Buffer.from(value).toString('base64url');

function unsignedIdentityToken(subject) {
  return `${base64Url(JSON.stringify({ alg: 'none' }))}.${base64Url(JSON.stringify({ sub: subject }))}.signature`;
}

async function appleTestSecrets() {
  const signingKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateKey = Buffer.from(await crypto.subtle.exportKey('pkcs8', signingKeys.privateKey));
  const pemBegin = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const pemEnd = ['-----END', 'PRIVATE KEY-----'].join(' ');
  const pem = `${pemBegin}\n${privateKey
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n${pemEnd}`;
  return {
    env: {
      APPLE_PRIVATE_KEY: pem,
      APPLE_CLIENT_ID: 'com.tripcash.app',
      APPLE_TEAM_ID: '945267LMP6',
      APPLE_KEY_ID: 'ABCDEFGHIJ',
    },
  };
}

test('contact API rejects forged schemes and oversized bodies', async () => {
  const { onRequestPost } = await loadRoute('functions/api/contact.js');
  const forged = await onRequestPost({
    request: contactRequest({}, 'http://tripcash.de'),
    env: {},
  });
  const oversized = await onRequestPost({
    request: contactRequest({ message: 'x'.repeat(17000) }),
    env: {},
  });

  assert.equal(forged.status, 403);
  assert.equal(oversized.status, 413);
});

test('contact API escapes submitted HTML before email delivery', async () => {
  const { onRequestPost } = await loadRoute('functions/api/contact.js');
  const originalFetch = global.fetch;
  let emailBatch;
  let emailHeaders;
  global.fetch = async (url, options) => {
    if (String(url).includes('siteverify')) {
      return new Response(JSON.stringify({ success: true, hostname: 'tripcash.de', action: 'contact' }), {
        status: 200,
      });
    }
    emailBatch = JSON.parse(options.body);
    emailHeaders = options.headers;
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: contactRequest({
        name: '<img src=x onerror=alert(1)>',
        email: 'person@example.com',
        subject: 'Feedback',
        message: '<script>alert(1)</script> hello',
        openedAt: Date.now() - 2000,
        website: '',
        'cf-turnstile-response': 'x'.repeat(32),
      }),
      env: {
        TURNSTILE_SECRET_KEY: 'test',
        RESEND_API_KEY: 'test',
        CONTACT_RATE_LIMITER: { limit: async () => ({ success: true }) },
      },
    });
    assert.equal(response.status, 200);
    assert.doesNotMatch(emailBatch[0].html, /<script>|<img/i);
    assert.match(emailBatch[0].html, /&lt;script&gt;/);
    assert.match(emailBatch[0].html, /&lt;img/);
    assert.match(emailHeaders['Idempotency-Key'], /^contact\/[a-f0-9]{64}$/);
    // The receipt goes to an unverified address, so it must not echo sender content.
    const receipt = emailBatch[1];
    assert.deepEqual(receipt.to, ['person@example.com']);
    assert.match(receipt.text, /about “Feedback”/);
    for (const body of [receipt.text, receipt.html]) {
      assert.doesNotMatch(body, /hello|alert|onerror/);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('contact API enforces the configured email rate limiter', async () => {
  const { onRequestPost } = await loadRoute('functions/api/contact.js');
  const originalFetch = global.fetch;
  global.fetch = async url => {
    assert.match(String(url), /siteverify/);
    return new Response(JSON.stringify({ success: true, hostname: 'tripcash.de', action: 'contact' }), { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: contactRequest({
        name: 'Test User',
        email: 'person@example.com',
        subject: 'Feedback',
        message: 'This is a valid test message.',
        openedAt: Date.now() - 2000,
        website: '',
        'cf-turnstile-response': 'x'.repeat(32),
      }),
      env: {
        TURNSTILE_SECRET_KEY: 'test',
        RESEND_API_KEY: 'test',
        CONTACT_RATE_LIMITER: { limit: async () => ({ success: false }) },
      },
    });
    assert.equal(response.status, 429);
  } finally {
    global.fetch = originalFetch;
  }
});

test('contact API sends without the optional rate limiter binding', async () => {
  const { onRequestPost } = await loadRoute('functions/api/contact.js');
  const originalFetch = global.fetch;
  let emailSent = false;
  global.fetch = async url => {
    if (String(url).includes('siteverify')) {
      return new Response(JSON.stringify({ success: true, hostname: 'tripcash.de', action: 'contact' }), {
        status: 200,
      });
    }
    assert.match(String(url), /api\.resend\.com/);
    emailSent = true;
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: contactRequest({
        name: 'Test User',
        email: 'person@example.com',
        subject: 'Feedback',
        message: 'This is a valid test message.',
        openedAt: Date.now() - 2000,
        website: '',
        'cf-turnstile-response': 'x'.repeat(32),
      }),
      env: { TURNSTILE_SECRET_KEY: 'test', RESEND_API_KEY: 'test' },
    });
    assert.equal(response.status, 200);
    assert.equal(emailSent, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('contact API fails closed when a configured rate limiter errors', async () => {
  const { onRequestPost } = await loadRoute('functions/api/contact.js');
  const originalFetch = global.fetch;
  global.fetch = async url => {
    assert.match(String(url), /siteverify/);
    return new Response(JSON.stringify({ success: true, hostname: 'tripcash.de', action: 'contact' }), { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: contactRequest({
        name: 'Test User',
        email: 'person@example.com',
        subject: 'Feedback',
        message: 'This is a valid test message.',
        openedAt: Date.now() - 2000,
        website: '',
        'cf-turnstile-response': 'x'.repeat(32),
      }),
      env: {
        TURNSTILE_SECRET_KEY: 'test',
        RESEND_API_KEY: 'test',
        CONTACT_RATE_LIMITER: {
          limit: async () => {
            throw new Error('limiter down');
          },
        },
      },
    });
    assert.equal(response.status, 503);
  } finally {
    global.fetch = originalFetch;
  }
});

test('welcome API rejects unknown origins and handles upstream failure', async () => {
  const { onRequestPost } = await loadRoute('functions/api/welcome.js');
  const rejected = await onRequestPost({
    request: new Request('https://tripcash.de/api/welcome', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Authorization: 'Bearer test.token' },
    }),
    env: {},
  });
  assert.equal(rejected.status, 403);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('network details must not escape');
  };
  try {
    const failed = await onRequestPost({
      request: new Request('https://tripcash.de/api/welcome', {
        method: 'POST',
        headers: { Origin: 'https://tripcash.de', Authorization: 'Bearer test.token' },
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'test' },
    });
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { error: 'Account verification is temporarily unavailable.' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure rejects mismatched confirmation without deleting the user', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async url => {
    calls += 1;
    assert.match(String(url), /\/auth\/v1\/user$/);
    return new Response(
      JSON.stringify({
        id: 'user-1',
        email: 'owner@example.com',
        email_confirmed_at: '2026-09-17T00:00:00Z',
        last_sign_in_at: new Date().toISOString(),
      }),
      { status: 200 },
    );
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationEmail: 'other@example.com' }),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'test' },
    });
    assert.equal(response.status, 403);
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure rejects oversized bodies even without a declared length', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const response = await onRequestPost({
    request: new Request('https://tripcash.de/api/account-closure', {
      method: 'POST',
      headers: {
        Origin: 'https://tripcash.de',
        Authorization: 'Bearer test.token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmationEmail: `${'x'.repeat(5000)}@example.com` }),
    }),
    env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'test' },
  });
  assert.equal(response.status, 413);
});

test('account closure rejects a stale session before privileged deletion', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const originalFetch = global.fetch;
  let deleteCalled = false;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(
        JSON.stringify({
          id: 'user-1',
          email: 'owner@example.com',
          email_confirmed_at: '2026-09-17T00:00:00Z',
          last_sign_in_at: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
          identities: [],
        }),
        { status: 200 },
      );
    if (String(url).includes('/rpc/delete_user_by_id')) deleteCalled = true;
    return new Response(null, { status: 500 });
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationEmail: 'owner@example.com' }),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'test' },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'Sign in again before deleting your account.',
      code: 'reauthentication_required',
    });
    assert.equal(deleteCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure deletes through the authenticated RPC before sending notice', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(
        JSON.stringify({
          id: 'user-1',
          email: 'owner@example.com',
          email_confirmed_at: '2026-09-17T00:00:00Z',
          last_sign_in_at: new Date().toISOString(),
          identities: [],
        }),
        { status: 200 },
      );
    }
    if (String(url).includes('/rpc/delete_user_by_id')) {
      assert.equal(options.headers.apikey, 'service-test');
      assert.equal(options.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(options.body), { p_user_id: 'user-1' });
      return new Response(null, { status: 204 });
    }
    const email = JSON.parse(options.body);
    assert.deepEqual(email.to, ['owner@example.com']);
    assert.match(options.headers['Idempotency-Key'], /^tripcash-account-closed-/);
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationEmail: 'OWNER@example.com' }),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'test' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      emailSent: true,
      appleRevoked: false,
      manualAppleRevocationRequired: false,
    });
    assert.match(calls[1], /\/rpc\/delete_user_by_id$/);
    assert.equal(calls[2], 'https://api.resend.com/emails');
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure authenticates legacy service-role JWTs without treating new secret keys as bearer tokens', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const originalFetch = global.fetch;
  const legacyServiceRoleJwt = ['legacy-header', 'legacy-payload', 'legacy-signature'].join('.');
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(
        JSON.stringify({
          id: 'legacy-key-user',
          email: 'owner@example.com',
          email_confirmed_at: '2026-10-14T00:00:00Z',
          last_sign_in_at: new Date().toISOString(),
          identities: [],
        }),
        { status: 200 },
      );
    if (String(url).includes('/rpc/delete_user_by_id')) {
      assert.equal(options.headers.apikey, legacyServiceRoleJwt);
      assert.equal(options.headers.Authorization, `Bearer ${legacyServiceRoleJwt}`);
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationEmail: 'owner@example.com' }),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: legacyServiceRoleJwt },
    });
    assert.equal(response.status, 200);
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure still deletes when optional closure email is not configured', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(
        JSON.stringify({
          id: 'user-1',
          email: 'owner@example.com',
          email_confirmed_at: '2026-10-13T00:00:00Z',
          last_sign_in_at: new Date().toISOString(),
          identities: [],
        }),
        { status: 200 },
      );
    if (String(url).includes('/rpc/delete_user_by_id')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationEmail: 'owner@example.com' }),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      emailSent: false,
      appleRevoked: false,
      manualAppleRevocationRequired: false,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure flags manual Apple revocation when the account used Apple', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(
        JSON.stringify({
          id: 'apple-user',
          email: 'apple@example.com',
          email_confirmed_at: '2026-10-07T00:00:00Z',
          last_sign_in_at: new Date().toISOString(),
          identities: [{ provider: 'apple' }],
        }),
        { status: 200 },
      );
    }
    if (String(url).includes('/rpc/delete_user_by_id')) return new Response(null, { status: 204 });
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationEmail: 'apple@example.com' }),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'test' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).manualAppleRevocationRequired, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure exchanges a fresh Apple code, deletes the account, and only then revokes it', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const apple = await appleTestSecrets();
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(
        JSON.stringify({
          id: 'apple-user',
          email: 'apple@example.com',
          email_confirmed_at: '2026-10-07T00:00:00Z',
          identities: [{ provider: 'apple', identity_data: { sub: 'apple-subject' } }],
        }),
        { status: 200 },
      );
    }
    if (String(url) === 'https://appleid.apple.com/auth/token') {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_id'), apple.env.APPLE_CLIENT_ID);
      assert.equal(body.get('code'), 'fresh-authorization-code');
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_secret').split('.').length, 3);
      return new Response(
        JSON.stringify({
          id_token: unsignedIdentityToken('apple-subject'),
          refresh_token: 'apple-refresh-token-for-tests',
        }),
        { status: 200 },
      );
    }
    if (String(url) === 'https://appleid.apple.com/auth/revoke') {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_id'), apple.env.APPLE_CLIENT_ID);
      assert.equal(body.get('token'), 'apple-refresh-token-for-tests');
      assert.equal(body.get('token_type_hint'), 'refresh_token');
      assert.equal(body.get('client_secret').split('.').length, 3);
      return new Response(null, { status: 200 });
    }
    if (String(url).includes('/rpc/delete_user_by_id')) return new Response(null, { status: 204 });
    if (String(url) === 'https://api.resend.com/emails') return new Response('{}', { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ appleAuthorizationCode: 'fresh-authorization-code' }),
      }),
      env: {
        SUPABASE_ANON_KEY: 'test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-test',
        RESEND_API_KEY: 'test',
        ...apple.env,
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      emailSent: true,
      appleRevoked: true,
      manualAppleRevocationRequired: false,
    });
    assert.ok(
      calls.indexOf('https://appleid.apple.com/auth/token') < calls.indexOf('https://appleid.apple.com/auth/revoke'),
    );
    assert.ok(
      calls.findIndex(url => url.includes('/rpc/delete_user_by_id')) <
        calls.indexOf('https://appleid.apple.com/auth/revoke'),
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure never revokes Apple when TripCash deletion fails', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const apple = await appleTestSecrets();
  const originalFetch = global.fetch;
  let revokeCalled = false;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(
        JSON.stringify({
          id: 'apple-user',
          identities: [{ provider: 'apple', identity_data: { sub: 'apple-subject' } }],
        }),
        { status: 200 },
      );
    if (String(url) === 'https://appleid.apple.com/auth/token')
      return new Response(
        JSON.stringify({
          id_token: unsignedIdentityToken('apple-subject'),
          refresh_token: 'apple-refresh-token',
        }),
        { status: 200 },
      );
    if (String(url).includes('/rpc/delete_user_by_id')) return new Response('{}', { status: 500 });
    if (String(url) === 'https://appleid.apple.com/auth/revoke') {
      revokeCalled = true;
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ appleAuthorizationCode: 'fresh-authorization-code' }),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ...apple.env },
    });
    assert.equal(response.status, 502);
    assert.equal(revokeCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure accepts an email-less Apple account after native confirmation', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const apple = await appleTestSecrets();
  const originalFetch = global.fetch;
  let deleteCalled = false;
  let emailCalled = false;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(
        JSON.stringify({
          id: 'private-apple-user',
          email: null,
          email_confirmed_at: null,
          identities: [{ provider: 'apple', identity_data: { sub: 'private-apple-subject' } }],
        }),
        { status: 200 },
      );
    if (String(url) === 'https://appleid.apple.com/auth/token')
      return new Response(
        JSON.stringify({
          id_token: unsignedIdentityToken('private-apple-subject'),
          refresh_token: 'private-apple-refresh-token',
        }),
        { status: 200 },
      );
    if (String(url) === 'https://appleid.apple.com/auth/revoke') return new Response(null, { status: 200 });
    if (String(url).includes('/rpc/delete_user_by_id')) {
      deleteCalled = true;
      return new Response(null, { status: 204 });
    }
    if (String(url) === 'https://api.resend.com/emails') {
      emailCalled = true;
      return new Response('{}', { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ appleAuthorizationCode: 'fresh-authorization-code' }),
      }),
      env: {
        SUPABASE_ANON_KEY: 'test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-test',
        RESEND_API_KEY: 'test',
        ...apple.env,
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      emailSent: false,
      appleRevoked: true,
      manualAppleRevocationRequired: false,
    });
    assert.equal(deleteCalled, true);
    assert.equal(emailCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('account closure does not revoke a token for a different Apple subject but still deletes', async () => {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const apple = await appleTestSecrets();
  const originalFetch = global.fetch;
  let revokeCalled = false;
  let deleteCalled = false;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(
        JSON.stringify({
          id: 'apple-user',
          email: 'apple@example.com',
          email_confirmed_at: '2026-10-07T00:00:00Z',
          last_sign_in_at: new Date().toISOString(),
          identities: [{ provider: 'apple', identity_data: { sub: 'expected-subject' } }],
        }),
        { status: 200 },
      );
    if (String(url) === 'https://appleid.apple.com/auth/token')
      return new Response(
        JSON.stringify({
          id_token: unsignedIdentityToken('different-subject'),
          refresh_token: 'must-not-be-revoked',
        }),
        { status: 200 },
      );
    if (String(url) === 'https://appleid.apple.com/auth/revoke') {
      revokeCalled = true;
      return new Response(null, { status: 200 });
    }
    if (String(url).includes('/rpc/delete_user_by_id')) {
      deleteCalled = true;
      return new Response(null, { status: 204 });
    }
    if (String(url) === 'https://api.resend.com/emails') return new Response('{}', { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirmationEmail: 'apple@example.com',
          appleAuthorizationCode: 'fresh-authorization-code',
        }),
      }),
      env: {
        SUPABASE_ANON_KEY: 'test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-test',
        RESEND_API_KEY: 'test',
        ...apple.env,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(revokeCalled, false);
    assert.equal(deleteCalled, true);
    assert.equal((await response.json()).manualAppleRevocationRequired, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('receipt scan only sends an authenticated, bounded image to the server-side AI request', async () => {
  const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1', email_confirmed_at: '2026-09-17T00:00:00Z' }), {
        status: 200,
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/consume_receipt_scan_quota')) {
      assert.equal(options.headers.Authorization, 'Bearer test.token');
      assert.equal(options.headers.apikey, 'anon');
      return new Response('true', { status: 200 });
    }
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer server-secret');
    assert.equal(payload.store, false);
    assert.equal(payload.model, 'gpt-5.4-mini');
    assert.equal(payload.input[0].content[1].type, 'input_image');
    assert.match(payload.input[0].content[1].image_url, /^data:image\/png;base64,/);
    assert.equal(payload.input[0].content[1].detail, 'high');
    assert.deepEqual(payload.reasoning, { effort: 'none' });
    assert.equal(payload.max_output_tokens, 300);
    assert.match(payload.input[0].content[0].text, /receipt or invoice/i);
    assert.match(payload.input[0].content[0].text, /outstanding balance/i);
    return new Response(
      JSON.stringify({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  title: 'Cafe Lunch',
                  amount: 12.5,
                  amountKind: 'final_total',
                  amountEvidence: 'TOTAL EUR 12.50',
                  subtotal: 10.5,
                  tax: 2,
                  taxIncluded: null,
                  currency: 'EUR',
                  category: 'food',
                  receiptDate: '2026-10-06',
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/receipt-scan', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
      }),
      env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      suggestions: { title: 'Cafe Lunch', amount: 12.5, currency: 'EUR', category: 'food', receiptDate: '2026-10-06' },
    });
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('receipt scan suppresses a pre-tax subtotal reported as the final amount', async () => {
  const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(JSON.stringify({ id: 'user-1', email_confirmed_at: '2026-10-13T00:00:00Z' }), {
        status: 200,
      });
    if (String(url).endsWith('/rest/v1/rpc/consume_receipt_scan_quota')) return new Response('true', { status: 200 });
    return new Response(
      JSON.stringify({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  title: 'VAT Cafe',
                  amount: 10,
                  amountKind: 'final_total',
                  amountEvidence: 'TOTAL EUR 10.00',
                  subtotal: 10,
                  tax: 2,
                  taxIncluded: null,
                  currency: 'EUR',
                  category: 'food',
                  receiptDate: '2026-10-13',
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/receipt-scan', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
      }),
      env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).suggestions.amount, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('receipt scan normalizes realistic suggestions and rejects unsafe fixture values', async () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/receipt-scan-suggestions.json'), 'utf8'));
  const originalFetch = global.fetch;
  try {
    for (const fixture of fixtures) {
      const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
      global.fetch = async url => {
        if (String(url).endsWith('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: 'user-1', email_confirmed_at: '2026-10-08T00:00:00Z' }), {
            status: 200,
          });
        }
        if (String(url).endsWith('/rest/v1/rpc/consume_receipt_scan_quota'))
          return new Response('true', { status: 200 });
        if (String(url) === 'https://api.openai.com/v1/responses') {
          return new Response(
            JSON.stringify({
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify(fixture.upstream),
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      };
      const response = await onRequestPost({
        request: new Request('https://tripcash.de/api/receipt-scan', {
          method: 'POST',
          headers: {
            Origin: 'https://tripcash.de',
            Authorization: 'Bearer test.token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
        }),
        env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
      });
      assert.equal(response.status, fixture.status, fixture.name);
      const body = await response.json();
      if (fixture.expected) assert.deepEqual(body.suggestions, fixture.expected, fixture.name);
      else assert.match(body.error, /could not read a usable result/i, fixture.name);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('receipt scan answers 422, not a gateway 502, when the model output is unreadable', async () => {
  const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1', email_confirmed_at: '2026-10-08T00:00:00Z' }), {
        status: 200,
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/consume_receipt_scan_quota')) return new Response('true', { status: 200 });
    return new Response(
      JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] }),
      { status: 200 },
    );
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/receipt-scan', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
      }),
      env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /could not read a usable result/i);
    assert.deepEqual(warnings, [['Receipt scan rejected', { reason: 'unreadable_model_output' }]]);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('receipt scan logs dropped field names without receipt contents', async () => {
  const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1', email_confirmed_at: '2026-10-08T00:00:00Z' }), {
        status: 200,
      });
    }
    if (String(url).endsWith('/rest/v1/rpc/consume_receipt_scan_quota')) return new Response('true', { status: 200 });
    return new Response(
      JSON.stringify({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  title: 'Olive Bakery',
                  amount: 6.8,
                  amountKind: 'final_total',
                  amountEvidence: 'TOTALI NE EURO 6.80',
                  subtotal: 6.3,
                  tax: 0.5,
                  taxIncluded: null,
                  currency: 'ALL-EUR',
                  category: 'food',
                  receiptDate: '18-10-2026',
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/receipt-scan', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
      }),
      env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
    });
    assert.equal(response.status, 200);
    // The total and merchant survive even though currency and date were unusable.
    assert.deepEqual((await response.json()).suggestions, {
      title: 'Olive Bakery',
      amount: 6.8,
      currency: null,
      category: 'food',
      receiptDate: null,
    });
    assert.deepEqual(warnings, [['Receipt scan fields dropped', { fields: ['currency', 'receiptDate'] }]]);
    assert.doesNotMatch(JSON.stringify(warnings), /Olive|6\.8|TOTALI/);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('receipt scan rejects invalid base64 without scanning the whole image with a pattern', async () => {
  const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
  const response = await onRequestPost({
    request: new Request('https://tripcash.de/api/receipt-scan', {
      method: 'POST',
      headers: {
        Origin: 'https://tripcash.de',
        Authorization: 'Bearer test.token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,not*valid*base64' } }),
    }),
    env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /JPG, PNG, or WebP/);
});

test('receipt scan quota blocks OpenAI when the account limit is reached', async () => {
  const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async url => {
    calls += 1;
    if (String(url).endsWith('/auth/v1/user'))
      return new Response(JSON.stringify({ id: 'user-1', email_confirmed_at: '2026-09-17T00:00:00Z' }), {
        status: 200,
      });
    if (String(url).endsWith('/rest/v1/rpc/consume_receipt_scan_quota')) return new Response('false', { status: 200 });
    throw new Error('OpenAI must not be called');
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/receipt-scan', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
      }),
      env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
    });
    assert.equal(response.status, 429);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('receipt scan reports safe, actionable upstream configuration failures', async () => {
  const originalFetch = global.fetch;
  const cases = [
    {
      upstreamStatus: 401,
      body: { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'secret detail' } },
      expected: /authentication failed/i,
    },
    {
      upstreamStatus: 403,
      body: { error: { type: 'permission_error', code: 'model_access_denied', message: 'secret detail' } },
      expected: /does not have access/i,
    },
    {
      upstreamStatus: 404,
      body: { error: { type: 'invalid_request_error', code: 'model_not_found', message: 'secret detail' } },
      expected: /model is unavailable/i,
    },
    {
      upstreamStatus: 400,
      body: { error: { type: 'invalid_request_error', code: 'invalid_value', message: 'secret detail' } },
      expected: /configuration was rejected/i,
    },
  ];
  try {
    for (const fixture of cases) {
      const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
      global.fetch = async url => {
        if (String(url).endsWith('/auth/v1/user'))
          return new Response(JSON.stringify({ id: 'user-1', email_confirmed_at: '2026-10-11T00:00:00Z' }), {
            status: 200,
          });
        if (String(url).endsWith('/rest/v1/rpc/consume_receipt_scan_quota'))
          return new Response('true', { status: 200 });
        return new Response(JSON.stringify(fixture.body), { status: fixture.upstreamStatus });
      };
      const response = await onRequestPost({
        request: new Request('https://tripcash.de/api/receipt-scan', {
          method: 'POST',
          headers: {
            Origin: 'https://tripcash.de',
            Authorization: 'Bearer test.token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
        }),
        env: { SUPABASE_ANON_KEY: 'anon', OPENAI_API_KEY: 'server-secret' },
      });
      assert.equal(response.status, fixture.upstreamStatus === 429 ? 429 : 502);
      const result = await response.json();
      assert.match(result.error, fixture.expected);
      assert.doesNotMatch(result.error, /secret detail/i);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('receipt scan rejects a forged origin and unsupported image before calling upstream services', async () => {
  const { onRequestPost } = await loadRoute('functions/api/receipt-scan.js');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error('must not be reached');
  };
  try {
    const forged = await onRequestPost({
      request: new Request('https://tripcash.de/api/receipt-scan', {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: { dataUrl: 'data:image/png;base64,aGVsbG8=' } }),
      }),
      env: {},
    });
    const unsupported = await onRequestPost({
      request: new Request('https://tripcash.de/api/receipt-scan', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: { dataUrl: 'data:image/heic;base64,aGVsbG8=' } }),
      }),
      env: {},
    });
    assert.equal(forged.status, 403);
    assert.equal(unsupported.status, 400);
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

// Regression: social-login accounts could not be deleted (Google/Apple sessions
// refresh silently, so last_sign_in_at goes stale, and Apple relay emails are
// unknown to users).
async function closeSocialAccount({ user, body, env = {}, appleTokenStatus }) {
  const { onRequestPost } = await loadRoute('functions/api/account-closure.js');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async url => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify(user), { status: 200 });
    if (String(url) === 'https://appleid.apple.com/auth/token')
      return new Response('{"error":"invalid_client"}', { status: appleTokenStatus });
    if (String(url).includes('/rpc/delete_user_by_id')) return new Response(null, { status: 204 });
    if (String(url) === 'https://api.resend.com/emails') return new Response('{}', { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://tripcash.de/api/account-closure', {
        method: 'POST',
        headers: {
          Origin: 'https://tripcash.de',
          Authorization: 'Bearer test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      env: { SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', RESEND_API_KEY: 'test', ...env },
    });
    return {
      response,
      json: await response.json(),
      deleted: calls.some(url => url.includes('/rpc/delete_user_by_id')),
      calls,
    };
  } finally {
    global.fetch = originalFetch;
  }
}

const minutesAgo = minutes => new Date(Date.now() - minutes * 60 * 1000).toISOString();
const googleUser = signedInAt => ({
  id: 'google-user',
  email: 'traveller@gmail.com',
  email_confirmed_at: '2026-10-01T00:00:00Z',
  last_sign_in_at: signedInAt,
  identities: [{ provider: 'google', identity_data: { sub: 'google-sub' } }],
});
const appleRelayUser = signedInAt => ({
  id: 'apple-relay-user',
  email: 'x7k2p9@privaterelay.appleid.com',
  email_confirmed_at: '2026-10-01T00:00:00Z',
  last_sign_in_at: signedInAt,
  identities: [{ provider: 'apple', identity_data: { sub: 'apple-relay-subject' } }],
});

test('account closure asks a stale Google session to sign in again with a machine-readable code', async () => {
  const result = await closeSocialAccount({
    user: googleUser(minutesAgo(90)),
    body: { confirmationEmail: 'traveller@gmail.com' },
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.json.code, 'reauthentication_required');
  assert.equal(result.deleted, false);
});

test('account closure accepts a Google sign-in from earlier within the hour', async () => {
  const result = await closeSocialAccount({
    user: googleUser(minutesAgo(45)),
    body: { confirmationEmail: 'traveller@gmail.com' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.deleted, true);
});

test('account closure deletes a Google account after a fresh sign-in', async () => {
  const result = await closeSocialAccount({
    user: googleUser(minutesAgo(1)),
    body: { confirmationEmail: 'TRAVELLER@gmail.com' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.deleted, true);
  assert.equal(result.json.manualAppleRevocationRequired, false);
});

test('account closure deletes a freshly signed-in Apple relay account without typing the relay email', async () => {
  const result = await closeSocialAccount({ user: appleRelayUser(minutesAgo(1)), body: {} });
  assert.equal(result.response.status, 200);
  assert.equal(result.deleted, true);
  assert.equal(result.json.manualAppleRevocationRequired, true);
});

test('account closure still deletes a fresh Apple account when Apple confirmation fails, without revoking', async () => {
  const apple = await appleTestSecrets();
  const result = await closeSocialAccount({
    user: appleRelayUser(minutesAgo(1)),
    body: { appleAuthorizationCode: 'rejected-code' },
    env: apple.env,
    appleTokenStatus: 400,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.deleted, true);
  assert.ok(!result.calls.includes('https://appleid.apple.com/auth/revoke'));
  assert.equal(result.json.manualAppleRevocationRequired, true);
});

test('account closure requires a fresh sign-in for an Apple account without a verified Apple code', async () => {
  const result = await closeSocialAccount({ user: appleRelayUser(minutesAgo(90)), body: {} });
  assert.equal(result.response.status, 403);
  assert.equal(result.json.code, 'reauthentication_required');
  assert.equal(result.deleted, false);
});

test('account closure rejects an Apple account that types a mismatched email', async () => {
  const result = await closeSocialAccount({
    user: appleRelayUser(minutesAgo(1)),
    body: { confirmationEmail: 'someone@else.com' },
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.json.error, 'Account confirmation did not match.');
  assert.equal(result.deleted, false);
});
