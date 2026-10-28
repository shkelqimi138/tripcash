// Exercise the JavaScript half of native cold/warm authentication callbacks.
// Native scene delivery and real email/OAuth acceptance require device testing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness(launchUrl) {
  const values = new Map();
  const listeners = {};
  const calls = { reloads: 0, closes: 0 };
  let ready;
  const context = {
    URL,
    URLSearchParams,
    Headers,
    supabase: { createClient: () => ({}) },
    localStorage: { setItem: (key, value) => values.set(key, value) },
    sessionStorage: { setItem: (key, value) => values.set(key, value) },
    location: {
      pathname: '/app.html',
      search: '',
      reload: () => {
        calls.reloads += 1;
      },
    },
    history: {
      replaceState: (_state, _title, url) => {
        calls.route = url;
        context.location.search = new URL(url, 'capacitor://localhost').search;
      },
    },
    document: {
      addEventListener: (_event, fn) => {
        ready = fn;
      },
    },
    window: {
      Capacitor: {
        Plugins: {
          Browser: {
            close: async () => {
              calls.closes += 1;
            },
          },
          App: {
            addListener: (event, fn) => {
              listeners[event] = fn;
            },
            getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : undefined),
          },
        },
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../web/scripts/supabase.js'), 'utf8'), context);
  ready();
  return { context, calls, values, listeners };
}

test('cold-start signup callback survives launch-url delivery without a duplicate reload', async () => {
  const url = 'https://tripcash.de/auth-callback?code=disposable-test-code&type=signup&intent=signup';
  const h = harness(url);
  await Promise.resolve();
  assert.equal(h.calls.route, '/app.html?code=disposable-test-code&type=signup&intent=signup');
  assert.equal(h.calls.reloads, 1);
  h.listeners.appUrlOpen({ url });
  assert.equal(h.calls.reloads, 1);
});

test('warm recovery callback preserves the recovery gate before reloading', () => {
  const h = harness();
  h.listeners.appUrlOpen({
    url: 'https://tripcash.de/auth-callback?code=disposable-test-code&type=recovery&untrusted=drop',
  });
  assert.equal(h.values.get('tc-password-recovery-pending'), 'true');
  assert.equal(h.calls.route, '/app.html?code=disposable-test-code&type=recovery');
  assert.equal(h.calls.reloads, 1);
  assert.equal(h.calls.closes, 1);
});

test('warm invitation and OAuth callbacks retain the one-time code', () => {
  for (const suffix of ['&type=invite', '']) {
    const h = harness();
    h.listeners.appUrlOpen({ url: `https://tripcash.de/auth-callback?code=disposable-test-code${suffix}` });
    assert.equal(h.calls.route, `/app.html?code=disposable-test-code${suffix}`);
    assert.equal(h.calls.reloads, 1);
  }
});

test('iOS custom-scheme callback from the web bridge retains the one-time code', () => {
  const h = harness();
  h.listeners.appUrlOpen({ url: 'com.tripcash.app://auth-callback?code=disposable-test-code' });
  assert.equal(h.calls.route, '/app.html?code=disposable-test-code');
  assert.equal(h.calls.reloads, 1);
  assert.equal(h.calls.closes, 1);
});

test('native callbacks reject foreign origins, unexpected paths, fragments, and missing codes', () => {
  const h = harness();
  for (const url of [
    'https://example.com/auth-callback?code=test',
    'http://tripcash.de/auth-callback?code=test',
    'https://tripcash.de/other?code=test',
    'https://tripcash.de/auth-callback?code=test#access_token=test',
    'https://tripcash.de/auth-callback?intent=signup',
    'tripcash://auth-callback?code=test',
    'com.tripcash.app://other?code=test',
  ])
    h.listeners.appUrlOpen({ url });
  assert.equal(h.calls.reloads, 0);
});
