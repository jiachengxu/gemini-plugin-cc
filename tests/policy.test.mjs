import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePolicy, writePolicyFile, buildPolicyFlags } from '../plugins/gemini/scripts/lib/policy.mjs';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generatePolicy', () => {
  it('generates review policy with deny-all-else', () => {
    const policy = generatePolicy('review');
    assert.ok(policy.rules.length > 0);

    const lastRule = policy.rules[policy.rules.length - 1];
    assert.strictEqual(lastRule.tool, '*');
    assert.strictEqual(lastRule.decision, 'deny');

    const allowedTools = policy.rules.filter((r) => r.decision === 'allow').map((r) => r.tool);
    assert.ok(allowedTools.includes('read_file'));
    assert.ok(allowedTools.includes('glob'));
    assert.ok(allowedTools.includes('grep'));
  });

  it('generates rescue policy allowing all', () => {
    const policy = generatePolicy('rescue');
    assert.strictEqual(policy.rules.length, 1);
    assert.strictEqual(policy.rules[0].tool, '*');
    assert.strictEqual(policy.rules[0].decision, 'allow');
  });

  it('defaults to rescue policy for unknown mode', () => {
    const policy = generatePolicy('unknown-mode');
    assert.strictEqual(policy.rules[0].tool, '*');
    assert.strictEqual(policy.rules[0].decision, 'allow');
  });
});

describe('writePolicyFile', () => {
  it('writes policy JSON to dataDir/policies/', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'policy-test-'));
    const policy = generatePolicy('review');
    const filePath = writePolicyFile(tmpDir, 'test-review', policy);

    assert.ok(existsSync(filePath));
    const written = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.deepStrictEqual(written.rules, policy.rules);
  });
});

describe('buildPolicyFlags', () => {
  it('adds --approval-mode plan for review when supported', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'policy-flags-'));
    const flags = buildPolicyFlags(tmpDir, 'review', {
      hasApprovalMode: true,
      hasPolicyEngine: false,
    });

    assert.ok(flags.includes('--approval-mode'));
    assert.ok(flags.includes('plan'));
  });

  it('skips --approval-mode when not supported', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'policy-flags-'));
    const flags = buildPolicyFlags(tmpDir, 'review', {
      hasApprovalMode: false,
      hasPolicyEngine: false,
    });

    assert.ok(!flags.includes('--approval-mode'));
  });

  it('adds --policy flag when policy engine supported', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'policy-flags-'));
    const flags = buildPolicyFlags(tmpDir, 'review', {
      hasApprovalMode: true,
      hasPolicyEngine: true,
    });

    assert.ok(flags.includes('--policy'));
    // Policy file should exist
    const policyPath = flags[flags.indexOf('--policy') + 1];
    assert.ok(existsSync(policyPath));
  });
});
