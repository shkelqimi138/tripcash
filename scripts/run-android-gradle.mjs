// Run the checked-in Android Gradle wrapper consistently on Windows, macOS, and Linux.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const androidDirectory = resolve(import.meta.dirname, '..', 'android');
const tasks = process.argv.slice(2);

if (!tasks.length) {
  console.error('Provide at least one Gradle task.');
  process.exit(2);
}

const windows = process.platform === 'win32';
const command = windows ? process.env.ComSpec || 'cmd.exe' : 'sh';
const args = windows ? ['/d', '/s', '/c', 'gradlew.bat', ...tasks] : ['./gradlew', ...tasks];
const result = spawnSync(command, args, {
  cwd: androidDirectory,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
