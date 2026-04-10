import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createJob,
  markRunning,
  markDone,
  markFailed,
  markCancelled,
  findResumableJob,
  markSessionExpired,
} from '../plugins/gemini/scripts/lib/job-control.mjs';
import { getJob, getJobs, removeJob } from '../plugins/gemini/scripts/lib/tracked-jobs.mjs';
import { readState, writeState } from '../plugins/gemini/scripts/lib/state.mjs';

function makeTmpDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'job-test-'));
  // Initialize with empty state
  writeState(dir, {
    capabilities: {},
    config: { maxTrackedJobs: 50 },
    jobs: [],
  });
  return dir;
}

describe('job-control', () => {
  describe('createJob', () => {
    it('creates a job with UUID and queued status', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'rescue', model: 'gemini-2.5-pro' });

      assert.ok(job.id);
      assert.strictEqual(job.kind, 'rescue');
      assert.strictEqual(job.status, 'queued');
      assert.strictEqual(job.model, 'gemini-2.5-pro');
      assert.strictEqual(job.geminiSessionId, null);
    });

    it('persists job to state', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'review' });
      const stored = getJob(dir, job.id);
      assert.strictEqual(stored.id, job.id);
    });
  });

  describe('markRunning', () => {
    it('updates status and process info', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'rescue' });
      markRunning(dir, job.id, { pid: 12345, pgid: 12345 });

      const updated = getJob(dir, job.id);
      assert.strictEqual(updated.status, 'running');
      assert.strictEqual(updated.pid, 12345);
      assert.strictEqual(updated.pgid, 12345);
    });
  });

  describe('markDone', () => {
    it('sets done status with session ID and paths', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'rescue' });
      markDone(dir, job.id, {
        exitCode: 0,
        sessionId: 'sess-abc',
        rawTracePath: '/tmp/trace.jsonl',
        renderedResultPath: '/tmp/result.md',
      });

      const updated = getJob(dir, job.id);
      assert.strictEqual(updated.status, 'done');
      assert.strictEqual(updated.geminiSessionId, 'sess-abc');
      assert.strictEqual(updated.exitCode, 0);
    });
  });

  describe('markFailed / markCancelled', () => {
    it('marks failed', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'rescue' });
      markFailed(dir, job.id, { exitCode: 1 });
      assert.strictEqual(getJob(dir, job.id).status, 'failed');
    });

    it('marks cancelled', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'rescue' });
      markCancelled(dir, job.id);
      assert.strictEqual(getJob(dir, job.id).status, 'cancelled');
    });
  });

  describe('markSessionExpired', () => {
    it('sets sessionExpired flag', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'rescue' });
      markSessionExpired(dir, job.id);
      assert.strictEqual(getJob(dir, job.id).sessionExpired, true);
    });
  });

  describe('findResumableJob', () => {
    it('finds most recent rescue with session ID', () => {
      const dir = makeTmpDataDir();
      const j1 = createJob(dir, { kind: 'rescue' });
      markDone(dir, j1.id, { sessionId: 'sess-1' });

      const j2 = createJob(dir, { kind: 'rescue' });
      markDone(dir, j2.id, { sessionId: 'sess-2' });

      const found = findResumableJob(dir);
      assert.strictEqual(found.geminiSessionId, 'sess-2');
    });

    it('returns null when no rescue jobs with sessions', () => {
      const dir = makeTmpDataDir();
      createJob(dir, { kind: 'review' });
      assert.strictEqual(findResumableJob(dir), null);
    });
  });
});

describe('tracked-jobs', () => {
  describe('getJobs', () => {
    it('filters by status', () => {
      const dir = makeTmpDataDir();
      const j1 = createJob(dir, { kind: 'rescue' });
      markRunning(dir, j1.id, { pid: 1 });
      const j2 = createJob(dir, { kind: 'rescue' });
      markDone(dir, j2.id, {});

      const running = getJobs(dir, 'running');
      assert.strictEqual(running.length, 1);
      assert.strictEqual(running[0].id, j1.id);
    });
  });

  describe('removeJob', () => {
    it('removes job from state', () => {
      const dir = makeTmpDataDir();
      const job = createJob(dir, { kind: 'rescue' });
      removeJob(dir, job.id);
      assert.strictEqual(getJob(dir, job.id), null);
    });
  });

  describe('pruning', () => {
    it('prunes oldest jobs when exceeding max', () => {
      const dir = makeTmpDataDir();
      // Override max to 3
      const state = readState(dir);
      state.config.maxTrackedJobs = 3;
      writeState(dir, state);

      createJob(dir, { kind: 'rescue' });
      createJob(dir, { kind: 'rescue' });
      createJob(dir, { kind: 'rescue' });
      createJob(dir, { kind: 'rescue' });

      const jobs = getJobs(dir);
      assert.ok(jobs.length <= 3);
    });
  });
});
