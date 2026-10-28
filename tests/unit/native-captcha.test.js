// Regression tests for the HTTPS Turnstile bridge used by native TripCash WebViews

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const sourceFiles = { 'auth.js': 'web/scripts/auth.js', 'style.css': 'web/styles/app.css' };
const read = file => fs.readFileSync(path.join(root, sourceFiles[file] || file), 'utf8');

async function loadRoute() {
  const source = read('functions/native-captcha.js');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('native captcha route serves a restricted HTTPS Turnstile bridge', async () => {
  const { onRequestGet } = await loadRoute();
  const response = onRequestGet({
    request: new Request('https://tripcash.de/native-captcha?flow=register&channel=12345678-abcd'),
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(
    response.headers.get('Content-Security-Policy'),
    /script-src 'nonce-[a-f0-9]+' https:\/\/challenges\.cloudflare\.com/,
  );
  assert.equal(response.headers.get('X-Frame-Options'), null);
  assert.match(html, /"action":"signup"/);
  assert.match(html, /"flow":"register"/);
  assert.match(html, /allowedParents = new Set\(\['capacitor:\/\/localhost', 'https:\/\/localhost'\]\)/);
  assert.match(html, /event\.source !== parent/);
  assert.match(html, /message\?\.channel !== config\.channel/);
  assert.match(html, /width:300px;height:65px;overflow:hidden/);
  assert.doesNotMatch(html, /TURNSTILE_SECRET/i);
});

test('native captcha route rejects unknown flows and malformed channels', async () => {
  const { onRequestGet } = await loadRoute();
  const badFlow = onRequestGet({
    request: new Request('https://tripcash.de/native-captcha?flow=admin&channel=12345678-abcd'),
  });
  const badChannel = onRequestGet({
    request: new Request('https://tripcash.de/native-captcha?flow=login&channel=%3Cscript%3E'),
  });

  assert.equal(badFlow.status, 400);
  assert.equal(badChannel.status, 400);
});

test('native auth never renders Turnstile from the capacitor localhost origin', () => {
  const auth = read('auth.js');

  assert.match(auth, /NATIVE_TURNSTILE_URL = 'https:\/\/tripcash\.de\/native-captcha'/);
  assert.match(auth, /if \(isNativeAuthRuntime\(\)\) \{/);
  assert.match(auth, /frame\.src = `\$\{NATIVE_TURNSTILE_URL\}/);
  assert.match(auth, /event\.origin !== 'https:\/\/tripcash\.de'/);
  assert.match(auth, /event\.source !== state\.frame\.contentWindow/);
  assert.match(auth, /window\.turnstile\?\.getResponse/);
});

test('native captcha frame matches the standard Turnstile widget dimensions', () => {
  const styles = read('style.css');

  assert.match(styles, /\.native-turnstile-frame\s*\{[^}]*width:\s*300px;/s);
  assert.match(styles, /\.native-turnstile-frame\s*\{[^}]*height:\s*65px;/s);
});
