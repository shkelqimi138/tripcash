// HTTPS bridge that runs Cloudflare Turnstile for TripCash native WebViews

const SITE_KEY = '0x4AAAAAAEm7OArk9r_5yrdA';
const ACTIONS = {
  login: 'login',
  register: 'signup',
  guest: 'guest',
  recovery: 'recovery',
  reauth: 'reauth',
};

function safeChannel(value) {
  const channel = String(value || '');
  return /^[a-zA-Z0-9-]{8,100}$/.test(channel) ? channel : '';
}

export function onRequestGet({ request }) {
  const url = new URL(request.url);
  const flow = Object.hasOwn(ACTIONS, url.searchParams.get('flow')) ? url.searchParams.get('flow') : '';
  const channel = safeChannel(url.searchParams.get('channel'));
  if (!flow || !channel) {
    return new Response('Invalid captcha request.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const nonce = crypto.randomUUID().replaceAll('-', '');
  const config = JSON.stringify({ action: ACTIONS[flow], channel, flow, sitekey: SITE_KEY });
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TripCash bot protection</title>
  <style nonce="${nonce}">html,body{margin:0;width:300px;height:65px;overflow:hidden;background:transparent}body{display:flex;align-items:flex-start;justify-content:center;font-family:system-ui,sans-serif}.status{padding:14px;color:#526563;font-size:13px;text-align:center}</style>
  <script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
</head>
<body>
  <div id="captcha"><div class="status">Loading bot protection…</div></div>
  <script nonce="${nonce}">
    const config = ${config};
    const allowedParents = new Set(['capacitor://localhost', 'https://localhost']);
    let parentOrigin = '';
    let rendered = false;
    function reply(type, extra = {}) {
      if (!parentOrigin) return;
      parent.postMessage({ source: 'tripcash-native-turnstile', type, flow: config.flow, channel: config.channel, ...extra }, parentOrigin);
    }
    function renderCaptcha() {
      if (rendered || !parentOrigin || !window.turnstile) return;
      rendered = true;
      document.getElementById('captcha').replaceChildren();
      window.turnstile.render('#captcha', {
        sitekey: config.sitekey,
        action: config.action,
        theme: 'auto',
        callback: token => reply('token', { token }),
        'error-callback': () => reply('error'),
        'expired-callback': () => reply('expired'),
      });
    }
    addEventListener('message', event => {
      const message = event.data;
      if (!allowedParents.has(event.origin) || event.source !== parent || message?.source !== 'tripcash-native-turnstile' || message?.type !== 'init' || message?.channel !== config.channel) return;
      parentOrigin = event.origin;
      renderCaptcha();
    });
    addEventListener('load', renderCaptcha);
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Cache-Control': 'no-store',
      // The message handshake restricts parents; frame-ancestors is omitted because iOS uses the custom capacitor: scheme.
      'Content-Security-Policy': `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com`,
      'Content-Type': 'text/html; charset=utf-8',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
