// Build utility that assembles web and native TripCash assets into the distribution directory

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const web = join(root, 'web');
const supabaseClient = join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const nativeBuild = process.env.TRIPCASH_NATIVE_BUILD === '1' || process.argv.includes('--native');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of await readdir(join(web, 'pages'), { withFileTypes: true })) {
  if (!entry.isFile() || (nativeBuild && entry.name === 'admin.html')) continue;
  await cp(join(web, 'pages', entry.name), join(dist, entry.name));
}

await cp(join(web, 'styles'), join(dist, 'styles'), {
  recursive: true,
  filter: source =>
    nativeBuild
      ? ![join(web, 'styles', 'analytics-consent.css'), join(web, 'styles', 'landing-theme.css')].includes(source)
      : source !== join(web, 'styles', 'native-redesign.css'),
});
await mkdir(join(dist, 'scripts'), { recursive: true });
for (const entry of await readdir(join(web, 'scripts'), { withFileTypes: true })) {
  if (
    !entry.isFile() ||
    (nativeBuild && ['admin.js', 'admin-client.js', 'analytics.js', 'web-shell.js'].includes(entry.name)) ||
    (!nativeBuild && entry.name === 'native-redesign.js')
  )
    continue;
  await cp(join(web, 'scripts', entry.name), join(dist, 'scripts', entry.name));
}
await cp(supabaseClient, join(dist, 'scripts', 'supabase-client.js'));

await mkdir(join(dist, 'assets'), { recursive: true });
for (const asset of [
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'tripcash-hero.jpg',
  'tripcash-hero.webp',
  'tripcash-link-preview.webp',
])
  await cp(join(web, 'assets', asset), join(dist, 'assets', asset));
if (!nativeBuild) {
  await cp(join(web, 'assets', 'screenshots'), join(dist, 'assets', 'screenshots'), { recursive: true });
}

for (const entry of await readdir(join(web, 'public'), { withFileTypes: true })) {
  if (nativeBuild && ['_headers', '.well-known'].includes(entry.name)) continue;
  await cp(join(web, 'public', entry.name), join(dist, entry.name), { recursive: entry.isDirectory() });
}

if (nativeBuild) {
  // Native uses the shared mobile presentation with its own shell adapter.
  const indexPath = join(dist, 'index.html');
  const nativeHtml = (await readFile(indexPath, 'utf8'))
    .replace(/\n  <!-- web-only:start -->[\s\S]*?<!-- web-only:end -->/g, '')
    .replace(
      '</head>',
      '  <link rel="stylesheet" href="styles/web-shell.css?v=20261006-3" />\n  <link rel="stylesheet" href="styles/native-redesign.css?v=20261006-1" />\n  <link rel="stylesheet" href="styles/phone-trip-expenses.css?v=20261005-1" />\n</head>',
    )
    .replace(
      '</body>',
      '  <script defer src="scripts/native-redesign.js?v=20260929-1"></script>\n  <script defer src="scripts/web-dashboard.js?v=20261005-1"></script>\n  <script defer src="scripts/web-workspace.js?v=20261010-1"></script>\n  <script defer src="scripts/web-expense.js?v=20260929-3"></script>\n</body>',
    );
  await writeFile(indexPath, nativeHtml);
} else {
  const appHtml = (await readFile(join(web, 'pages', 'index.html'), 'utf8'))
    .replace('<meta name="description"', '<meta name="robots" content="noindex" />\n  <meta name="description"')
    .replace('<body>', '<body data-screen="auth">')
    .replace('<div id="screen-auth" class="screen">', '<div id="screen-auth" class="screen active">');
  await writeFile(join(dist, 'app.html'), appHtml);
}
