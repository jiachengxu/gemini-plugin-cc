import { randomUUID } from 'node:crypto';
import { addJob, updateJob, getLatestJob } from './tracked-jobs.mjs';

/**
 * Create a new job record.
 */
export function createJob(dataDir, opts = {}) {
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    sessionOwner: process.env.GEMINI_PLUGIN_SESSION_ID || process.env.CLAUDE_SESSION_ID || null,
    geminiSessionId: null,
    geminiCliVersion: null,
    kind: opts.kind ?? 'task',
    status: 'queued',
    sessionExpired: false,
    pid: null,
    pgid: null,
    exitCode: null,
    model: opts.model ?? null,
    approvalMode: opts.approvalMode ?? null,
    createdAt: now,
    updatedAt: now,
    rawTracePath: null,
    stderrLogPath: null,
    renderedResultPath: null,
  };
  return addJob(dataDir, job);
}

/**
 * Mark job as running with process info.
 */
export function markRunning(dataDir, jobId, processInfo) {
  return updateJob(dataDir, jobId, {
    status: 'running',
    pid: processInfo.pid ?? null,
    pgid: processInfo.pgid ?? null,
  });
}

/**
 * Mark job as done with results.
 */
export function markDone(dataDir, jobId, result = {}) {
  return updateJob(dataDir, jobId, {
    status: 'done',
    exitCode: result.exitCode ?? null,
    geminiSessionId: result.sessionId ?? null,
    rawTracePath: result.rawTracePath ?? null,
    stderrLogPath: result.stderrLogPath ?? null,
    renderedResultPath: result.renderedResultPath ?? null,
  });
}

/**
 * Mark job as failed.
 */
export function markFailed(dataDir, jobId, error = {}) {
  return updateJob(dataDir, jobId, {
    status: 'failed',
    exitCode: error.exitCode ?? null,
  });
}

/**
 * Mark job as cancelled.
 */
export function markCancelled(dataDir, jobId) {
  return updateJob(dataDir, jobId, { status: 'cancelled' });
}

/**
 * Mark session as expired on a job.
 */
export function markSessionExpired(dataDir, jobId) {
  return updateJob(dataDir, jobId, { sessionExpired: true });
}

/**
 * Find resumable job — most recent rescue with a session ID.
 */
export function findResumableJob(dataDir) {
  return getLatestJob(dataDir, { kind: 'rescue', hasSession: true });
}
