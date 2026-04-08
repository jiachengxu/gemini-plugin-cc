import { SubprocessTransport } from './transport.mjs';
import { resolveModel } from './args.mjs';
import { getGitDiff, detectReviewScope } from './git.mjs';
import { buildPolicyFlags } from './policy.mjs';
import { collectReviewResult, formatReviewOutput } from './render.mjs';
import { createJob, markRunning, markDone, markFailed } from './job-control.mjs';
import { EventType } from './events.mjs';
import { atomicWrite, ensureDir } from './fs.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');

/**
 * Run a code review via Gemini CLI.
 * Creates a tracked job so it appears in /gemini:status.
 */
export async function runReview(options) {
  const { dataDir, state, adversarial = false, cwd = process.cwd() } = options;
  const config = state.config;
  const capabilities = state.capabilities;

  // Resolve model
  const model = resolveModel(options.model ?? config.defaultReviewModel, config.modelAliases);

  // Detect review scope
  const { scope, description } = options.scope
    ? { scope: options.scope, description: options.scope }
    : detectReviewScope(cwd);

  if (scope === 'none') {
    return `No changes to review. ${description}`;
  }

  // Get diff
  const diff = getGitDiff(scope, cwd);
  if (!diff) {
    return 'No diff content available for review.';
  }

  // Fail closed if no read-only enforcement is available
  if (!capabilities.hasApprovalMode && !capabilities.hasPolicyEngine) {
    throw new Error(
      'Cannot run review: no read-only enforcement available. ' +
        'Neither --approval-mode nor policy engine is supported by the installed Gemini CLI. ' +
        'Run /gemini:setup to validate capabilities.',
    );
  }

  // Build prompt
  const promptTemplate = loadPrompt(adversarial ? 'adversarial-review' : 'review');
  const { prompt, truncated, skippedFiles } = buildReviewPrompt(promptTemplate, diff);

  // Build transport options with policy enforcement.
  // buildPolicyFlags handles --approval-mode, so don't also set approvalMode here.
  const policyFlags = buildPolicyFlags(dataDir, 'review', capabilities);
  const transportOpts = {
    model,
    timeout: config.reviewTimeout,
    extraArgs: policyFlags,
  };

  // Set up paths for job tracking
  const logsDir = join(dataDir, 'logs');
  const resultsDir = join(dataDir, 'results');
  ensureDir(logsDir);
  ensureDir(resultsDir);

  // Create tracked job
  const kind = adversarial ? 'adversarial-review' : 'review';
  const job = createJob(dataDir, { kind, model });

  const rawTracePath = join(logsDir, `${job.id}.jsonl`);
  const stderrLogPath = join(logsDir, `${job.id}.stderr.log`);
  const renderedResultPath = join(resultsDir, `${job.id}.md`);
  transportOpts.stderrLogPath = stderrLogPath;

  // Create transport and stream
  const transport = new SubprocessTransport();
  const events = [];
  let sessionId = null;

  console.error(`Reviewing ${description} with ${model}...`);

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
      if (event.type === EventType.CONTENT && event.delta) {
        process.stderr.write('.');
      }
    }
    process.stderr.write('\n');

    // Save raw trace
    atomicWrite(rawTracePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    // Collect and format
    const result = collectReviewResult(events);
    let formatted = formatReviewOutput(result);

    // Prepend incomplete warning if input was truncated/skipped
    if (truncated || skippedFiles > 0) {
      const warnings = ['**⚠ INCOMPLETE REVIEW — not all code was inspected:**'];
      if (truncated) warnings.push(`- Diff truncated at 100,000 chars`);
      if (skippedFiles > 0)
        warnings.push(`- ${skippedFiles} file(s) skipped (too large or binary)`);
      warnings.push('- Verdict may not reflect full codebase state');
      warnings.push('');
      formatted = warnings.join('\n') + formatted;
    }

    // Save rendered result
    atomicWrite(renderedResultPath, formatted);

    // Mark done
    markDone(dataDir, job.id, {
      exitCode: gen.handle?.exitCode ?? 0,
      sessionId,
      rawTracePath,
      stderrLogPath,
      renderedResultPath,
    });

    return formatted;
  } catch (err) {
    // Save whatever we have
    if (events.length > 0) {
      try {
        atomicWrite(rawTracePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      } catch {}
    }
    markFailed(dataDir, job.id, { exitCode: 1 });
    throw err;
  }
}

function loadPrompt(name) {
  try {
    return readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Build review prompt. Returns { prompt, truncated, skippedFiles }.
 */
function buildReviewPrompt(template, diff) {
  const parts = [];
  let truncated = false;

  if (template) {
    parts.push(template);
    parts.push('');
  }

  // Check for skipped file markers in the diff
  const skippedFiles = (diff.match(/\[SKIPPED: file too large/g) || []).length;

  parts.push('## Code Changes to Review');
  parts.push('');
  parts.push('```diff');
  const MAX_DIFF_CHARS = 100_000;
  if (diff.length > MAX_DIFF_CHARS) {
    parts.push(diff.slice(0, MAX_DIFF_CHARS));
    parts.push(`\n... (truncated, ${diff.length - MAX_DIFF_CHARS} chars omitted)`);
    truncated = true;
  } else {
    parts.push(diff);
  }
  parts.push('```');

  if (truncated || skippedFiles > 0) {
    parts.push('');
    parts.push('**WARNING: This review covers INCOMPLETE input.**');
    if (truncated)
      parts.push(`- Diff was truncated (${diff.length} chars, limit ${MAX_DIFF_CHARS})`);
    if (skippedFiles > 0)
      parts.push(`- ${skippedFiles} file(s) were skipped (too large or binary)`);
    parts.push('- Do NOT emit a PASS verdict. Mark your review as INCOMPLETE.');
  }

  return { prompt: parts.join('\n'), truncated, skippedFiles };
}
