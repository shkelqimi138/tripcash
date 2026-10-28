// Keep Capacitor's generated local Swift-package paths portable after Windows syncs.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packagePath = resolve(import.meta.dirname, '..', 'ios', 'App', 'CapApp-SPM', 'Package.swift');
const source = readFileSync(packagePath, 'utf8');
const portable = source.replace(
  /(\.package\(name:\s*"[^"]+",\s*path:\s*")([^"]+)("\))/g,
  (_, prefix, dependencyPath, suffix) => `${prefix}${dependencyPath.replaceAll('\\', '/')}${suffix}`,
);

if (portable !== source) writeFileSync(packagePath, portable);
