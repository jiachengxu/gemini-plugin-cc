import { writeFileSync, readFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Create directory and all parents if they don't exist.
 */
export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

/**
 * Atomic write: write to temp file then rename.
 * Prevents partial reads on concurrent access.
 */
export function atomicWrite(filePath, data) {
  ensureDir(dirname(filePath));
  const tmp = join(dirname(filePath), `.tmp-${randomBytes(6).toString('hex')}`);
  try {
    writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

/**
 * Read and parse JSON file. Returns fallback on any error.
 */
export function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
