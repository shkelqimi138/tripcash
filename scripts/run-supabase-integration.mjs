// Local-only integration test runner that resets Supabase safely and executes backend tests

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const schema = readFileSync(resolve(root, 'supabase', 'sql', 'schema.sql'), 'utf8');
const config = readFileSync(resolve(root, 'supabase', 'config.toml'), 'utf8');
const projectId = config.match(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m)?.[1];
const integrationEnv = {
  ...process.env,
  TRIPCASH_SUPABASE_INTEGRATION: '1',
  // Cloudflare's documented always-pass Turnstile secret is safe only here.
  SUPABASE_AUTH_CAPTCHA_SECRET: process.env.SUPABASE_AUTH_CAPTCHA_SECRET || '1x0000000000000000000000000000000AA',
};

function run(command, args, { capture = false, input } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: integrationEnv,
    input,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  return result.stdout || '';
}

function requireLoopback(rawUrl, label) {
  const url = new URL(rawUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`${label} must use a loopback address; received ${url.hostname}.`);
  }
}

if (!projectId) throw new Error('Local Supabase project_id is missing.');

const status = JSON.parse(run('supabase', ['status', '-o', 'json'], { capture: true }));
requireLoopback(status.API_URL, 'Supabase API');
requireLoopback(status.DB_URL, 'Supabase database');

run('supabase', ['db', 'reset', '--local', '--yes']);

const databaseContainer = `supabase_db_${projectId}`;
run('docker', ['exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: schema,
});
run('docker', [
  'exec',
  databaseContainer,
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  "NOTIFY pgrst, 'reload schema';",
]);

run('node', ['--test', 'tests/integration/supabase.test.js', 'tests/unit/finance.test.js']);
