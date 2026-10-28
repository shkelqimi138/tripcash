// Unit tests for the hosted OAuth bridge that returns iOS callbacks to TripCash
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../web/scripts/auth-callback.js'), 'utf8');

function runCallback({ href, userAgent }) {
  const replacements = [];
  const timers = [];
  vm.runInNewContext(source, {
    URL,
    URLSearchParams,
    navigator: { userAgent },
    location: {
      href,
      replace(value) {
        replacements.push(value);
      },
    },
    setTimeout(callback) {
      timers.push(callback);
    },
  });
  return { replacements, timers };
}

test('iOS OAuth callback opens the registered TripCash scheme and keeps a web fallback', () => {
  const result = runCallback({
    href: 'https://tripcash.de/auth-callback?code=one-time-code&untrusted=drop',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  });
  assert.deepEqual(result.replacements, ['com.tripcash.app://auth-callback?code=one-time-code']);
  assert.equal(result.timers.length, 1);
  result.timers[0]();
  assert.deepEqual(result.replacements, [
    'com.tripcash.app://auth-callback?code=one-time-code',
    '/app?code=one-time-code',
  ]);
});

test('desktop OAuth callback remains on the normal web app route', () => {
  const result = runCallback({
    href: 'https://tripcash.de/auth-callback?code=one-time-code',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
  });
  assert.deepEqual(result.replacements, ['/app?code=one-time-code']);
  assert.equal(result.timers.length, 0);
});
