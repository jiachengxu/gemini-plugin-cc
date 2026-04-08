#!/usr/bin/env node

/**
 * task-worker.mjs — Detached background subprocess for Gemini tasks.
 * Spawned by gemini-companion.mjs when --background is used.
 *
 * Args: --job-id <id> --data-dir <path> --prompt-file <path> [--model <model>] [--resume <session-id>]
 * Prompt is read from a file (not CLI arg) to avoid E2BIG on large prompts.
 */

import { SubprocessTransport } from './lib/transport.mjs';
import { EventType } from './lib/events.mjs';
import { markRunning, markDone, markFailed } from './lib/job-control.mjs';
import { getJob } from './lib/tracked-jobs.mjs';
import { readState } from './lib/state.mjs';
import { collectReviewResult, formatReviewOutput } from './lib/render.mjs';
import { atomicWrite, ensureDir } from './lib/fs.mjs';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const jobId = getArg('--job-id');
const dataDir = getArg('--data-dir');
const promptFile = getArg('--prompt-file');
const model = getArg('--model');
const resumeSession = getArg('--resume');

if (!jobId || !dataDir || !promptFile) {
  console.error('task-worker: --job-id, --data-dir, and --prompt-file required');
  process.exit(1);
}

// Read prompt from file, then clean up
let prompt;
try {
  prompt = readFileSync(promptFile, 'utf8');
  try {
    unlinkSync(promptFile);
  } catch {}
} catch (err) {
  console.error(`task-worker: cannot read prompt file: ${err.message}`);
  process.exit(1);
}

async function run() {
  const state = readState(dataDir);
  const config = state.config;

  const transportOpts = {
    model: model ?? config.defaultRescueModel,
    timeout: config.rescueTimeout,
  };

  if (resumeSession) {
    transportOpts.resume = resumeSession;
  }

  // Set up paths
  const logsDir = join(dataDir, 'logs');
  const resultsDir = join(dataDir, 'results');
  ensureDir(logsDir);
  ensureDir(resultsDir);

  const rawTracePath = join(logsDir, `${jobId}.jsonl`);
  const stderrLogPath = join(logsDir, `${jobId}.stderr.log`);
  const renderedResultPath = join(resultsDir, `${jobId}.md`);

  transportOpts.stderrLogPath = stderrLogPath;

  const transport = new SubprocessTransport();
  const events = [];
  let sessionId = null;

  try {
    const gen = transport.stream(prompt, transportOpts);
    const handle = gen.handle;

    // Mark running — store the Gemini child PID but KEEP the worker PGID
    // (set by the launcher). The launcher stored pgid = worker PID, which
    // is the process group leader for the detached worker tree.
    markRunning(dataDir, jobId, {
      pid: handle?.pid ?? null,
      // Don't overwrite pgid — it was set to the worker's PID by the launcher
    });

    // Collect raw trace
    const traceLines = [];

    for await (const event of gen) {
      events.push(event);
      if (event.type === EventType.INIT && event.sessionId) {
        sessionId = event.sessionId;
      }
      // Write raw event to trace
      traceLines.push(JSON.stringify(event));
    }

    // Save raw trace
    atomicWrite(rawTracePath, traceLines.join('\n') + '\n');

    // Render and save result
    const result = collectReviewResult(events);
    const formatted = formatReviewOutput(result);
    atomicWrite(renderedResultPath, formatted);

    // Check if job was cancelled while we were running — don't overwrite
    const currentJob = getJob(dataDir, jobId, { allowCrossSession: true });
    if (currentJob?.status === 'cancelled') {
      // Job was cancelled — don't overwrite with 'done'
      return;
    }

    markDone(dataDir, jobId, {
      exitCode: gen.handle?.exitCode ?? 0,
      sessionId,
      rawTracePath,
      stderrLogPath,
      renderedResultPath,
    });
  } catch (err) {
    // Check if job was cancelled — don't overwrite with 'failed'
    try {
      const currentJob = getJob(dataDir, jobId, { allowCrossSession: true });
      if (currentJob?.status === 'cancelled') return;
    } catch {}

    // Save whatever we have
    if (events.length > 0) {
      try {
        atomicWrite(rawTracePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      } catch {}
    }

    try {
      markFailed(dataDir, jobId, { exitCode: err.code ?? 1 });
    } catch {
      // Lock contention — job stays in 'running', cleaned up by age pruning
    }
  }
}

run().catch(() => process.exit(1));
