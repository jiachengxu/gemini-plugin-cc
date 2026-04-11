#!/usr/bin/env node

/**
 * Session lifecycle hook for gemini-plugin-cc.
 * Handles SessionStart and SessionEnd events.
 */

import { existsSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWorkspaceKey } from '../scripts/lib/workspace.mjs';
import {
  getDataDir,
  readState,
  writeState,
  releaseLock,
  acquireStateLock,
} from '../scripts/lib/state.mjs';
import { isProcessAlive } from '../scripts/lib/process.mjs';

// Derive plugin root from this file's location (hooks/ → plugin root).
// Used as a fallback when CLAUDE_PLUGIN_ROOT is not set as an env var.
const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '..');

const event = process.argv[2];

async function main() {
  switch (event) {
    case 'SessionStart':
      await onSessionStart();
      break;
    case 'SessionEnd':
      await onSessionEnd();
      break;
    default:
      // Unknown event — ignore silently
      break;
  }
}

async function onSessionStart() {
  // Export session metadata to CLAUDE_ENV_FILE if available.
  // IMPORTANT: Export the unscoped CLAUDE_PLUGIN_DATA base, NOT the resolved
  // workspace-scoped dataDir. getDataDir() appends the workspace key itself.
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) return;

  const workspaceKey = getWorkspaceKey();
  const sessionId = process.env.CLAUDE_SESSION_ID || '';

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || PLUGIN_ROOT;

  const lines = [
    `GEMINI_PLUGIN_SESSION_ID=${sessionId}`,
    `GEMINI_PLUGIN_WORKSPACE_KEY=${workspaceKey}`,
    `CLAUDE_PLUGIN_ROOT=${pluginRoot}`,
  ];
  // Pass through CLAUDE_PLUGIN_DATA if already set by the runtime;
  // otherwise export nothing (getDataDir falls back to ~/.claude/...)
  if (process.env.CLAUDE_PLUGIN_DATA) {
    lines.push(`CLAUDE_PLUGIN_DATA=${process.env.CLAUDE_PLUGIN_DATA}`);
  }

  appendFileSync(envFile, lines.join('\n') + '\n');
}

async function onSessionEnd() {
  let workspaceKey;
  try {
    workspaceKey = getWorkspaceKey();
  } catch {
    return; // can't determine workspace — nothing to clean
  }

  const dataDir = getDataDir(workspaceKey);
  if (!existsSync(dataDir)) return;

  const mySessionId = process.env.GEMINI_PLUGIN_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';

  const isMyJob = (job) => !job.sessionOwner || job.sessionOwner === mySessionId;

  // First pass: kill running processes (outside lock — kill is idempotent)
  const state = readState(dataDir);
  for (const job of state.jobs) {
    if ((job.status === 'running' || job.status === 'queued') && isMyJob(job)) {
      // Use PGID for detached (background) jobs, plain PID for foreground
      if (job.pgid) {
        killProcessTree(job.pgid);
      } else if (job.pid) {
        killSingleProcess(job.pid);
      }
    }
  }

  // Second pass: update state under lock after kills have been sent.
  // If lock cannot be acquired, skip state mutation — don't risk corruption.
  // Orphaned job records will be cleaned on next session or by age-based pruning.
  const release = acquireStateLock(dataDir);
  if (!release) {
    return;
  }

  let cleanedJobIds = new Set();
  try {
    const freshState = readState(dataDir);

    const myCompletedJobs = freshState.jobs.filter(
      (j) =>
        (j.status === 'done' || j.status === 'cancelled' || j.status === 'failed') && isMyJob(j),
    );

    for (const job of freshState.jobs) {
      if ((job.status === 'running' || job.status === 'queued') && isMyJob(job)) {
        if (job.pid && !isProcessAlive(job.pid)) {
          job.status = 'cancelled';
          myCompletedJobs.push(job);
        }
      }
    }

    for (const job of myCompletedJobs) {
      safeDelete(job.rawTracePath);
      safeDelete(job.stderrLogPath);
      safeDelete(job.renderedResultPath);
    }

    cleanedJobIds = new Set(myCompletedJobs.map((j) => j.id));
    freshState.jobs = freshState.jobs.filter((j) => !cleanedJobIds.has(j.id));
    writeState(dataDir, freshState);
  } finally {
    release();
  }

  // Clean only this session's policy files (not the whole policies/ dir)
  const policiesDir = join(dataDir, 'policies');
  if (existsSync(policiesDir)) {
    try {
      const files = readdirSync(policiesDir);
      for (const file of files) {
        const belongsToUs = [...cleanedJobIds].some((id) => file.includes(id));
        if (belongsToUs) {
          safeDelete(join(policiesDir, file));
        }
      }
    } catch {}
  }

  releaseLock(dataDir);
}

function killProcessTree(pgid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /T /F /PID ${pgid}`, { stdio: 'pipe' });
    } else {
      process.kill(-pgid, 'SIGTERM');
    }
  } catch {}
}

function killSingleProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
}

function safeDelete(filePath) {
  if (!filePath) return;
  try {
    unlinkSync(filePath);
  } catch {}
}

main().catch(() => {
  // Hook must not fail loudly
  process.exit(0);
});
