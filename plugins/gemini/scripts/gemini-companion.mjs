#!/usr/bin/env node

/**
 * gemini-companion.mjs — Thin router for Gemini CLI integration.
 * Dispatches subcommands to lib/ modules.
 */

import { parseArgs, resolveModel } from './lib/args.mjs';
import { getWorkspaceKey, isGitRepo } from './lib/workspace.mjs';
import { getDataDir, readState, updateState } from './lib/state.mjs';
import { SubprocessTransport } from './lib/transport.mjs';
import { EventType } from './lib/events.mjs';
import { runReview } from './lib/gemini.mjs';
import {
  createJob,
  markRunning,
  markDone,
  markFailed,
  markCancelled,
  findResumableJob,
  markSessionExpired,
} from './lib/job-control.mjs';
import { getJob, getJobs, getLatestJob } from './lib/tracked-jobs.mjs';
import { killProcessTree, isProcessAlive } from './lib/process.mjs';
import { atomicWrite } from './lib/fs.mjs';
import { collectReviewResult, formatReviewOutput } from './lib/render.mjs';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERSION = '1.1.0';

async function main() {
  const { flags, positional } = parseArgs();
  const subcommand = positional[0];

  if (!subcommand) {
    printUsage();
    process.exit(1);
  }

  switch (subcommand) {
    case 'setup':
      await runSetup(flags);
      break;
    case 'review':
      await runReviewCommand(flags, false);
      break;
    case 'adversarial-review':
      await runReviewCommand(flags, true);
      break;
    case 'task':
      await runTaskCommand(flags, positional.slice(1));
      break;
    case 'status':
      await runStatusCommand(flags, positional.slice(1));
      break;
    case 'result':
      await runResultCommand(flags, positional.slice(1));
      break;
    case 'cancel':
      await runCancelCommand(flags, positional.slice(1));
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  console.log(`gemini-companion v${VERSION}

Usage: node gemini-companion.mjs <subcommand> [options]

Subcommands:
  setup                  Validate Gemini CLI installation and probe capabilities
  review                 Run code review via Gemini CLI
  adversarial-review     Run adversarial code review
  task <prompt>          Execute a task via Gemini CLI [--background] [--resume] [--model]
  status [job-id]        Show active/recent jobs
  result <job-id>        Retrieve completed job output
  cancel [job-id]        Cancel active background job
`);
}

// --- Review ---

async function runReviewCommand(flags, adversarial) {
  if (!isGitRepo()) {
    console.error('ERROR: Review requires a git repository.');
    process.exit(1);
  }

  const workspaceKey = getWorkspaceKey();
  const dataDir = getDataDir(workspaceKey);
  const state = readState(dataDir);

  const output = await runReview({
    dataDir,
    state,
    model: flags.model,
    adversarial,
  });

  console.log(output);
}

// --- Task ---

async function runTaskCommand(flags, positional) {
  const prompt = positional.join(' ');
  if (!prompt) {
    console.error('ERROR: Task requires a prompt. Usage: task <prompt>');
    process.exit(1);
  }

  const workspaceKey = getWorkspaceKey();
  const dataDir = getDataDir(workspaceKey);
  const state = readState(dataDir);
  const config = state.config;
  const model = resolveModel(flags.model ?? config.defaultRescueModel, config.modelAliases);

  // Handle --resume
  let resumeSession = null;
  if (flags.resume) {
    const prev = findResumableJob(dataDir);
    if (prev?.geminiSessionId) {
      resumeSession = prev.geminiSessionId;
      console.error(`Resuming Gemini session ${resumeSession.slice(0, 8)}...`);
    } else {
      console.error('No resumable session found. Starting fresh.');
    }
  }

  // Create job
  const job = createJob(dataDir, { kind: 'rescue', model });

  if (flags.background) {
    // Write prompt to temp file to avoid E2BIG on large prompts
    const promptFile = join(dataDir, `.prompt-${job.id}.tmp`);
    atomicWrite(promptFile, prompt);

    const workerPath = join(__dirname, 'task-worker.mjs');
    const workerArgs = [
      workerPath,
      '--job-id',
      job.id,
      '--data-dir',
      dataDir,
      '--prompt-file',
      promptFile,
    ];
    if (model) workerArgs.push('--model', model);
    if (resumeSession) workerArgs.push('--resume', resumeSession);

    const child = spawn('node', workerArgs, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    markRunning(dataDir, job.id, { pid: child.pid, pgid: child.pid });
    console.log(`Background job started: ${job.id}`);
    console.log(`Check progress: /gemini:status ${job.id}`);
    console.log(`Get results:    /gemini:result ${job.id}`);
  } else {
    // Foreground execution
    const transport = new SubprocessTransport();
    const transportOpts = {
      model,
      timeout: config.rescueTimeout,
    };
    if (resumeSession) transportOpts.resume = resumeSession;

    const events = [];
    let sessionId = null;

    try {
      const gen = transport.stream(prompt, transportOpts);
      markRunning(dataDir, job.id, {
        pid: gen.handle?.pid ?? null,
        pgid: gen.handle?.pgid ?? null,
      });

      for await (const event of gen) {
        events.push(event);
        if (event.type === EventType.INIT && event.sessionId) {
          sessionId = event.sessionId;
        }
        if (event.type === EventType.CONTENT) {
          process.stdout.write(event.content);
        }
      }

      const result = collectReviewResult(events);
      markDone(dataDir, job.id, {
        exitCode: gen.handle?.exitCode ?? 0,
        sessionId,
      });

      // Print final formatted output if content wasn't already streamed
      if (!events.some((e) => e.type === EventType.CONTENT)) {
        console.log(formatReviewOutput(result));
      } else {
        console.log(''); // newline after streamed content
      }
    } catch (err) {
      markFailed(dataDir, job.id, { exitCode: 1 });

      // Check if session expired
      if (err.message?.includes('session') || err.message?.includes('not found')) {
        markSessionExpired(dataDir, job.id);
        console.error('Session expired or not found. Try again without --resume.');
      } else {
        console.error(`Task failed: ${err.message}`);
      }
      process.exit(1);
    }
  }
}

// --- Status ---

async function runStatusCommand(flags, positional) {
  const workspaceKey = getWorkspaceKey();
  const dataDir = getDataDir(workspaceKey);
  const jobId = positional[0];

  if (jobId) {
    const job = getJob(dataDir, jobId);
    if (!job) {
      console.error(`Job not found: ${jobId}`);
      process.exit(1);
    }
    printJobDetail(job);
  } else {
    const jobs = getJobs(dataDir);
    if (jobs.length === 0) {
      console.log('No jobs tracked.');
      return;
    }
    printJobTable(jobs);
  }
}

function printJobTable(jobs) {
  const sorted = [...jobs].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  console.log(
    'ID                                    Kind     Status     Model              Updated',
  );
  console.log('─'.repeat(95));
  for (const j of sorted) {
    const id = j.id.slice(0, 8);
    const kind = (j.kind ?? '').padEnd(8);
    const status = (j.status ?? '').padEnd(10);
    const model = (j.model ?? '-').slice(0, 18).padEnd(18);
    const updated = j.updatedAt ? new Date(j.updatedAt).toLocaleTimeString() : '-';
    console.log(`${id}  ${kind} ${status} ${model} ${updated}`);
  }
}

function printJobDetail(job) {
  console.log(`Job:     ${job.id}`);
  console.log(`Kind:    ${job.kind}`);
  console.log(`Status:  ${job.status}`);
  console.log(`Model:   ${job.model ?? '-'}`);
  console.log(`PID:     ${job.pid ?? '-'}`);
  console.log(`Session: ${job.geminiSessionId ?? '-'}`);
  console.log(`Created: ${job.createdAt}`);
  console.log(`Updated: ${job.updatedAt}`);
  if (job.sessionExpired) console.log('⚠ Session expired');
  if (job.pid && isProcessAlive(job.pid)) {
    console.log('Process: running');
  } else if (job.status === 'running') {
    console.log('Process: dead (job may have completed or crashed)');
  }
}

// --- Result ---

async function runResultCommand(flags, positional) {
  const workspaceKey = getWorkspaceKey();
  const dataDir = getDataDir(workspaceKey);
  const jobId = positional[0];

  if (!jobId) {
    // Show most recent completed job
    const latest = getLatestJob(dataDir, { status: 'done' });
    if (!latest) {
      console.error('No completed jobs found.');
      process.exit(1);
    }
    printJobResult(latest);
    return;
  }

  const job = getJob(dataDir, jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  if (job.status !== 'done') {
    console.error(`Job ${jobId.slice(0, 8)} is ${job.status}, not done.`);
    process.exit(1);
  }

  printJobResult(job);
}

function printJobResult(job) {
  // Try rendered result first
  if (job.renderedResultPath && existsSync(job.renderedResultPath)) {
    console.log(readFileSync(job.renderedResultPath, 'utf8'));
    return;
  }
  // Fall back to raw trace
  if (job.rawTracePath && existsSync(job.rawTracePath)) {
    console.log(readFileSync(job.rawTracePath, 'utf8'));
    return;
  }
  console.log(`Job ${job.id.slice(0, 8)} completed but no result files found.`);
}

// --- Cancel ---

async function runCancelCommand(flags, positional) {
  const workspaceKey = getWorkspaceKey();
  const dataDir = getDataDir(workspaceKey);
  const jobId = positional[0];

  let job;
  if (jobId) {
    job = getJob(dataDir, jobId);
  } else {
    // Cancel most recent running job
    job = getLatestJob(dataDir, { status: 'running' });
  }

  if (!job) {
    console.error(jobId ? `Job not found: ${jobId}` : 'No running jobs found.');
    process.exit(1);
  }

  if (job.status !== 'running' && job.status !== 'queued') {
    console.error(`Job ${job.id.slice(0, 8)} is ${job.status}, cannot cancel.`);
    process.exit(1);
  }

  // Kill process — use PGID for group kill, plain PID for single process
  if (job.pgid) {
    killProcessTree(job.pgid);
  } else if (job.pid) {
    // No PGID — foreground job, kill single process
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {}
  }

  // Verify process is actually gone before marking cancelled
  if (job.pid && isProcessAlive(job.pid)) {
    // Give it a moment after SIGTERM
    try {
      const { execSync: es } = await import('node:child_process');
      es('sleep 0.5', { stdio: 'pipe' });
    } catch {}
    if (isProcessAlive(job.pid)) {
      console.error(`Warning: process ${job.pid} may still be running after cancel.`);
    }
  }

  markCancelled(dataDir, job.id);
  console.log(`Cancelled job ${job.id.slice(0, 8)}`);
}

// --- Setup ---

async function runSetup(_flags) {
  console.log('=== Gemini CLI Setup ===\n');

  // 1. Check gemini CLI exists
  const geminiPath = findGemini();
  if (!geminiPath) {
    console.error('ERROR: Gemini CLI not found on PATH.');
    console.error('Install: npm install -g @anthropic-ai/gemini-cli');
    console.error('  or:    See https://github.com/google-gemini/gemini-cli');
    process.exit(1);
  }
  console.log(`✓ Gemini CLI found: ${geminiPath}`);

  // 2. Check CLI version
  const cliVersion = getCliVersion(geminiPath);
  if (cliVersion) {
    console.log(`✓ Version: ${cliVersion}`);
  } else {
    console.log('⚠ Could not determine Gemini CLI version');
  }

  // 3. Initialize workspace state
  const workspaceKey = getWorkspaceKey();
  const dataDir = getDataDir(workspaceKey);
  console.log(`✓ Workspace key: ${workspaceKey}`);
  console.log(`✓ Data directory: ${dataDir}`);

  const transport = new SubprocessTransport(geminiPath);

  // 4. Probe capabilities
  const capabilities = {
    cliVersion,
    hasStreamJson: false,
    hasPolicyEngine: false,
    hasApprovalMode: false,
    hasResume: false,
    authMethod: null,
  };

  // Probe auth + basic functionality via json output
  console.log('\nProbing capabilities...');
  try {
    const result = await transport.invoke('Reply with exactly: OK', {
      timeout: 30_000,
    });
    const response = result?.response ?? JSON.stringify(result);
    if (response.includes('OK')) {
      console.log('✓ Auth: working');
      capabilities.authMethod = 'detected';
    } else {
      console.log(`⚠ Auth probe returned unexpected response: ${response.slice(0, 100)}`);
      capabilities.authMethod = 'unknown';
    }
  } catch (err) {
    const msg = err.message ?? '';
    if (msg.includes('auth') || msg.includes('API key') || msg.includes('OAuth')) {
      console.error('✗ Auth: failed. Run `gemini` interactively to authenticate.');
      capabilities.authMethod = 'failed';
    } else {
      console.error(`✗ Basic probe failed: ${msg}`);
      capabilities.authMethod = 'error';
    }
  }

  // Probe stream-json
  try {
    const gen = transport.stream('Reply with exactly: OK', {
      timeout: 30_000,
    });
    let gotEvent = false;
    for await (const event of gen) {
      gotEvent = true;
      if (event.type === EventType.DONE) break;
    }
    capabilities.hasStreamJson = gotEvent;
    console.log(gotEvent ? '✓ stream-json: supported' : '⚠ stream-json: no events received');
  } catch {
    console.log('⚠ stream-json: not supported or probe failed');
  }

  // Probe --approval-mode plan (just check if flag is accepted)
  try {
    await transport.invoke('Reply with exactly: OK', {
      timeout: 30_000,
      approvalMode: 'plan',
    });
    capabilities.hasApprovalMode = true;
    console.log('✓ --approval-mode plan: supported');
  } catch {
    console.log('⚠ --approval-mode plan: not supported');
  }

  // Note: --resume and policy engine probes are best done with real sessions.
  // Mark as needing validation on first use.
  capabilities.hasResume = true; // assume supported, validate on first --resume attempt
  capabilities.hasPolicyEngine = false; // validate in Phase 2 when policy.mjs is ready

  // 5. Save state
  updateState(dataDir, { capabilities });
  console.log('\n✓ Capabilities saved to workspace state.');

  // Summary
  const ready = capabilities.authMethod !== 'failed' && capabilities.authMethod !== 'error';
  if (ready) {
    console.log('\n=== Setup complete. Gemini CLI is ready. ===');
  } else {
    console.log('\n=== Setup incomplete. Fix auth issues above and re-run /gemini:setup ===');
    process.exit(1);
  }
}

function findGemini() {
  try {
    const result = execSync('which gemini', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function getCliVersion(geminiPath) {
  try {
    return execSync(`${geminiPath} --version`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
