// Local static server that applies production-like headers during browser end-to-end tests

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'dist');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};
const csp =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com; script-src-elem 'self' https://fonts.googleapis.com https://challenges.cloudflare.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src-elem 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://msnholvugsehlxkvzlxp.supabase.co wss://msnholvugsehlxkvzlxp.supabase.co https://open.er-api.com https://challenges.cloudflare.com https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com; upgrade-insecure-requests";

http
  .createServer((request, response) => {
    const requestPath = new URL(request.url, 'http://127.0.0.1').pathname;
    const relativePath =
      requestPath === '/'
        ? 'index.html'
        : requestPath === '/app'
          ? 'app.html'
          : decodeURIComponent(requestPath).replace(/^\/+/, '');
    const file = path.resolve(root, relativePath);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Security-Policy': csp,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
    });
  })
  .listen(4173, '127.0.0.1');
