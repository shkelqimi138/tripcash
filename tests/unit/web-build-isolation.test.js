const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');

test('web and native builds share the redesign while keeping shell adapters isolated', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tripcash-build-isolation-'));
  try {
    fs.cpSync(path.join(root, 'web'), path.join(workspace, 'web'), { recursive: true });
    const client = 'node_modules/@supabase/supabase-js/dist/umd/supabase.js';
    fs.mkdirSync(path.dirname(path.join(workspace, client)), { recursive: true });
    fs.copyFileSync(path.join(root, client), path.join(workspace, client));
    const build = native => {
      const result = spawnSync(
        process.execPath,
        [path.join(root, 'scripts/build-web.mjs'), ...(native ? ['--native'] : [])],
        {
          cwd: workspace,
          env: { ...process.env, TRIPCASH_NATIVE_BUILD: '0' },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
    };
    build(false);
    const webHtml = fs.readFileSync(path.join(workspace, 'dist/app.html'), 'utf8');
    assert.match(webHtml, /id="web-topbar"/);
    assert.ok(fs.existsSync(path.join(workspace, 'dist/styles/web-shell.css')));
    assert.ok(fs.existsSync(path.join(workspace, 'dist/scripts/web-shell.js')));
    assert.ok(fs.existsSync(path.join(workspace, 'dist/scripts/web-dashboard.js')));
    assert.ok(fs.existsSync(path.join(workspace, 'dist/scripts/web-workspace.js')));
    assert.ok(fs.existsSync(path.join(workspace, 'dist/scripts/web-expense.js')));
    assert.ok(fs.existsSync(path.join(workspace, 'dist/scripts/analytics.js')));
    assert.ok(fs.existsSync(path.join(workspace, 'dist/styles/analytics-consent.css')));
    assert.ok(fs.existsSync(path.join(workspace, 'dist/styles/landing-theme.css')));
    assert.ok(!fs.existsSync(path.join(workspace, 'dist/scripts/native-redesign.js')));
    assert.ok(!fs.existsSync(path.join(workspace, 'dist/styles/native-redesign.css')));
    assert.match(webHtml, /id="modal-web-join"/);
    for (const [asset, version] of Object.entries({
      'styles/app.css': '20261010-1',
      'styles/web-shell.css': '20261006-3',
      'styles/phone-trip-expenses.css': '20261005-1',
      'styles/landing-gallery.css': '20261005-1',
      'styles/landing-theme.css': '20261005-1',
      'scripts/app.js': '20261009-2',
      'scripts/auth.js': '20261009-1',
      'scripts/landing.js': '20261006-1',
      'scripts/web-shell.js': '20261005-1',
      'scripts/web-dashboard.js': '20261005-1',
      'scripts/web-workspace.js': '20261010-1',
    })) {
      assert.match(webHtml, new RegExp(`${asset.replace('.', '\\.')}\\?v=${version}`));
    }
    build(true);
    const nativeHtml = fs.readFileSync(path.join(workspace, 'dist/index.html'), 'utf8');
    assert.doesNotMatch(nativeHtml, /web-topbar|scripts\/web-shell\.js|web-only:/);
    assert.match(nativeHtml, /scripts\/native-redesign\.js/);
    assert.match(nativeHtml, /scripts\/web-dashboard\.js/);
    assert.match(nativeHtml, /scripts\/web-workspace\.js/);
    assert.match(nativeHtml, /scripts\/web-expense\.js/);
    assert.match(nativeHtml, /styles\/native-redesign\.css/);
    assert.match(nativeHtml, /id="modal-web-join"/);
    for (const [asset, version] of Object.entries({
      'styles/app.css': '20261010-1',
      'styles/web-shell.css': '20261006-3',
      'styles/native-redesign.css': '20261006-1',
      'styles/phone-trip-expenses.css': '20261005-1',
      'scripts/app.js': '20261009-2',
      'scripts/auth.js': '20261009-1',
      'scripts/web-dashboard.js': '20261005-1',
      'scripts/web-workspace.js': '20261010-1',
    })) {
      assert.match(nativeHtml, new RegExp(`${asset.replace('.', '\\.')}\\?v=${version}`));
    }
    for (const file of [
      'scripts/web-shell.js',
      'scripts/analytics.js',
      'styles/analytics-consent.css',
      'styles/landing-theme.css',
      'app.html',
      'admin.html',
    ]) {
      assert.ok(!fs.existsSync(path.join(workspace, 'dist', file)), `Native output must exclude ${file}`);
    }
    for (const file of [
      'styles/web-shell.css',
      'styles/native-redesign.css',
      'scripts/native-redesign.js',
      'scripts/web-dashboard.js',
      'scripts/web-workspace.js',
      'scripts/web-expense.js',
    ]) {
      assert.ok(fs.existsSync(path.join(workspace, 'dist', file)), `Native output must include ${file}`);
    }
    assert.match(nativeHtml, /id="trip-bottom-nav"/);
    assert.match(nativeHtml, /id="btn-theme"/);
    assert.deepEqual(
      fs.readFileSync(path.join(workspace, 'dist/styles/app.css')),
      fs.readFileSync(path.join(root, 'web/styles/app.css')),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
