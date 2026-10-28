// Start and reliably stop the local E2E server on Windows, macOS, and Linux.

const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const url = 'http://127.0.0.1:4173';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

module.exports = async () => {
  const server = spawn(process.execPath, ['tests/e2e/server.cjs'], {
    cwd: root,
    stdio: 'inherit',
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`E2E server exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) break;
    } catch (_) {
      // The server is still starting.
    }
    if (attempt === 49) throw new Error('E2E server did not become ready.');
    await delay(100);
  }

  return async () => {
    if (server.exitCode !== null) return;
    server.kill();
    await Promise.race([once(server, 'exit'), delay(2_000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  };
};
