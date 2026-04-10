import { join } from 'node:path';
import { unlinkSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { atomicWrite, readJsonSafe, ensureDir } from './fs.mjs';

const STATE_FILE = 'state.json';
const LOCK_FILE = '.gemini-plugin.lock';

const DEFAULT_STATE = {
  capabilities: {
    cliVersion: null,
    hasStreamJson: false,
    hasPolicyEngine: false,
    hasApprovalMode: false,
    hasResume: false,
    authMethod: null,
  },
  config: {
    defaultReviewModel: 'gemini-3.1-pro-preview',
    defaultRescueModel: 'gemini-3.1-pro-preview',
    modelAliases: {
      flash: 'gemini-3-flash-preview',
      pro: 'gemini-3.1-pro-preview',
    },
    reviewTimeout: 600_000,
    rescueTimeout: 900_000,
    stopReviewGate: false,
    maxTrackedJobs: 50,
  },
  jobs: [],
};

/**
 * Resolve workspace data directory.
 * Uses GEMINI_PLUGIN_DATA (gemini-specific) if set, then CLAUDE_PLUGIN_DATA
 * (shared runtime), otherwise falls back to ~/.claude/plugins/data/gemini.
 * Always namespaces under 'gemini/' to avoid collisions with other plugins
 * sharing CLAUDE_PLUGIN_DATA.
 */
export function getDataDir(workspaceKey) {
  const geminiBase = process.env.GEMINI_PLUGIN_DATA;
  if (geminiBase) {
    return join(geminiBase, workspaceKey);
  }
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    return join(pluginData, 'gemini', workspaceKey);
  }
  return join(process.env.HOME ?? '/tmp', '.claude', 'plugins', 'data', 'gemini', workspaceKey);
}

/**
 * Read workspace state, merging with defaults.
 */
export function readState(dataDir) {
  const filePath = join(dataDir, STATE_FILE);
  const stored = readJsonSafe(filePath, {});
  return {
    ...DEFAULT_STATE,
    ...stored,
    capabilities: { ...DEFAULT_STATE.capabilities, ...stored.capabilities },
    config: { ...DEFAULT_STATE.config, ...stored.config },
  };
}

/**
 * Write workspace state atomically.
 */
export function writeState(dataDir, state) {
  atomicWrite(join(dataDir, STATE_FILE), state);
}

/**
 * Update state by merging partial data.
 */
export function updateState(dataDir, partial) {
  const current = readState(dataDir);
  const merged = {
    ...current,
    ...partial,
    capabilities: { ...current.capabilities, ...(partial.capabilities || {}) },
    config: { ...current.config, ...(partial.config || {}) },
    jobs: partial.jobs ?? current.jobs,
  };
  writeState(dataDir, merged);
  return merged;
}

// --- File-based lock ---

const STATE_LOCK_FILE = '.gemini-state.lock';

/**
 * Acquire workspace lock. Returns true if acquired, false if another process holds it.
 * Uses openSync with 'wx' flag for atomic create-or-fail (no TOCTOU race).
 * Stale locks (dead PID) are recovered automatically.
 */
export function acquireLock(dataDir) {
  ensureDir(dataDir);
  const lockPath = join(dataDir, LOCK_FILE);

  // Try atomic create — fails if file exists
  try {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  // File exists — check if lock is stale
  const content = readJsonSafe(lockPath);
  if (content?.pid && isProcessAlive(content.pid)) {
    return false; // lock held by live process
  }

  // Stale lock — remove and retry once
  try {
    unlinkSync(lockPath);
  } catch {}
  try {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
    closeSync(fd);
    return true;
  } catch {
    return false; // another process won the race
  }
}

/**
 * Acquire a short-lived lock for state file mutations.
 * Spins briefly then gives up. Returns a release function or null.
 */
export function acquireStateLock(dataDir) {
  ensureDir(dataDir);
  const lockPath = join(dataDir, STATE_LOCK_FILE);

  // 20 attempts * 100ms = 2s total wait. Enough for typical read-modify-write cycles.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {}
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Check for stale lock — dead PID or lock older than 30s (guards against PID recycling)
      const content = readJsonSafe(lockPath);
      const lockAge = content?.ts ? Date.now() - new Date(content.ts).getTime() : Infinity;
      const isStale = !content?.pid || !isProcessAlive(content.pid) || lockAge > 30_000; // 30s max — no state mutation should take this long
      if (isStale) {
        try {
          unlinkSync(lockPath);
        } catch {}
        continue;
      }
      // Wait briefly and retry
      try {
        execSync('sleep 0.1', { stdio: 'pipe' });
      } catch {}
    }
  }
  return null; // could not acquire
}

/**
 * Release workspace lock.
 */
export function releaseLock(dataDir) {
  const lockPath = join(dataDir, LOCK_FILE);
  try {
    unlinkSync(lockPath);
  } catch {}
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
