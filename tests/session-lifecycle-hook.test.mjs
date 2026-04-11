import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const hookPath = resolve(__dirname, '../plugins/gemini/hooks/session-lifecycle-hook.mjs');
const expectedPluginRoot = resolve(__dirname, '../plugins/gemini');

/**
 * Run the SessionStart hook in a child process with controlled env vars.
 * Returns the contents of the env file written by the hook.
 */
function runSessionStartHook(env) {
  const envFile = join(mkdtempSync(join(tmpdir(), 'hook-test-')), 'env');
  writeFileSync(envFile, '');

  const mergedEnv = {
    ...process.env,
    CLAUDE_ENV_FILE: envFile,
    ...env,
  };
  // Unset vars that should be absent when testing fallback
  for (const [key, val] of Object.entries(mergedEnv)) {
    if (val === undefined) delete mergedEnv[key];
  }

  execSync(`node "${hookPath}" SessionStart`, {
    env: mergedEnv,
    stdio: 'pipe',
    timeout: 10_000,
  });

  return readFileSync(envFile, 'utf8');
}

function parseEnvFile(content) {
  const vars = {};
  for (const line of content.split('\n')) {
    if (!line.includes('=')) continue;
    const idx = line.indexOf('=');
    vars[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return vars;
}

describe('SessionStart hook env exports', () => {
  const savedEnv = {};
  const keysToClean = [
    'CLAUDE_ENV_FILE',
    'CLAUDE_SESSION_ID',
    'CLAUDE_PLUGIN_ROOT',
    'CLAUDE_PLUGIN_DATA',
    'GEMINI_PLUGIN_SESSION_ID',
    'GEMINI_PLUGIN_WORKSPACE_KEY',
    'GEMINI_PLUGIN_DATA',
  ];

  beforeEach(() => {
    for (const key of keysToClean) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keysToClean) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('exports CLAUDE_PLUGIN_ROOT from process.env when available', () => {
    const content = runSessionStartHook({
      CLAUDE_PLUGIN_ROOT: '/custom/plugin/root',
      CLAUDE_SESSION_ID: 'test-session-123',
    });
    const vars = parseEnvFile(content);

    assert.equal(vars.CLAUDE_PLUGIN_ROOT, '/custom/plugin/root');
    assert.equal(vars.GEMINI_PLUGIN_SESSION_ID, 'test-session-123');
  });

  it('falls back to file-derived plugin root when CLAUDE_PLUGIN_ROOT is unset', () => {
    const content = runSessionStartHook({
      CLAUDE_PLUGIN_ROOT: undefined,
      CLAUDE_SESSION_ID: 'test-session-456',
    });
    const vars = parseEnvFile(content);

    assert.equal(vars.CLAUDE_PLUGIN_ROOT, expectedPluginRoot);
    assert.equal(vars.GEMINI_PLUGIN_SESSION_ID, 'test-session-456');
  });

  it('exports CLAUDE_PLUGIN_DATA when set', () => {
    const content = runSessionStartHook({
      CLAUDE_PLUGIN_ROOT: undefined,
      CLAUDE_PLUGIN_DATA: '/some/data/dir',
      CLAUDE_SESSION_ID: 'sess',
    });
    const vars = parseEnvFile(content);

    assert.equal(vars.CLAUDE_PLUGIN_DATA, '/some/data/dir');
  });

  it('omits CLAUDE_PLUGIN_DATA when not set', () => {
    const content = runSessionStartHook({
      CLAUDE_PLUGIN_ROOT: undefined,
      CLAUDE_PLUGIN_DATA: undefined,
      CLAUDE_SESSION_ID: 'sess',
    });
    const vars = parseEnvFile(content);

    assert.equal(vars.CLAUDE_PLUGIN_DATA, undefined);
  });

  it('exports GEMINI_PLUGIN_WORKSPACE_KEY', () => {
    const content = runSessionStartHook({
      CLAUDE_SESSION_ID: 'sess',
    });
    const vars = parseEnvFile(content);

    assert.ok(vars.GEMINI_PLUGIN_WORKSPACE_KEY, 'workspace key should be exported');
    assert.match(vars.GEMINI_PLUGIN_WORKSPACE_KEY, /^[0-9a-f]{16}$/);
  });
});
