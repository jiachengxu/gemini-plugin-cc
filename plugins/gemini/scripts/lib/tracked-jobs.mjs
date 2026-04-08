import { readState, writeState, acquireStateLock } from './state.mjs';
import { unlinkSync } from 'node:fs';

/**
 * Run a state mutation under the cross-process state lock.
 * Throws if lock cannot be acquired — never proceeds unlocked.
 */
function withStateLock(dataDir, fn) {
  const release = acquireStateLock(dataDir);
  if (!release) {
    throw new Error('Could not acquire state lock — another process may be updating state. Retry.');
  }
  try {
    return fn();
  } finally {
    release();
  }
}

/**
 * Add a job record to state.
 */
export function addJob(dataDir, job) {
  return withStateLock(dataDir, () => {
    const state = readState(dataDir);
    state.jobs.push(job);
    pruneJobs(state);
    writeState(dataDir, state);
    return job;
  });
}

/**
 * Update a job record by ID. Merges partial fields.
 */
export function updateJob(dataDir, jobId, partial) {
  return withStateLock(dataDir, () => {
    const state = readState(dataDir);
    const idx = state.jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return null;

    state.jobs[idx] = {
      ...state.jobs[idx],
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    writeState(dataDir, state);
    return state.jobs[idx];
  });
}

/**
 * Get current session ID for ownership checks.
 */
function currentSessionId() {
  return process.env.GEMINI_PLUGIN_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
}

/**
 * Get a job by ID. Only returns jobs owned by the current session
 * unless the job has no owner (legacy) or allowCrossSession is set.
 */
export function getJob(dataDir, jobId, { allowCrossSession = false } = {}) {
  const state = readState(dataDir);
  const job = state.jobs.find((j) => j.id === jobId) ?? null;
  if (!job) return null;
  if (allowCrossSession || !job.sessionOwner || job.sessionOwner === currentSessionId()) {
    return job;
  }
  return null;
}

/**
 * Get all jobs, optionally filtered by status. Scoped to current session.
 */
export function getJobs(dataDir, status = null) {
  const state = readState(dataDir);
  const sid = currentSessionId();
  let jobs = state.jobs.filter((j) => !j.sessionOwner || j.sessionOwner === sid);
  if (status) jobs = jobs.filter((j) => j.status === status);
  return jobs;
}

/**
 * Get the most recent job matching criteria. Scoped to current session.
 */
export function getLatestJob(dataDir, filter = {}) {
  const state = readState(dataDir);
  const sid = currentSessionId();
  let jobs = state.jobs.filter((j) => !j.sessionOwner || j.sessionOwner === sid);

  if (filter.kind) jobs = jobs.filter((j) => j.kind === filter.kind);
  if (filter.status) jobs = jobs.filter((j) => j.status === filter.status);
  if (filter.hasSession) jobs = jobs.filter((j) => j.geminiSessionId);

  return jobs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null;
}

/**
 * Remove a job by ID.
 */
export function removeJob(dataDir, jobId) {
  withStateLock(dataDir, () => {
    const state = readState(dataDir);
    state.jobs = state.jobs.filter((j) => j.id !== jobId);
    writeState(dataDir, state);
  });
}

/**
 * Prune oldest jobs when exceeding maxTrackedJobs.
 * Also prunes jobs older than MAX_AGE_MS to prevent unbounded artifact accumulation.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function pruneJobs(state) {
  const max = state.config?.maxTrackedJobs ?? 50;
  const now = Date.now();

  // Age-based prune: remove completed jobs older than MAX_AGE_MS
  const aged = state.jobs.filter((j) => {
    if (j.status !== 'done' && j.status !== 'failed' && j.status !== 'cancelled') return false;
    const updated = j.updatedAt ? new Date(j.updatedAt).getTime() : 0;
    return now - updated > MAX_AGE_MS;
  });
  for (const job of aged) {
    cleanupJobArtifacts(job);
  }
  if (aged.length > 0) {
    const agedIds = new Set(aged.map((j) => j.id));
    state.jobs = state.jobs.filter((j) => !agedIds.has(j.id));
  }

  // Count-based prune
  if (state.jobs.length <= max) return;
  state.jobs.sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''));
  const removed = state.jobs.slice(0, state.jobs.length - max);
  for (const job of removed) {
    cleanupJobArtifacts(job);
  }
  state.jobs = state.jobs.slice(state.jobs.length - max);
}

function cleanupJobArtifacts(job) {
  for (const path of [job.rawTracePath, job.stderrLogPath, job.renderedResultPath]) {
    if (path) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }
}
