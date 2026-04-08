import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Get canonical workspace key.
 * Git repo: SHA256(realpath(git-toplevel) + ":" + worktree-path-if-any)
 * Non-git:  SHA256(realpath(cwd))
 * Returns 16-char hex prefix.
 */
export function getWorkspaceKey(cwd = process.cwd()) {
  let input;
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const canonicalRoot = realpathSync(gitRoot);

    let worktreeSuffix = '';
    try {
      const commonDir = execSync('git rev-parse --git-common-dir', {
        encoding: 'utf8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const gitDir = execSync('git rev-parse --git-dir', {
        encoding: 'utf8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (commonDir !== gitDir) {
        worktreeSuffix = canonicalRoot;
      }
    } catch {}

    input = `${canonicalRoot}:${worktreeSuffix}`;
  } catch {
    // Not a git repo — fallback to realpath(cwd)
    input = realpathSync(cwd);
  }

  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Get git root or null if not in a git repo.
 */
export function getGitRoot(cwd = process.cwd()) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if cwd is inside a git repository.
 */
export function isGitRepo(cwd = process.cwd()) {
  return getGitRoot(cwd) !== null;
}
