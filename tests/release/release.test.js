// Release checks for web, native, security, privacy, and packaging requirements

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const sourceFiles = {
  'index.html': 'web/pages/index.html',
  'admin.html': 'web/pages/admin.html',
  'privacy.html': 'web/pages/privacy.html',
  'terms.html': 'web/pages/terms.html',
  'support.html': 'web/pages/support.html',
  'delete-account.html': 'web/pages/delete-account.html',
  '404.html': 'web/pages/404.html',
  'auth-callback.js': 'web/scripts/auth-callback.js',
  'app.js': 'web/scripts/app.js',
  'auth.js': 'web/scripts/auth.js',
  'admin.js': 'web/scripts/admin.js',
  'supabase.js': 'web/scripts/supabase.js',
  'offline.js': 'web/scripts/offline.js',
  'landing.js': 'web/scripts/landing.js',
  'analytics.js': 'web/scripts/analytics.js',
  'style.css': 'web/styles/app.css',
  'landing.css': 'web/styles/landing.css',
  'landing-contact.css': 'web/styles/landing-contact.css',
  'landing-gallery.css': 'web/styles/landing-gallery.css',
  'analytics-consent.css': 'web/styles/analytics-consent.css',
  _headers: 'web/public/_headers',
  'robots.txt': 'web/public/robots.txt',
  'sitemap.xml': 'web/public/sitemap.xml',
  'schema.sql': 'supabase/sql/schema.sql',
  'SUPABASE_CROSS_DEVICE_PREFERENCES.sql': 'supabase/sql/migrations/cross-device-preferences.sql',
  'SUPABASE_REMAINING_MIGRATION.sql': 'supabase/sql/migrations/remaining-migration.sql',
  'SUPABASE_SECURITY_HARDENING.sql': 'supabase/sql/migrations/security-hardening.sql',
  'SUPABASE_SECURITY_HOTFIX.sql': 'supabase/sql/migrations/security-hotfix.sql',
  'SUPABASE_SECURITY_STAGE_1.sql': 'supabase/sql/migrations/security-stage-1.sql',
  'SUPABASE_TRANSACTIONAL_EMAIL.sql': 'supabase/sql/migrations/transactional-email.sql',
  'SUPABASE_RECEIPT_SCAN_RATE_LIMIT.sql': 'supabase/sql/migrations/receipt-scan-rate-limit.sql',
  'SUPABASE_REMOVE_APPLE_REVOCATION_STORAGE.sql': 'supabase/sql/migrations/remove-apple-revocation-token-storage.sql',
  'EMAIL_SETUP.md': 'docs/email-setup.md',
  '.well-known/apple-app-site-association': 'web/public/.well-known/apple-app-site-association',
  '.well-known/assetlinks.json': 'web/public/.well-known/assetlinks.json',
};
const read = file => fs.readFileSync(path.join(root, sourceFiles[file] || file), 'utf8');

test('repository pins Node 22 and runs the release checks in CI', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const workflow = read('.github/workflows/ci.yml');

  assert.equal(read('.nvmrc').trim(), '22');
  assert.equal(packageJson.engines.node, '>=22 <23');
  assert.equal(packageLock.packages[''].engines.node, '>=22 <23');
  assert.match(workflow, /node-version-file: \.nvmrc/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(workflow, /supabase\/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1/);
  assert.match(workflow, /version: 2\.116\.0/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /npm run test:integration/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run test:e2e/);
  assert.equal(packageJson.scripts['pretest:e2e'], 'npm run build');
  assert.match(read('playwright.config.cjs'), /globalSetup: require\.resolve\('\.\/tests\/e2e\/global-setup\.cjs'\)/);
  assert.match(read('tests/e2e/global-setup.cjs'), /spawn\(process\.execPath/);
  assert.match(workflow, /npm run cap:sync:ios/);
  assert.match(workflow, /git diff --exit-code/);
});

test('isolated Supabase integration environment tracks the authoritative schema', () => {
  const packageJson = JSON.parse(read('package.json'));
  const runner = read('scripts/run-supabase-integration.mjs');

  assert.match(runner, /requireLoopback\(status\.API_URL/);
  assert.match(runner, /requireLoopback\(status\.DB_URL/);
  assert.match(runner, /\['db', 'reset', '--local', '--yes'\]/);
  assert.match(runner, /`supabase_db_\$\{projectId\}`/);
  assert.ok(!fs.existsSync(path.join(root, 'supabase', 'migrations', '20260905184500_tripcash_schema.sql')));
  assert.equal(packageJson.scripts['test:integration'], 'node scripts/run-supabase-integration.mjs');
  assert.match(runner, /TRIPCASH_SUPABASE_INTEGRATION: '1'/);
});

test('exchange-rate requests time out and retain a durable local fallback', () => {
  const app = read('app.js');

  assert.match(app, /EXCHANGE_REQUEST_TIMEOUT_MS = 8000/);
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /tc-exchange-rates-v1/);
  assert.match(app, /storedExchangeRate\(key\)/);
  assert.match(app, /storeExchangeRate\(key, rate\)/);
});

test('profile preferences synchronize across devices and remain durable offline', () => {
  const schema = read('schema.sql');
  const migration = read('SUPABASE_CROSS_DEVICE_PREFERENCES.sql');
  const app = read('app.js');
  const auth = read('auth.js');
  const offline = read('offline.js');

  for (const field of ['home_currency', 'default_split', 'theme_preference']) {
    assert.match(schema, new RegExp(`${field} text not null default`));
    assert.match(migration, new RegExp(`add column if not exists ${field}`, 'i'));
    assert.match(auth, new RegExp(field));
  }
  assert.match(
    schema,
    /grant update \(display_name, username, avatar_url, paypal_link, home_currency,\s+default_split, theme_preference, is_anonymous\)/i,
  );
  assert.match(
    migration,
    /grant update \(home_currency, default_split, theme_preference\)\s+on public\.profiles to authenticated/i,
  );
  assert.match(app, /PROFILE_PREFERENCE_FIELDS/);
  assert.match(app, /saveOfflineCapableMutation\('Update profile preference'/);
  assert.match(app, /pendingProfileValues\(window\._currentUser\?\.id\)/);
  assert.match(auth, /applyProfilePreferences\(window\._currentProfile\)/);
  assert.match(auth, /_pendingProfilePreferenceMigration/);
  assert.match(offline, /function pendingProfileValues\(userId\)/);
});

test('release build contains required app and legal files', () => {
  const required = [
    'index.html',
    'app.html',
    'privacy.html',
    'terms.html',
    'support.html',
    'delete-account.html',
    'scripts/app.js',
    'scripts/auth.js',
    'scripts/supabase.js',
    'scripts/supabase-client.js',
    'scripts/landing.js',
    'scripts/analytics.js',
    'styles/app.css',
    'styles/landing.css',
    'styles/landing-contact.css',
    'styles/landing-gallery.css',
    'styles/analytics-consent.css',
    'assets/favicon.svg',
    'assets/tripcash-hero.jpg',
    '404.html',
    'robots.txt',
    'sitemap.xml',
  ];
  for (const file of required) {
    assert.ok(fs.existsSync(path.join(root, 'dist', file)), `dist/${file} is missing`);
  }
});

test('public pages declare canonical URLs and deployment discovery files are valid', () => {
  const canonicalPages = {
    'index.html': 'https://tripcash.de/',
    'privacy.html': 'https://tripcash.de/privacy',
    'terms.html': 'https://tripcash.de/terms',
    'support.html': 'https://tripcash.de/support',
    'delete-account.html': 'https://tripcash.de/delete-account',
  };

  for (const [file, url] of Object.entries(canonicalPages)) {
    assert.match(read(file), new RegExp(`<link rel="canonical" href="${url.replaceAll('/', '\\/')}"`));
  }

  assert.match(read('404.html'), /<meta name="robots" content="noindex"/);
  assert.match(read('404.html'), /href="\/">Return to TripCash/);
  assert.match(read('robots.txt'), /Sitemap: https:\/\/tripcash\.de\/sitemap\.xml/);
  assert.doesNotMatch(read('robots.txt'), /Disallow: \/$/m);
  assert.match(read('sitemap.xml'), /<loc>https:\/\/tripcash\.de\/<\/loc>/);
  assert.doesNotMatch(read('sitemap.xml'), /admin/);
});

test('public landing page presents the product and safe release actions', () => {
  const html = read('index.html');
  const landing = read('landing.css');

  assert.match(html, /id="features"/);
  assert.match(html, /id="how-it-works"/);
  assert.match(html, /data-action="enter-web-app" data-value="login">Continue on web/);
  assert.doesNotMatch(html, /landing-nav-cta/);
  assert.match(html, /Coming soon to the/);
  assert.match(html, /Coming soon to/);
  assert.match(html, /Vienna Autumn/);
  assert.match(html, /href="privacy\.html"/);
  assert.match(html, /href="terms\.html"/);
  assert.match(html, /href="support\.html"/);
  assert.doesNotMatch(html, /href="#"/);
  assert.match(landing, /\.native-shell \.landing-nav/);
  assert.match(landing, /@media\(max-width:560px\)/);
});

test('web landing and authenticated app use separate routes', () => {
  const html = read('index.html');
  const builtApp = read('dist/app.html');
  const app = read('app.js');
  const auth = read('auth.js');

  assert.match(html, /data-action="enter-web-app" data-value="register"/);
  assert.match(builtApp, /<meta name="robots" content="noindex"/);
  assert.match(builtApp, /<body data-screen="auth">/);
  assert.match(builtApp, /id="screen-auth" class="screen active"/);
  assert.match(html, /<main class="auth-card">/);
  assert.match(html, /class="auth-turnstile" role="group" aria-label="Bot protection"/);
  assert.match(html, /defer src="scripts\/supabase-client\.js/);
  assert.match(app, /const PUBLIC_APP_URL = 'https:\/\/tripcash\.de\/app'/);
  assert.match(app, /function isWebLandingPath\(\)/);
  assert.match(app, /function enterWebApp\(tab = 'login'\)/);
  assert.match(app, /function leaveWebApp\(\)/);
  assert.match(app, /history\.pushState\(null, '', '\/app'\)/);
  assert.match(html, /data-action="leave-web-app" aria-label="Back"/);
  assert.match(app, /moveWebIntentToAppPath/);
  assert.match(auth, /if \(isWebLandingPath\(\)\) \{\s*showScreen\('welcome'\)/);
  assert.match(auth, /if \(invite \|\| isWebAppPath\(\)\) openAuthMode\('login'\)/);
  assert.match(auth, /location\.origin === 'https:\/\/tripcash\.de'/);
});

test('landing legal panels and contact email endpoint are wired safely', () => {
  const html = read('index.html');
  const landing = read('landing.js');
  const contact = read('functions/api/contact.js');
  const privacy = read('privacy.html');

  assert.match(html, /id="landing-contact-form"/);
  assert.match(html, /data-action="open-landing-legal" data-value="privacy"/);
  assert.match(html, /data-action="open-landing-legal" data-value="terms"/);
  assert.match(landing, /fetch\(`\$\{type\}\.html`/);
  assert.match(landing, /fetch\('\/api\/contact'/);
  assert.match(contact, /origin !== 'https:\/\/tripcash\.de'/);
  assert.match(contact, /body\.byteLength > MAX_BODY_BYTES/);
  assert.match(contact, /AbortSignal\.timeout\(UPSTREAM_TIMEOUT_MS\)/);
  assert.match(contact, /clean\(payload\.website\)/);
  assert.match(contact, /RESEND_API_KEY/);
  assert.match(contact, /https:\/\/api\.resend\.com\/emails\/batch/);
  assert.match(contact, /TripCash <website@send\.tripcash\.de>/);
  assert.match(contact, /to: \['support@tripcash\.de'\]/);
  assert.match(contact, /to: \[email\]/);
  assert.match(contact, /We received your TripCash message/);
  assert.match(contact, /Thanks for contacting us/);
  assert.match(html, /id="contact-turnstile"/);
  assert.match(html, /id="contact-turnstile" class="contact-turnstile" role="group"/);
  assert.match(landing, /0x4AAAAAAEm7OArk9r_5yrdA/);
  assert.match(landing, /function scheduleContactTurnstile\(\)/);
  assert.match(landing, /IntersectionObserver/);
  assert.match(landing, /turnstile\.getResponse/);
  assert.match(contact, /TURNSTILE_SECRET_KEY/);
  assert.match(contact, /turnstile\/v0\/siteverify/);
  assert.match(contact, /turnstileResult\.hostname !== 'tripcash\.de'/);
  assert.match(contact, /turnstileResult\.action !== 'contact'/);
  assert.match(contact, /escapeHtml\(message\)/);
  assert.match(landing, /sanitizedLegalContent/);
  assert.doesNotMatch(landing, /content\.innerHTML = legalMarkup/);
  assert.match(privacy, /Other participants may add information about you to a shared trip/);
  assert.match(privacy, /valid invitation link shows the trip name and emoji/);
  assert.match(privacy, /Supabase.*provides database and authentication services/);
  assert.match(privacy, /Cloudflare.*hosts and protects TripCash/);
  assert.match(privacy, /Resend and authentication email providers/);
  assert.match(privacy, /An exchange-rate provider/);
  assert.match(privacy, /OpenAI.*processes a receipt image only when you request a scan/);
  assert.match(privacy, /TripCash does not save the image/);
  assert.match(privacy, /pending offline changes/);
  assert.match(privacy, /Cloudflare Web Analytics provides cookie-free, aggregated performance measurements/);
  assert.match(privacy, /Google Analytics runs only if you allow optional analytics/);
  assert.match(privacy, /Data controller: Shkelqim Surkishi\./);
  assert.doesNotMatch(privacy, /Kosovo/);
  assert.match(privacy, /require providers to protect personal data consistently with this Policy and applicable law/);
  assert.match(privacy, /data-analytics-preferences/);
  assert.doesNotMatch(privacy, /does not use advertising or analytics cookies/);
  assert.doesNotMatch(privacy, /Netlify/);
});

test('professional email templates and activation instructions are present', () => {
  const confirmation = read('supabase/email-templates/confirmation.html');
  const recovery = read('supabase/email-templates/recovery.html');
  const welcome = read('supabase/email-templates/welcome.html');
  const magicLink = read('supabase/email-templates/magic-link.html');
  const setup = read('EMAIL_SETUP.md');

  assert.doesNotMatch(confirmation, /\.ConfirmationURL/);
  assert.match(confirmation, /\.Token/);
  assert.match(confirmation, /\{\{ \.Token \}\}/);
  assert.match(confirmation, /Confirm your email/);
  assert.match(recovery, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(welcome, /Welcome to TripCash/);
  assert.match(magicLink, /\.Token/);
  assert.match(magicLink, /\.ConfirmationURL/);
  assert.match(magicLink, /%c%c%c-%c%c%c/);
  assert.match(setup, /custom SMTP/);
  assert.match(setup, /SPF and DKIM/);
  assert.match(setup, /must be idempotent/);
  assert.match(setup, /CONTACT_FROM_EMAIL/);
  for (const file of [
    'invite.html',
    'magic-link.html',
    'email-change.html',
    'reauthentication.html',
    'password-changed.html',
    'email-changed.html',
    'identity-changed.html',
  ]) {
    assert.ok(fs.existsSync(path.join(root, 'supabase', 'email-templates', file)), `${file} is missing`);
  }
  const welcomeEndpoint = read('functions/api/welcome.js');
  assert.match(welcomeEndpoint, /claim_welcome_email/);
  assert.match(welcomeEndpoint, /Idempotency-Key/);
  assert.match(welcomeEndpoint, /email_confirmed_at/);
  assert.match(read('SUPABASE_TRANSACTIONAL_EMAIL.sql'), /complete_welcome_email/);
  assert.match(read('schema.sql'), /welcome_email_sent_at timestamptz/);
});

test('public landing bundles theme-aware Android demo screenshots', () => {
  const html = read('index.html');
  const gallery = read('landing-gallery.css');
  assert.match(html, /id="screenshots"/);
  assert.doesNotMatch(html, /href="#screenshots"/);
  assert.match(html, /data-action="open-landing-screenshot"/);
  assert.match(html, /id="landing-screenshot-dialog"/);
  assert.match(gallery, /\.screenshot-grid\s*\{/);
  assert.doesNotMatch(gallery, /scroll-snap-type/);
  assert.match(gallery, /aspect-ratio:\s*9\s*\/\s*20/);
  assert.match(gallery, /border:\s*6px solid #102b2a/);
  for (const view of ['trips', 'upcoming', 'expenses', 'balances', 'analytics', 'trip-analytics']) {
    for (const theme of ['light', 'dark']) {
      const asset = `assets/screenshots/android/${theme}/tripcash-${view}.webp`;
      const storeSource = `assets/store/android/screenshots/${theme}/tripcash-${view}.png`;
      assert.match(html, new RegExp(asset.replaceAll('/', '\\/')));
      assert.ok(fs.existsSync(path.join(root, 'dist', asset)), `${asset} missing from dist`);
      assert.ok(fs.existsSync(path.join(root, 'web', asset)), `${asset} source screenshot is missing`);
      assert.ok(fs.existsSync(path.join(root, storeSource)), `${storeSource} full-resolution source is missing`);
      assert.ok(
        !fs.existsSync(path.join(root, 'dist', asset.replace(/\.webp$/, '.png'))),
        `${asset} should be the only deployed format`,
      );
    }
  }
});

test('release-critical account controls are present', () => {
  const html = read('index.html');
  const auth = read('auth.js');
  const app = read('app.js');

  assert.match(html, /id="btn-delete-account"/);
  assert.match(html, /id="delete-account-email"/);
  assert.match(app, /\/api\/account-closure/);
  assert.match(read('functions/api/receipt-scan.js'), /OPENAI_API_KEY/);
  assert.match(read('functions/api/receipt-scan.js'), /input_image/);
  assert.match(read('functions/api/receipt-scan.js'), /store: false/);
  assert.match(app, /confirmationEmail/);
  assert.match(html, /id="form-change-email"/);
  assert.match(app, /updateUser\([\s\S]*email: newEmail/);
  assert.match(app, /emailRedirectTo/);
  assert.match(app, /data-action="export-account-data"/);
  assert.match(app, /function exportAccountData\(\)/);
  assert.match(html, /data-action="delete-account-data"/);
  assert.match(app, /db\.rpc\('delete_current_user_data'\)/);
  assert.match(app, /data-section="email"[\s\S]*Change email/);
  assert.match(app, /data-section="data-delete"[\s\S]*Delete my data/);
  assert.match(app, /data-section="account-delete"[\s\S]*Delete account/);
  assert.match(html, /id="settings-profile"/);
  assert.match(html, /id="settings-data-delete"/);
  assert.match(html, /id="settings-close"/);
  assert.match(app, /panel\.hidden = id !== panelIds\[requestedSection\]/);
  assert.match(html, /id="register-status"/);
  assert.match(html, /id="register-feedback"/);
  assert.match(html, /data-action="reset-registration"/);
  assert.match(auth, /Check your inbox for the confirmation code/);
  assert.match(auth, /verifyOtp\(\{ email: pendingSignupEmail, token, type: 'signup' \}\)/);
  assert.match(auth, /type: 'signup'/);
  assert.match(auth, /This email may already have an account or be awaiting confirmation/);
  assert.match(auth, /form\.hidden = completed/);
  assert.match(read('schema.sql'), /create or replace function public\.delete_current_user_data\(\)/i);
  assert.match(read('schema.sql'), /grant execute on function public\.delete_current_user_data\(\) to authenticated/i);
  assert.match(read('functions/api/account-closure.js'), /delete_user_by_id/);
  assert.match(read('schema.sql'), /grant usage on schema public to anon, authenticated, service_role;/);
  assert.match(read('functions/api/account-closure.js'), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(
    read('functions/api/account-closure.js'),
    /Authorization: `Bearer \$\{env\.SUPABASE_SERVICE_ROLE_KEY\}`/,
  );
  assert.match(read('functions/api/account-closure.js'), /tripcash-account-closed-/);
  assert.match(read('functions/api/account-closure.js'), /\/auth\/token[\s\S]*\/auth\/revoke/);
  assert.match(app, /requestAppleDeletionAuthorization/);
  assert.match(app, /function requestAccountClosure\(data\)/);
  assert.match(app, /CapacitorHttp[\s\S]*account-closure/);
  assert.match(app, /Origin: 'capacitor:\/\/localhost'/);
  assert.match(app, /function isAppleAccount\(user\)/);
  assert.match(app, /appleAccount \? 'btn-delete-account' : 'delete-account-email'/);
  assert.match(app, /closure\.code === 'reauthentication_required'/);
  assert.match(app, /resumePendingAccountDeletion\(user\)/);
  assert.match(
    read('functions/api/account-closure.js'),
    /!emailConfirmed && !verifiedAppleAuthorization && !appleSessionConfirmed/,
  );
  assert.ok(fs.existsSync(path.join(root, 'supabase', 'email-templates', 'account-closed.html')));
  assert.match(read('support.html'), /href="delete-account\.html"/);
  assert.match(read('delete-account.html'), /support@tripcash\.de/);
  assert.match(html, /class="auth-forgot"/);
  assert.match(auth, /resetPasswordForEmail/);
  assert.match(auth, /function openChangePassword\(\)/);
  assert.match(auth, /password: currentPassword/);
  assert.match(app, /Change password/);
  assert.match(html, /id="current-password"/);
  assert.match(auth, /emailRedirectTo/);
  assert.match(auth, /https:\/\/tripcash\.de\/auth-callback/);
  assert.match(auth, /password\.length >= 8/);
  const passwordPolicy = auth.slice(
    auth.indexOf('function isStrongPassword'),
    auth.indexOf('function userHasPasswordIdentity'),
  );
  assert.match(passwordPolicy, /\[A-Za-z\]/);
  assert.match(passwordPolicy, /\\d/);
  assert.match(html, /id="reg-pass"[^>]*minlength="8"/);
  assert.match(html, /id="new-password"[^>]*minlength="8"/);
  assert.match(read('supabase/config.toml'), /minimum_password_length = 8/);
  assert.match(read('supabase/config.toml'), /password_requirements = "letters_digits"/);
  assert.match(read('supabase.js'), /flowType: 'pkce'/);
  assert.match(auth, /Guest trips cannot be recovered after signing out/);
  assert.match(auth, /event === 'PASSWORD_RECOVERY'/);
  assert.match(auth, /setPasswordRecoveryPending\(true\)/);
  assert.match(auth, /localStorage\.getItem\(PASSWORD_RECOVERY_KEY\)/);
  assert.match(auth, /if \(passwordRecoveryPending\(\)\) \{\s*openPasswordRecoveryGate\(\);\s*return;/);
  assert.match(auth, /async function cancelPasswordRecovery\(\)/);
  assert.match(auth, /await db\.auth\.signOut\(\)/);
  assert.match(app, /window\._passwordRecoveryPending.*name = 'auth'/);
  assert.match(app, /modal-new-password.*window\._passwordRecoveryPending/);
  assert.match(html, /id="btn-cancel-password-recovery"/);
  assert.match(read('supabase.js'), /callbackType === 'recovery'.*tc-password-recovery-pending/);
  assert.match(auth, /updateUser\(\s*completingGuestUpgrade/);
  assert.match(html, /href="privacy\.html"/);
  assert.match(html, /href="terms\.html"/);
  assert.match(html, /href="support\.html"/);
});

test('Apple revocation uses a fresh native authorization and stores no provider token', () => {
  const schema = read('schema.sql');
  const migration = read('SUPABASE_REMOVE_APPLE_REVOCATION_STORAGE.sql');
  const closure = read('functions/api/account-closure.js');
  const appDelegate = read('ios/App/App/AppDelegate.swift');
  const entitlements = read('ios/App/App/App.entitlements');

  assert.doesNotMatch(schema, /apple_revocation_tokens/i);
  assert.match(migration, /drop table if exists public\.apple_revocation_tokens/i);
  assert.match(migration, /drop function if exists public\.store_apple_revocation_token/i);
  assert.match(migration, /drop function if exists public\.get_apple_revocation_token/i);
  assert.match(closure, /appleAuthorizationCode/);
  assert.match(closure, /identityTokenSubject\(tokens\?\.id_token\) !== appleSubject/);
  assert.match(closure, /APPLE_PRIVATE_KEY/);
  assert.match(closure, /APPLE_CLIENT_ID/);
  assert.match(closure, /APPLE_KEY_ID/);
  assert.match(closure, /APPLE_TEAM_ID/);
  assert.doesNotMatch(closure, /APPLE_TOKEN_ENCRYPTION_KEY|AES-GCM/);
  assert.match(appDelegate, /ASAuthorizationAppleIDProvider/);
  assert.match(appDelegate, /AppleReauthPlugin/);
  assert.match(entitlements, /com\.apple\.developer\.applesignin/);
});

test('native iOS Apple login exchanges a nonce-bound identity token without opening a browser', () => {
  const auth = read('auth.js');
  const appDelegate = read('ios/App/App/AppDelegate.swift');

  assert.match(auth, /nativePlatform === 'ios' && provider === 'apple'/);
  assert.match(auth, /AppleReauth/);
  assert.match(auth, /await apple\.signIn\(\)/);
  assert.match(
    auth,
    /signInWithIdToken\(\{\s*provider: 'apple',\s*token: authorization\.identityToken,\s*nonce: authorization\.nonce/s,
  );
  assert.match(auth, /sequence !== authSessionSequence/);
  assert.match(auth, /if \(initialSessionRefreshPromise\) await initialSessionRefreshPromise/);
  assert.match(auth, /isAnonymousAuthUser\(data\.user\)/);
  assert.match(auth, /app_metadata\?\.provider === 'apple'/);
  assert.match(auth, /identities\?\.some\(identity => identity\?\.provider === 'apple'\)/);
  assert.match(auth, /Boolean\(existing\.is_anonymous\) !== expectedAnonymous/);
  assert.match(auth, /user\.is_anonymous === true/);
  assert.match(auth, /Boolean\(\s*existing\.is_anonymous\)\s+&&\s+!expectedAnonymous/);
  assert.match(read('app.js'), /banner\.hidden = !isAnonymousAuthUser\(user\)/);
  assert.match(appDelegate, /CAPPluginMethod\(name: "signIn"/);
  assert.match(appDelegate, /request\.requestedScopes = \[\.fullName, \.email\]/);
  assert.match(appDelegate, /request\.nonce = sha256\(nonce\)/);
  assert.match(appDelegate, /SecRandomCopyBytes/);
  assert.match(appDelegate, /SHA256\.hash/);
});

test('Supabase migration enforces payment, settlement, and leave-trip safety', () => {
  const migration = read('SUPABASE_REMAINING_MIGRATION.sql');
  const app = read('app.js');

  assert.match(migration, /create unique index if not exists idx_settlements_trip_day_unique/i);
  assert.match(migration, /create policy "payments_insert"/i);
  assert.match(migration, /m\.user_id = auth\.uid\(\)/);
  assert.match(migration, /create or replace function public\.leave_trip/i);
  assert.match(migration, /cannot leave with an unpaid balance/i);
  assert.match(migration, /revoke all on function public\.leave_trip\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.leave_trip\(uuid\) to authenticated/i);
  assert.match(migration, /revoke all on public\.profiles[\s\S]*from anon, authenticated/i);
  assert.match(migration, /grant update \(display_name, username, avatar_url, paypal_link, is_anonymous\)/i);
  assert.match(migration, /new\.is_admin := false/i);
  assert.match(migration, /new\.creator_id := old\.creator_id/i);
  assert.match(migration, /drop policy if exists "expenses_update"/i);
  assert.match(migration, /revoke all on public\.auth_logs from anon, authenticated/i);
  assert.match(migration, /using \(public\.is_trip_creator\(trip_id\)\);/i);
  assert.match(migration, /using \(user_id is null and public\.is_trip_creator\(trip_id\)\);/i);
  assert.doesNotMatch(migration, /grant all on public\./i);
  assert.match(app, /db\.rpc\('leave_trip', \{ p_trip_id: currentTrip\.id \}\)/);
});

test('Security Stage 2 migration enforces read-only history and server-side payment integrity', () => {
  const migration = read('SUPABASE_SECURITY_HARDENING.sql');
  const app = read('app.js');
  const contact = read('functions/api/contact.js');

  assert.match(migration, /create or replace function public\.validate_payment/i);
  assert.match(migration, /create or replace function public\.validate_expense_split/i);
  assert.match(migration, /Payment exceeds the outstanding balance/i);
  assert.match(migration, /Expense splits cannot exceed the expense amount/i);
  assert.match(migration, /split_type in \('equal', 'exact'\)/i);
  assert.match(migration, /Settled days are read-only/i);
  assert.match(migration, /Ended trips are read-only/i);
  assert.match(migration, /t\.status = 'active'/i);
  assert.match(migration, /create or replace function public\.is_trip_joinable/i);
  assert.match(migration, /public\.is_trip_joinable\(trip_id\)/i);
  assert.match(migration, /update public\.trips set status = 'ended'/i);
  assert.match(migration, /revoke all on function public\.validate_payment\(\)/i);
  assert.match(app, /r\.map\(csvCell\)/);
  assert.match(app, /\^\[\\t\\r\\n\]\*\[=\+\\-@\]/);
  assert.match(
    app,
    /ended \? '' : '<button class="btn btn-secondary btn-auto btn-sm" data-action="open-edit-trip-modal">Edit trip<\/button>'/,
  );
  assert.match(app, /currentTrip\.status === 'ended'/);
  assert.match(contact, /cleanHeader/);
  assert.match(contact, /\\u0000-\\u001f\\u007f/);
});

test('Security Stage 1 uses expiring invites, trusted activity and admin MFA', () => {
  const migration = read('SUPABASE_SECURITY_STAGE_1.sql');
  const app = read('app.js');
  const auth = read('auth.js');
  const supabase = read('supabase.js');
  assert.match(migration, /create table if not exists public\.trip_invites/i);
  assert.match(migration, /create or replace function public\.accept_trip_invite/i);
  assert.match(migration, /drop policy if exists "activity_log_insert"/i);
  assert.match(migration, /create or replace function public\.log_trip_change/i);
  assert.match(migration, /auth\.jwt\(\) ->> 'aal'.*aal2/i);
  assert.match(app, /db\.rpc\('accept_trip_invite'/);
  assert.doesNotMatch(app, /from\('activity_log'\)\.insert/);
  assert.match(
    auth,
    /signInWithPassword\(\{\s*email: window\._currentUser\?\.email \|\| '',\s*password: currentPassword,\s*options: \{ captchaToken \},?\s*\}\)/,
  );
  assert.match(supabase, /flowType: 'pkce'/);
});

test('Security Stage 2 hardens API, legal content and admin error boundaries', () => {
  const contact = read('functions/api/contact.js');
  const welcome = read('functions/api/welcome.js');
  const landing = read('landing.js');
  const admin = read('admin.js');
  const auth = read('auth.js');
  const app = read('app.js');

  assert.match(contact, /request\.arrayBuffer\(\)/);
  assert.match(contact, /turnstileToken\.length < 20/);
  assert.match(welcome, /AbortSignal\.timeout\(UPSTREAM_TIMEOUT_MS\)/);
  assert.equal(welcome.includes('.replace(/[\\u0000-\\u001f\\u007f]+/g'), true);
  assert.match(landing, /LEGAL_TAGS/);
  assert.match(admin, /safeAdminQrCode/);
  assert.match(admin, /Array\.isArray\(statsRes\.data\.trips\)/);
  assert.doesNotMatch(auth, /console\.(?:log|warn|error|debug)/);
  assert.doesNotMatch(app, /console\.(?:log|warn|error|debug)/);
  assert.doesNotMatch(auth, /Math\.random/);
  assert.match(app, /MAX_EXPENSE_AMOUNT = 99999999\.99/);
  assert.match(app, /budget > MAX_TRIP_BUDGET/);
  assert.match(app, /originalAmount > MAX_EXPENSE_AMOUNT/);
});

test('Security Stage 3 minimizes callback, local-storage and native file exposure', () => {
  const auth = read('auth.js');
  const supabase = read('supabase.js');
  const callback = read('auth-callback.js');
  const filePaths = read('android/app/src/main/res/xml/file_paths.xml');

  assert.match(supabase, /function safeAuthCallbackSuffix/);
  assert.match(supabase, /callback\.href\.length > 4096 \|\| callback\.hash/);
  assert.doesNotMatch(supabase, /sb-\$\{SUPABASE_REF\}-auth-token/);
  assert.match(
    callback,
    /const allowed = new Set\(\['code', 'error', 'error_code', 'error_description', 'type', 'intent'\]\)/,
  );
  assert.match(
    supabase,
    /const allowed = new Set\(\['code', 'error', 'error_code', 'error_description', 'type', 'intent'\]\)/,
  );
  assert.match(auth, /showSignupConfirmationIfNeeded/);
  assert.match(auth, /const emailRedirectTo = nativeOrWebAuthRedirect\(\);/);
  assert.match(auth, /freshSignupCallback/);
  assert.match(supabase, /authCallbackHadCodeAtBoot/);
  assert.match(read('index.html'), /id="modal-email-confirmed"/);
  assert.match(auth, /TripCashOffline\?\.clearQueue\(userId\)/);
  assert.match(auth, /localStorage\.removeItem\(`\$\{PROFILE_CACHE_PREFIX\}\$\{userId\}`\)/);
  assert.doesNotMatch(filePaths, /external-path/);
  assert.match(filePaths, /cache-path/);
  assert.match(filePaths, /<external-files-path name="tripcash_camera_pictures" path="Pictures\/"/);
});

test('Security correction pass enforces atomic expenses and release supply-chain controls', () => {
  const schema = read('schema.sql');
  const migration = read('SUPABASE_SECURITY_STAGE_1.sql');
  const app = read('app.js');
  const offline = read('offline.js');
  const workflow = read('.github/workflows/ci.yml');
  const gradle = read('android/app/build.gradle');
  const wrapper = read('android/gradle/wrapper/gradle-wrapper.properties');
  const contact = read('functions/api/contact.js');

  for (const sql of [schema, migration]) {
    assert.match(
      sql,
      /create or replace function public\.create_expense_with_splits\(p_expense jsonb, p_splits jsonb\)/i,
    );
    assert.match(sql, /Expense splits must exactly match the expense amount/i);
    assert.match(sql, /revoke insert on public\.expenses, public\.expense_splits from authenticated/i);
    assert.match(sql, /grant execute on function public\.create_expense_with_splits\(jsonb, jsonb\) to authenticated/i);
  }
  assert.match(app, /function: 'create_expense_with_splits'/);
  assert.match(offline, /step\.method === 'rpc'/);
  assert.match(workflow, /gitleaks\/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e/);
  assert.match(gradle, /minifyEnabled true/);
  assert.match(gradle, /shrinkResources true/);
  assert.match(wrapper, /distributionSha256Sum=ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c/);
  assert.match(contact, /CONTACT_RATE_LIMITER\.limit/);
  assert.match(contact, /'Idempotency-Key'/);
});

test('receipt scanning consumes an authenticated database quota before contacting OpenAI', () => {
  const schema = read('schema.sql');
  const migration = read('SUPABASE_RECEIPT_SCAN_RATE_LIMIT.sql');
  const scanner = read('functions/api/receipt-scan.js');

  for (const sql of [schema, migration]) {
    assert.match(sql, /create (table if not exists|table) public\.receipt_scan_limits/i);
    assert.match(sql, /create or replace function public\.consume_receipt_scan_quota\(\)/i);
    assert.match(sql, /security definer/i);
    assert.match(sql, /if auth\.uid\(\) is null then raise exception 'Authentication required'/i);
    assert.match(sql, /request_count < 8/i);
    assert.match(sql, /grant execute on function public\.consume_receipt_scan_quota\(\) to authenticated/i);
  }
  assert.match(scanner, /rest\/v1\/rpc\/consume_receipt_scan_quota/);
  assert.match(scanner, /Too many receipt scans/);
  assert.doesNotMatch(scanner, /RECEIPT_SCANNING_ENABLED|RECEIPT_SCAN_RATE_LIMITER/);
});

test('verified HTTPS auth callback association files are included in web builds', () => {
  const callback = read('auth-callback.js');
  const appleAssociation = read('.well-known/apple-app-site-association');
  const androidAssociation = read('.well-known/assetlinks.json');

  assert.match(callback, /https:\/\/tripcash\.de/);
  assert.match(callback, /\/auth-callback/);
  assert.match(appleAssociation, /945267LMP6\.com\.tripcash\.app/);
  assert.match(androidAssociation, /com\.tripcash\.app/);
  assert.equal(fs.existsSync(path.join(root, 'dist', 'auth-callback.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'dist', 'scripts', 'auth-callback.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'dist', '.well-known', 'apple-app-site-association')), true);
  assert.equal(fs.existsSync(path.join(root, 'dist', '.well-known', 'assetlinks.json')), true);
});

test('every client table enables RLS and the bundle escapes stored display values', () => {
  const sql = read('schema.sql');
  const app = read('app.js');
  const admin = read('admin.js');
  const tables = [
    'profiles',
    'contacts',
    'trips',
    'trip_members',
    'trip_invites',
    'members',
    'expenses',
    'expense_splits',
    'settlements',
    'payments',
    'activity_log',
    'receipt_scan_limits',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.doesNotMatch(sql, /grant all on public\./i);
  assert.match(app, /trip-emoji">\$\{esc\(t\.emoji/);
  assert.match(app, /const paypalUrl = normalizePaypalLink\(m\.paypal_link\)/);
  assert.match(admin, /\$\{esc\(t\.emoji \|\| '✈️'\)\}/);
});

test('English-only UI reserves configured social providers in the initial auth layout', () => {
  const html = read('index.html');
  const auth = read('auth.js');

  assert.doesNotMatch(html, /id="lang-toggle"/);
  assert.doesNotMatch(html, /Enable providers in Supabase/);
  assert.match(html, /data-social-provider="apple">[\s\S]*?Continue with Apple<\/button>/);
  assert.match(html, /data-social-provider="google">[\s\S]*?Continue with Google<\/button>/);
  assert.match(auth, /const availableSocialProviders = new Set\(\['apple', 'google'\]\)/);
});

test('iOS handoff navigation and required frontend destinations are bundled', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('style.css');

  assert.match(html, /id="app-bottom-nav"/);
  assert.match(html, /id="screen-global-analytics"/);
  assert.match(html, /id="trip-bottom-nav"/);
  for (const label of ['Trips', 'Analytics', 'Profile']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /data-tab="expenses"[\s\S]*?>Expenses</);
  assert.match(html, /data-tab="members"[\s\S]*?>Balances</);
  assert.doesNotMatch(html, /data-tab="overview"/);
  assert.doesNotMatch(html, /data-tab="analytics"/);
  assert.doesNotMatch(html, /data-tab="activity"/);
  assert.doesNotMatch(html, /data-nav="add"/);
  assert.doesNotMatch(html, /class="tabs"/);
  for (const fn of [
    'renderOverviewTab',
    'renderExpensesTab',
    'renderAnalyticsTab',
    'renderMembersTab',
    'renderProfileScreen',
  ]) {
    assert.match(app, new RegExp(`function ${fn}\\(`));
  }
  assert.match(html, /id="screen-expense"/);
  assert.equal((html.match(/class="mobile-shell-header"/g) || []).length, 3);
  assert.match(html, /id="expense-category-grid"/);
  assert.match(html, /id="expense-payer-chips"/);
  assert.match(css, /\.trip-bottom-nav \{ grid-template-columns:repeat\(5/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /body\[data-screen="expense"\].*overflow:hidden/);
  assert.match(css, /\.insight-stack \{ grid-template-columns:repeat\(2/);
  assert.match(app, /_myTotal/);
  assert.match(app, /You spent/);
  assert.match(app, /expense\.paid_by === me\.id/);
});

test('new expenses use only equal or exact splits and bilingual category suggestions', () => {
  const html = read('index.html');
  const app = read('app.js');

  assert.match(html, /data-type="equal"/);
  assert.match(html, /data-type="exact"/);
  assert.doesNotMatch(html, /data-type="percent"/);
  assert.doesNotMatch(html, /data-type="shares"/);
  assert.match(app, /\['equal', 'exact'\]\.includes/);
  assert.match(app, /normalizeCategoryText/);
  assert.match(app, /expenseCategoryManuallySelected/);
  assert.match(app, /'naft'/);
  assert.match(app, /'banesa'/);
  assert.match(app, /'kafe'/);
  assert.match(app, /'dreke'/);
  assert.match(app, /word\.startsWith\(keyword\)/);
  assert.match(app, /other:\s+\['qadra'/);
  assert.match(app, /bilete treni/);
  assert.match(app, /bilete muzeu/);
  assert.match(app, /function neutralMemberAvatar\(member\)/);
  assert.match(app, /class="split-member-name"/);
  assert.doesNotMatch(app, /formatMoney\(expSplitChecked/);
  assert.doesNotMatch(app, /splitType === 'percent'/);
  assert.doesNotMatch(app, /splitType === 'shares'/);
});

test('money inputs accept dot and comma decimals on iOS keyboards', () => {
  const html = read('index.html');
  const app = read('app.js');

  for (const id of ['trip-budget', 'exp-amount', 'payment-amount']) {
    assert.match(html, new RegExp(`id="${id}"[^>]+type="text"[^>]+inputmode="decimal"`));
  }
  assert.match(app, /function parseMoneyInput\(value\)/);
  assert.match(app, /replace\(',', '\.'\)/);
  assert.match(app, /const originalAmount = parseMoneyInput\(/);
  assert.match(app, /const amount = parseMoneyInput\(document\.getElementById\('payment-amount'\)/);
  assert.match(app, /inputmode="decimal"[^>]+class="split-person-input"/);
});

test('members can delete their own unsettled expenses and narrow desktop expense forms wheel-scroll', () => {
  const app = read('app.js');
  const css = read('style.css');

  assert.match(app, /isCreator \|\| e\.created_by === window\._currentUser\?\.id/);
  assert.match(css, /@media \(hover:hover\) and \(pointer:fine\)/);
  assert.match(css, /\.expense-screen \{ height:100dvh; min-height:0; overflow-x:hidden; overflow-y:auto; \}/);
  assert.match(css, /\.member-row > div:last-child \{ grid-column:1\/-1/);
});

test('social sign-in states the age and Terms requirement without a checkbox', () => {
  const html = read('web/pages/index.html');
  const auth = read('web/scripts/auth.js');

  assert.match(
    html,
    /<p id="social-terms-notice" class="social-terms-notice">By continuing with Apple or Google, you confirm that you are at least 16 and agree to the <a href="terms\.html">Terms of Use<\/a> and <a href="privacy\.html">Privacy Policy<\/a>\.<\/p>/,
  );
  assert.doesNotMatch(html, /id="social-terms"/);
  assert.doesNotMatch(auth, /getElementById\('social-terms'\)/);
  // Email signup keeps its explicit age and Terms checkbox.
  assert.match(html, /<input id="reg-terms" type="checkbox" required>/);
});

test('admin page signs in separately from the app', () => {
  const html = read('admin.html');
  const client = read('web/scripts/admin-client.js');
  const admin = read('admin.js');
  const css = read('web/styles/app.css');

  // A separate client and storage key keep app and admin sessions independent.
  assert.match(
    html,
    /<script src="scripts\/admin-client\.js"><\/script>\s*<script src="scripts\/admin\.js"><\/script>/,
  );
  assert.doesNotMatch(html, /scripts\/supabase\.js/);
  assert.match(client, /storageKey: ADMIN_AUTH_STORAGE_KEY/);
  assert.match(client, /const ADMIN_AUTH_STORAGE_KEY = 'tripcash-admin-auth';/);
  assert.match(client, /storage: window\.sessionStorage/);
  assert.match(admin, /signInWithPassword\(\{ email, password, options: \{ captchaToken \} \}\)/);
  assert.match(admin, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(admin, /const ADMIN_IDLE_LIMIT_MS = 15 \* 60 \* 1000;/);
  assert.match(admin, /addEventListener\(type, resetAdminIdleTimer, \{ capture: true, passive: true \}\)/);
  assert.match(admin, /signOutAdmin\('This account does not have admin access\.'\)/);
  assert.doesNotMatch(admin, /You must be logged in/);
  assert.match(admin, /Connect your authenticator/);
  assert.match(admin, /Can’t scan the QR code\?/);
  assert.match(admin, /placeholder="123 456"/);
  assert.match(admin, /navigator\.clipboard\.writeText\(secret\)/);
  assert.match(css, /\.admin-mfa-qr-frame[^}]*background:#fff/);
});

test('website trip workspace stays single-column at tablet widths', () => {
  const shellCss = read('web/styles/web-shell.css');
  const redesignLayout = shellCss.indexOf(
    '.web-redesign .web-workspace-layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr);',
  );
  const tabletOverride = shellCss.search(
    /@media \(min-width: 761px\) and \(max-width: 980px\) \{\s*\.web-redesign \.web-workspace-layout \{ grid-template-columns: minmax\(0, 1fr\); \}\s*\.web-redesign \.web-workspace-rail \{ position: static; \}/,
  );

  // The redesign's two-column rule overrode the earlier tablet rule by source order,
  // squeezing the summary rail into two ~130px columns at 761-980px.
  assert.ok(redesignLayout > 0);
  assert.ok(tabletOverride > redesignLayout);
});

test('native layouts stay single-column inside the 720px native content cap', () => {
  const nativeCss = read('web/styles/native-redesign.css');

  // Viewport breakpoints pick two columns on 13-inch iPads, but native content is
  // capped at 720px, which squeezed member names and analytics labels.
  assert.match(nativeCss, /max-width: 720px/);
  assert.match(
    nativeCss,
    /body\.native-redesign :is\(\.members-layout, \.analytics-grid, \.global-analytics-grid\) \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
});

test('category amounts size to their content instead of wrapping in a fixed column', () => {
  const appCss = read('web/styles/app.css');

  // A fixed 82px amount column wrapped totals such as "EUR 2,391.89" above phone widths.
  assert.match(appCss, /\.category-list-row \{ display:grid; grid-template-columns:32px minmax\(0,1fr\) auto auto;/);
  assert.match(appCss, /\.category-list-row small,\.category-list-row strong \{ white-space:nowrap; \}/);
  assert.doesNotMatch(appCss, /\.category-list-row \{[^}]*82px/);
});

test('native build excludes web deployment and admin-only files', () => {
  const buildScript = read('scripts/build-web.mjs');
  const pkg = JSON.parse(read('package.json'));

  assert.match(buildScript, /nativeBuild && entry\.name === 'admin\.html'/);
  assert.match(
    buildScript,
    /nativeBuild && \['admin\.js', 'admin-client\.js', 'analytics\.js', 'web-shell\.js'\]\.includes\(entry\.name\)/,
  );
  assert.match(buildScript, /analytics-consent\.css/);
  assert.match(buildScript, /native-redesign\.css/);
  assert.match(buildScript, /native-redesign\.js/);
  assert.match(buildScript, /nativeBuild && \['_headers', '\.well-known'\]\.includes\(entry\.name\)/);
  assert.match(buildScript, /process\.argv\.includes\('--native'\)/);
  assert.match(pkg.scripts['build:native'], /--native/);
  assert.match(pkg.scripts['cap:sync:ios'], /npm run build:native/);
  assert.match(pkg.scripts['cap:sync:ios'], /fix-ios-package-paths\.mjs/);
  assert.match(pkg.scripts['cap:sync:android'], /npm run build:native/);
  assert.match(pkg.scripts['cap:sync:ios'], /npm run build$/);
  assert.match(pkg.scripts['cap:sync:android'], /npm run build$/);
});

test('native web assets are versioned so iOS updates do not reuse stale UI code', () => {
  const html = read('index.html');

  for (const asset of [
    'styles/app.css',
    'scripts/supabase-client.js',
    'scripts/supabase.js',
    'scripts/app.js',
    'scripts/auth.js',
  ]) {
    assert.match(html, new RegExp(`${asset.replace('.', '\\.')}\\?v=`));
  }
});

test('native iOS prevents sticky focus zoom without disabling website zoom', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('style.css');

  assert.doesNotMatch(html, /user-scalable=no/);
  assert.match(app, /function configureNativeShell\(\)/);
  assert.match(app, /platform !== 'ios'/);
  assert.match(app, /maximum-scale=1\.0, user-scalable=no/);
  assert.match(css, /\.split-person-input[^}]*font-size:16px!important/);
  assert.doesNotMatch(css, /\.split-person-input[^}]*font-size:(?:[0-9]|1[0-5])px!important/);
});

test('native iOS scrolling stays elastic and pull-to-refresh preserves offline synchronization', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('style.css');

  assert.match(html, /id="native-refresh-indicator"/);
  assert.match(app, /const NATIVE_REFRESH_THRESHOLD = 180/);
  assert.match(app, /const NATIVE_REFRESH_MIN_PULL_MS = 320/);
  assert.doesNotMatch(app, /NATIVE_REFRESH_MAX_START_Y/);
  assert.match(app, /function configureNativePullToRefresh\(\)/);
  assert.match(app, /await syncPendingOfflineChanges\(\)/);
  assert.match(app, /navigator\.onLine === false/);
  assert.match(app, /await openTrip\(currentTrip\.id\)/);
  assert.match(app, /await refreshTrips\(\)/);
  assert.match(css, /\.native-ios body[\s\S]*overscroll-behavior-y:auto/);
  assert.match(css, /\.native-android #screen-profile\.active/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
});

test('invite links always use the canonical custom domain, including on native iOS', () => {
  const app = read('app.js');

  assert.match(app, /const PUBLIC_APP_URL = 'https:\/\/tripcash\.de\/app'/);
  assert.match(app, /`\$\{PUBLIC_APP_URL\}\?invite=\$\{encodeURIComponent\(currentInviteToken\)\}`/);
  assert.doesNotMatch(app, /location\.origin\}\$\{location\.pathname\}\?invite=/);
});

test('guest upgrades verify the linked email before setting a password', () => {
  const auth = read('auth.js');
  const html = read('index.html');

  assert.match(auth, /guest_upgrade_pending: true/);
  assert.match(auth, /emailRedirectTo \? \{ emailRedirectTo \} : undefined/);
  assert.match(auth, /session\.user\.email && session\.user\.user_metadata\?\.guest_upgrade_pending/);
  assert.match(auth, /guest_upgrade_pending: false/);
  assert.match(auth, /update\(\{ is_anonymous: false \}\)/);
  assert.doesNotMatch(html, /id="upgrade-pass"/);
  assert.match(html, />Send verification email</);
  assert.match(auth, /Unable to use this address\. If you already have an account/);
  assert.doesNotMatch(auth, /An account with this email already exists/);
});

test('trip planning fields are wired through UI and Supabase schema', () => {
  const html = read('index.html');
  const app = read('app.js');
  const sql = read('schema.sql');

  for (const id of ['trip-budget', 'trip-start-date', 'trip-end-date']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const column of ['budget', 'start_date', 'end_date']) {
    assert.match(app, new RegExp(`\\b${column}\\b`));
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(app, /openEditTripModal/);
});

test('account-deletion SQL has restricted execution permissions', () => {
  const sql = read('schema.sql');

  assert.match(sql, /delete from auth\.users/);
  assert.match(sql, /revoke all on all functions in schema public from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.delete_current_user\(\) to authenticated/);
  assert.match(sql, /grant execute on function public\.delete_user_by_id\(uuid\) to service_role/);
  assert.doesNotMatch(sql, /auth\.jwt\(\)[\s\S]{0,120}Service role required/);
});

test('release headers enforce transport and browser security boundaries', () => {
  const headers = read('_headers');
  const html = read('index.html');
  const app = read('app.js');
  const dashboard = read('web/scripts/web-dashboard.js');
  const workspace = read('web/scripts/web-workspace.js');

  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(
    headers,
    /\/app\*[\s\S]*Content-Security-Policy:[^\n]+script-src 'self' https:\/\/challenges\.cloudflare\.com;/,
  );
  assert.match(headers, /frame-ancestors 'none'/);
  const adminPolicy = headers.match(/\/admin\*[\s\S]*?Content-Security-Policy: ([^\n]+)/)?.[1] || '';
  assert.match(adminPolicy, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.doesNotMatch(adminPolicy, /googletagmanager|google-analytics|cloudflareinsights/);
  assert.match(
    headers,
    /connect-src 'self' https:\/\/msnholvugsehlxkvzlxp\.supabase\.co wss:\/\/msnholvugsehlxkvzlxp\.supabase\.co/,
  );
  assert.match(headers, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /script-src[^\n]+https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /script-src-elem[^\n]+https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /script-src[^\n]+https:\/\/www\.googletagmanager\.com/);
  assert.match(headers, /script-src[^\n]+https:\/\/static\.cloudflareinsights\.com(?:\s|;)/);
  assert.match(headers, /script-src-elem[^\n]+https:\/\/static\.cloudflareinsights\.com(?:\s|;)/);
  assert.match(headers, /connect-src[^\n]+https:\/\/\*\.google-analytics\.com/);
  assert.match(headers, /img-src[^\n]+https:\/\/\*\.google-analytics\.com/);
  assert.doesNotMatch(headers, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(headers, /style-src[^;]*'unsafe-inline'/);
  assert.match(headers, /style-src-attr 'none'/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.doesNotMatch(app, /\son(?:click|change|input)=/i);
  for (const source of [html, read('admin.html'), app, read('auth.js'), read('admin.js'), read('landing.js')]) {
    assert.doesNotMatch(source, /\sstyle\s*=/i);
    assert.doesNotMatch(source, /\.style(?:\.|\[|\s*=)/);
  }
  assert.match(dashboard, /<progress class="web-budget-track"/);
  assert.match(workspace, /<progress class="web-budget-track"/);
  assert.match(
    workspace,
    /Tap Scan receipt to send this photo securely to OpenAI for one-time extraction\. TripCash does not save the image\./,
  );
  assert.doesNotMatch(`${dashboard}\n${workspace}`, /style="width:/);
  assert.match(app, /runDeclarativeAction/);
  assert.match(headers, /X-Robots-Tag: noindex, nofollow/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.match(headers, /Cross-Origin-Opener-Policy: same-origin/);
  assert.match(headers, /upgrade-insecure-requests/);
});

test('authenticated web sessions and bot protection use hardened storage and server configuration', () => {
  const supabase = read('supabase.js');
  const config = read('supabase/config.toml');
  assert.match(supabase, /key\.endsWith\('-code-verifier'\) \? localStorage : sessionStorage/);
  assert.match(supabase, /nativeAuthStorage \? localStorage : webAuthStorage/);
  assert.match(supabase, /storage: authStorage/);
  assert.match(config, /\[auth\.captcha\][\s\S]*enabled = true[\s\S]*provider = "turnstile"/);
  assert.match(config, /secret = "env\(SUPABASE_AUTH_CAPTCHA_SECRET\)"/);
});

test('all unauthenticated auth entry points require Turnstile tokens', () => {
  const html = read('index.html');
  const auth = read('auth.js');

  for (const flow of ['login', 'register', 'guest', 'recovery', 'reauth']) {
    assert.match(html, new RegExp(`id="auth-turnstile-${flow}"`));
    assert.match(auth, new RegExp(`getAuthCaptchaToken\\('${flow}'\\)`));
  }
  assert.match(auth, /signInWithPassword\(\{ email, password: pass, options: \{ captchaToken \} \}\)/);
  assert.match(auth, /signInAnonymously\(\{ options: \{ captchaToken \} \}\)/);
  assert.match(auth, /resetPasswordForEmail\(email, options\)/);
  assert.match(auth, /captchaToken,/);
});

test('auth legal links stay visually distinguishable and keyboard focused', () => {
  const css = read('style.css');

  assert.match(css, /#screen-auth \.terms-check a \{[^}]*text-decoration:underline/);
  assert.match(css, /#screen-auth \.terms-check a:focus-visible/);
});

test('iOS privacy manifest is bundled and declares no tracking', () => {
  const manifest = read('ios/App/App/PrivacyInfo.xcprivacy');
  const project = read('ios/App/App.xcodeproj/project.pbxproj');

  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /NSPrivacyCollectedDataTypeEmailAddress/);
  assert.match(manifest, /NSPrivacyCollectedDataTypeOtherFinancialInfo/);
  assert.doesNotMatch(manifest, /NSPrivacyCollectedDataTypePurchaseHistory/);
  assert.match(manifest, /NSPrivacyCollectedDataTypePhotosorVideos/);
  assert.match(
    manifest,
    /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>NSPrivacyAccessedAPICategoryFileTimestamp<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>C617\.1<\/string>/,
  );
});

test('iOS Swift package includes every native plugin with portable paths', () => {
  const swiftPackage = read('ios/App/CapApp-SPM/Package.swift');
  const packageResolution = read('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
  const pathFix = read('scripts/fix-ios-package-paths.mjs');
  const info = read('ios/App/App/Info.plist');
  const projectPackage = JSON.parse(read('package.json'));
  for (const plugin of ['App', 'Browser', 'Camera', 'Filesystem', 'Keyboard', 'Share', 'StatusBar']) {
    assert.match(swiftPackage, new RegExp(`Capacitor${plugin}`));
  }
  assert.match(info, /NSCameraUsageDescription/);
  assert.match(info, /NSPhotoLibraryAddUsageDescription/);
  assert.match(info, /NSPhotoLibraryUsageDescription/);
  assert.match(swiftPackage, /capacitor-swift-pm\.git", exact: "8\.5\.3"/);
  assert.match(packageResolution, /"identity" : "capacitor-swift-pm"[\s\S]*"version" : "8\.5\.3"/);
  assert.equal(projectPackage.devDependencies['@capacitor/cli'], '^8.5.3');
  assert.equal(projectPackage.overrides['brace-expansion'], '5.0.12');
  assert.equal(projectPackage.overrides.uuid, '11.1.1');
  assert.doesNotMatch(swiftPackage, /path: "[^"\n]*\\\\/);
  assert.match(pathFix, /replaceAll\('\\\\', '\/'\)/);
});

test('iOS release configuration uses the expected identity and version', () => {
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  const info = read('ios/App/App/Info.plist');
  const entitlements = read('ios/App/App/App.entitlements');

  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.tripcash\.app/);
  assert.match(project, /MARKETING_VERSION = 1\.0\.1/);
  assert.match(project, /CURRENT_PROJECT_VERSION = 15/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0/);
  assert.match(info, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(info, /<key>UIRequiresFullScreen<\/key>\s*<true\/>/);
  assert.doesNotMatch(info, /UIInterfaceOrientationLandscape/);
  assert.doesNotMatch(info, /UIInterfaceOrientationPortraitUpsideDown/);
  assert.match(info, /<key>CFBundleURLSchemes<\/key>[\s\S]*<string>com\.tripcash\.app<\/string>/);
  assert.match(entitlements, /applinks:tripcash\.de/);
  assert.doesNotMatch(info, /armv7/);
});

test('Android release configuration uses the shared release version', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /applicationId "com\.tripcash\.app"/);
  assert.match(gradle, /versionCode 1/);
  assert.match(gradle, /versionName "1\.0\.1"/);
});

test('iOS adopts the required scene lifecycle without losing Capacitor callbacks', () => {
  const appDelegate = read('ios/App/App/AppDelegate.swift');
  const sceneDelegate = read('ios/App/App/SceneDelegate.swift');
  const info = read('ios/App/App/Info.plist');
  const project = read('ios/App/App.xcodeproj/project.pbxproj');

  assert.match(info, /<key>UIApplicationSceneManifest<\/key>/);
  assert.match(
    info,
    /<key>UISceneDelegateClassName<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/,
  );
  assert.match(appDelegate, /configurationForConnecting connectingSceneSession: UISceneSession/);
  assert.match(appDelegate, /config\.delegateClass = SceneDelegate\.self/);
  assert.match(sceneDelegate, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
  assert.match(sceneDelegate, /rootViewController = TripCashBridgeViewController\(\)/);
  assert.match(sceneDelegate, /if window == nil \{/);
  assert.match(
    sceneDelegate,
    /SceneDelegateProxy\.shared\.scene\(scene, willConnectTo: session, options: connectionOptions\)/,
  );
  assert.ok(
    sceneDelegate.indexOf('SceneDelegateProxy.shared.scene(scene, willConnectTo:') <
      sceneDelegate.indexOf('window?.makeKeyAndVisible()'),
    'Cold-start callback forwarding must be registered before the bridge appears',
  );
  assert.match(sceneDelegate, /SceneDelegateProxy\.shared\.scene\(scene, openURLContexts: URLContexts\)/);
  assert.match(sceneDelegate, /SceneDelegateProxy\.shared\.scene\(scene, continue: userActivity\)/);
  assert.match(project, /SceneDelegate\.swift in Sources/);
});

test('Android native shell has secure platform and callback configuration', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const config = read('capacitor.config.json');
  const auth = read('auth.js');
  const supabase = read('supabase.js');

  assert.match(manifest, /android:autoVerify="true"/);
  assert.match(manifest, /android:scheme="https" android:host="tripcash\.de" android:pathPrefix="\/auth-callback"/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(config, /"resizeOnFullScreen": true/);
  assert.match(config, /"resize": "none"/);
  assert.match(auth, /Capacitor\?\.isNativePlatform/);
  assert.match(supabase, /Route iOS and Android auth callbacks/);
});

test('authentication scrolls above short viewports and native keyboards', () => {
  const style = read('style.css');

  assert.match(style, /#screen-auth[\s\S]*height:\s*100dvh/);
  assert.match(style, /#screen-auth[\s\S]*overflow-y:\s*auto/);
  assert.match(style, /html\.native-keyboard-open #screen-auth/);
  assert.match(style, /scroll-padding-bottom:\s*max\(120px,35dvh\)/);
});

test('Android back navigation and native CSV export are wired', () => {
  const app = read('app.js');
  const style = read('style.css');

  assert.match(app, /addListener\('backButton', handleNativeBackButton\)/);
  assert.match(app, /registerNativeKeyboardListener\('keyboardDidShow'/);
  assert.match(app, /registerNativeKeyboardListener\('keyboardWillShow'/);
  assert.match(app, /info\?\.keyboardHeight/);
  assert.match(app, /visualViewport\?\.addEventListener\?\.\('resize', keepFocusedControlVisible/);
  assert.match(app, /registration\?\.catch\?\.\(reportNativeKeyboardError\)/);
  assert.match(app, /nativeKeyboardVisible \|\| nativeFormControlFocused \|\| formControlFocused/);
  assert.match(app, /screen === 'auth'/);
  assert.match(app, /screen === 'expense'/);
  assert.match(app, /Plugins\.Filesystem\.writeFile/);
  assert.match(app, /Plugins\.Share\.share/);
  assert.match(app, /if \(capacitor\?\.isNativePlatform\?\.\(\)\)/);
  assert.match(style, /\.native-android #screen-profile\.active/);
  assert.match(style, /overflow-y:auto/);
});

test('native offline startup restores identity and trip data and queues supported changes', () => {
  const app = read('app.js');
  const auth = read('auth.js');
  const html = read('index.html');
  const offline = read('offline.js');

  assert.match(auth, /const PROFILE_CACHE_PREFIX = 'tc-profile-cache-'/);
  assert.match(auth, /restoreCachedProfile\(session\.user\)[\s\S]*onUserReady\(\)/);
  assert.match(auth, /Promise\.race\([\s\S]*setTimeout\(\(\) => resolve\(null\), 1500\)/);
  assert.match(auth, /cacheProfile\(data\.user,[\s\S]*display_name: name/);
  assert.match(auth, /window\._currentProfile\?\.display_name\s+\|\|\s+user\.user_metadata/);
  assert.match(auth, /TripCashOffline\?\.restoreUser\(\)/);
  assert.match(app, /JSON\.parse\(localStorage\.getItem\(key\)/);
  assert.match(app, /localStorage\.setItem\(key, JSON\.stringify\(\{ \.\.\.cached, savedAt: Date\.now\(\) \}\)\)/);
  assert.match(app, /if \(!Number\.isFinite\(cached\.savedAt\)\)[\s\S]*cached\.savedAt = Date\.now\(\)/);
  assert.match(offline, /OFFLINE_IDENTITY_MAX_AGE_MS/);
  assert.match(offline, /savedAt: Date\.now\(\)/);
  assert.match(app, /if \(tripsError\)[\s\S]*Showing saved trips while the connection recovers/);
  assert.match(auth, /if \(!error\) \{[\s\S]*clearUserTripCaches\(userId\);[\s\S]*\}/);
  assert.match(offline, /TRIPCASH_OFFLINE_QUEUE_PREFIX/);
  assert.match(offline, /async function syncOfflineQueue\(user\)/);
  assert.match(app, /Trip created offline — it will sync automatically/);
  assert.match(app, /Expense added offline — it will sync automatically/);
  assert.match(app, /addEventListener\(\s*'online',\s+\(\s*\)\s+=>\s+\{\s+void\s+syncAfterReconnect\(\s*\);\s+\}\)/);
  assert.match(app, /async function ensureAuthenticatedSyncSession\(user\)/);
  assert.match(app, /db\.auth\.getSession\(\)/);
  assert.match(app, /db\.auth\.refreshSession\(\)/);
  assert.match(app, /failedMutation\?\.label/);
  assert.match(html, /id="btn-sync-now"[\s\S]*data-action="sync-offline-now"/);
  const refreshTrips = app.slice(
    app.indexOf('async function refreshTrips()'),
    app.indexOf('function renderDashboardStats'),
  );
  assert.doesNotMatch(refreshTrips, /from\('trip_members'\)/);
  assert.match(refreshTrips, /renderTripsList\(loadedTrips\);[\s\S]*Promise\.all/);
});

test('Android project uses TripCash branding and official native plugins', () => {
  const pkg = JSON.parse(read('package.json'));
  const foreground = read('android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml');
  const styles = read('android/app/src/main/res/values/styles.xml');

  for (const dependency of [
    '@capacitor/android',
    '@capacitor/filesystem',
    '@capacitor/keyboard',
    '@capacitor/share',
    '@capacitor/status-bar',
  ])
    assert.ok(pkg.dependencies[dependency], `${dependency} is missing`);
  assert.match(foreground, /#F59E0B/);
  assert.match(foreground, /#0EA5A0/);
  assert.match(styles, /windowSplashScreenAnimatedIcon/);
});
