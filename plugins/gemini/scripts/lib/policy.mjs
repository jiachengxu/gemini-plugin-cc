import { join } from 'node:path';
import { atomicWrite, ensureDir } from './fs.mjs';

/**
 * Read-only policy for code review.
 * Allows only read tools; denies all write/shell/destructive tools.
 */
const REVIEW_READONLY_RULES = [
  { tool: 'read_file', decision: 'allow' },
  { tool: 'glob', decision: 'allow' },
  { tool: 'grep', decision: 'allow' },
  { tool: 'web_search', decision: 'allow' },
  { tool: 'read_many_files', decision: 'allow' },
  { tool: 'list_directory', decision: 'allow' },
  { tool: '*', decision: 'deny' },
];

/**
 * Permissive policy for rescue/task mode.
 * Allows all tools (YOLO-equivalent).
 */
const RESCUE_DEFAULT_RULES = [{ tool: '*', decision: 'allow' }];

/**
 * Generate a policy object for a given mode.
 */
export function generatePolicy(mode) {
  switch (mode) {
    case 'review':
      return { rules: [...REVIEW_READONLY_RULES] };
    case 'rescue':
      return { rules: [...RESCUE_DEFAULT_RULES] };
    default:
      return { rules: [...RESCUE_DEFAULT_RULES] };
  }
}

/**
 * Write a temporary policy file to dataDir/policies/<name>.json.
 * Returns the file path.
 */
export function writePolicyFile(dataDir, name, policy) {
  const policiesDir = join(dataDir, 'policies');
  ensureDir(policiesDir);
  const filePath = join(policiesDir, `${name}.json`);
  atomicWrite(filePath, policy);
  return filePath;
}

/**
 * Build CLI flags for policy enforcement.
 * Uses dual strategy: --approval-mode plan + policy file.
 * Falls back to --approval-mode only if policy engine unavailable.
 */
export function buildPolicyFlags(dataDir, mode, capabilities = {}) {
  const flags = [];

  // Baseline: --approval-mode plan for review
  if (mode === 'review' && capabilities.hasApprovalMode) {
    flags.push('--approval-mode', 'plan');
  }

  // If policy engine supported, also write and reference a policy file
  if (capabilities.hasPolicyEngine) {
    const policy = generatePolicy(mode);
    const policyPath = writePolicyFile(dataDir, `${mode}-${Date.now()}`, policy);
    flags.push('--policy', policyPath);
  }

  return flags;
}
