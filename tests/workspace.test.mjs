import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getWorkspaceKey, getGitRoot, isGitRepo } from '../plugins/gemini/scripts/lib/workspace.mjs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('workspace', () => {
  describe('getWorkspaceKey', () => {
    it('returns a 16-char hex string', () => {
      const key = getWorkspaceKey();
      assert.match(key, /^[0-9a-f]{16}$/);
    });

    it('returns consistent key for same directory', () => {
      const key1 = getWorkspaceKey();
      const key2 = getWorkspaceKey();
      assert.strictEqual(key1, key2);
    });

    it('returns different keys for different directories', () => {
      const tmpDir1 = mkdtempSync(join(tmpdir(), 'ws-test-1-'));
      const tmpDir2 = mkdtempSync(join(tmpdir(), 'ws-test-2-'));
      const key1 = getWorkspaceKey(tmpDir1);
      const key2 = getWorkspaceKey(tmpDir2);
      assert.notStrictEqual(key1, key2);
    });

    it('works in non-git directory', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'ws-test-nogit-'));
      const key = getWorkspaceKey(tmpDir);
      assert.match(key, /^[0-9a-f]{16}$/);
    });
  });

  describe('getGitRoot', () => {
    it('returns null for non-git directory', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'ws-test-nogit-'));
      assert.strictEqual(getGitRoot(tmpDir), null);
    });
  });

  describe('isGitRepo', () => {
    it('returns false for non-git directory', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'ws-test-nogit-'));
      assert.strictEqual(isGitRepo(tmpDir), false);
    });
  });
});
