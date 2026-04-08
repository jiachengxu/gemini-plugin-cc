import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXEC_OPTS = {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  maxBuffer: 10 * 1024 * 1024,
};

/**
 * Safe git command execution — uses execFileSync (no shell) to prevent injection.
 */
function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { ...EXEC_OPTS, cwd }).trim();
}
const MAX_UNTRACKED_BYTES = 24 * 1024;

/**
 * Get git diff output.
 * scope: 'staged' | 'unstaged' | 'untracked' | 'all' | 'branch:<base>'
 */
export function getGitDiff(scope = 'all', cwd = process.cwd()) {
  switch (scope) {
    case 'staged':
      return git(['diff', '--cached'], cwd);
    case 'unstaged':
      return git(['diff'], cwd);
    case 'untracked':
      return getUntrackedDiffs(cwd);
    case 'all': {
      const staged = git(['diff', '--cached'], cwd);
      const unstaged = git(['diff'], cwd);
      const untracked = getUntrackedDiffs(cwd);
      return [staged, unstaged, untracked].filter(Boolean).join('\n');
    }
    default: {
      if (scope.startsWith('branch:')) {
        const base = scope.slice(7);
        const mergeBase = getMergeBase(base, cwd);
        return git(['diff', `${mergeBase}...HEAD`], cwd);
      }
      return git(['diff'], cwd);
    }
  }
}

/**
 * Get short git status.
 */
export function getGitStatus(cwd = process.cwd()) {
  return git(['status', '--short'], cwd);
}

/**
 * Get recent git log.
 */
export function getGitLog(n = 10, cwd = process.cwd()) {
  return git(['log', '--oneline', `-${n}`], cwd);
}

/**
 * Get merge base between current HEAD and a branch.
 */
export function getMergeBase(branch = 'main', cwd = process.cwd()) {
  // Use -- to prevent branch names starting with '-' from being interpreted as flags
  return git(['merge-base', 'HEAD', '--', branch], cwd);
}

/**
 * List untracked files (respects .gitignore).
 */
export function listUntrackedFiles(cwd = process.cwd()) {
  return git(['ls-files', '--others', '--exclude-standard'], cwd).split('\n').filter(Boolean);
}

function isProbablyBinary(buffer) {
  const check = buffer.slice(0, 8192);
  return check.includes(0);
}

/**
 * Format a single untracked file as a unified diff (new file).
 * Returns empty string if the file should be skipped.
 */
function formatUntrackedFileAsDiff(cwd, relativePath) {
  const absolutePath = join(cwd, relativePath);
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    return '';
  }
  if (stat.isDirectory()) return '';

  // Explicit skip markers for large/binary files (not silent omission)
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return (
      `diff --git a/${relativePath} b/${relativePath}\n` +
      `new file mode 100644\n` +
      `--- /dev/null\n` +
      `+++ b/${relativePath}\n` +
      `@@ -0,0 +0,0 @@\n` +
      `+[SKIPPED: file too large (${stat.size} bytes, limit ${MAX_UNTRACKED_BYTES})]`
    );
  }

  let buffer;
  try {
    buffer = readFileSync(absolutePath);
  } catch {
    return '';
  }
  if (isProbablyBinary(buffer)) {
    return (
      `diff --git a/${relativePath} b/${relativePath}\n` +
      `new file mode 100644\n` +
      `Binary file ${relativePath} (${stat.size} bytes)`
    );
  }

  const lines = buffer.toString('utf8').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const diffBody = lines.map((l) => `+${l}`).join('\n');

  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    diffBody,
  ].join('\n');
}

/**
 * Build synthetic unified diffs for all untracked files.
 * Includes explicit skip markers for files that couldn't be included.
 */
function getUntrackedDiffs(cwd = process.cwd()) {
  const files = listUntrackedFiles(cwd);
  return files
    .map((f) => formatUntrackedFileAsDiff(cwd, f))
    .filter(Boolean)
    .join('\n');
}

/**
 * Detect review scope from git state.
 * Returns { scope, description } indicating what to review.
 */
export function detectReviewScope(cwd = process.cwd()) {
  const status = getGitStatus(cwd);
  if (!status) {
    return { scope: 'none', description: 'No changes detected' };
  }

  const staged = git(['diff', '--cached', '--stat'], cwd);
  const unstaged = git(['diff', '--stat'], cwd);
  const untracked = listUntrackedFiles(cwd);
  const hasUntracked = untracked.length > 0;

  if (staged || unstaged) {
    const parts = [];
    if (staged) parts.push('staged');
    if (unstaged) parts.push('unstaged');
    if (hasUntracked) parts.push(`${untracked.length} untracked`);
    const scope = hasUntracked
      ? 'all'
      : staged && unstaged
        ? 'all'
        : staged
          ? 'staged'
          : 'unstaged';
    return { scope, description: `${parts.join(' + ')} changes` };
  }

  if (hasUntracked) {
    return { scope: 'untracked', description: `${untracked.length} untracked file(s)` };
  }

  return { scope: 'none', description: 'No changes detected' };
}
