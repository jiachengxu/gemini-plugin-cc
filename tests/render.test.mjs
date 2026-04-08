import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectReviewResult,
  parseReviewContent,
  sortFindings,
  formatReviewOutput,
} from '../plugins/gemini/scripts/lib/render.mjs';
import { normalizeEvent } from '../plugins/gemini/scripts/lib/events.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixtureEvents(name) {
  const content = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map(normalizeEvent);
}

describe('parseReviewContent', () => {
  it('extracts PASS verdict', () => {
    const result = parseReviewContent('Verdict: PASS\n\nAll good.');
    assert.strictEqual(result.verdict, 'pass');
  });

  it('extracts FAIL verdict', () => {
    const result = parseReviewContent('Verdict: FAIL\n\nBad stuff.');
    assert.strictEqual(result.verdict, 'fail');
  });

  it('extracts WARNING verdict', () => {
    const result = parseReviewContent('Verdict: WARNING\n\nSome concerns.');
    assert.strictEqual(result.verdict, 'warning');
  });

  it('returns null verdict when none found', () => {
    const result = parseReviewContent('Just some text without verdict.');
    assert.strictEqual(result.verdict, null);
  });

  it('extracts findings from markdown list', () => {
    const content = `## Findings\n\n- Critical: SQL injection in src/auth.ts:42\n- Warning: unused import`;
    const result = parseReviewContent(content);
    assert.strictEqual(result.findings.length, 2);
    assert.strictEqual(result.findings[0].severity, 'critical');
    assert.strictEqual(result.findings[0].file, 'src/auth.ts');
    assert.strictEqual(result.findings[0].line, 42);
  });

  it('extracts file references without line numbers', () => {
    const content = `## Findings\n\n- Warning: issue in config.json`;
    const result = parseReviewContent(content);
    assert.strictEqual(result.findings[0].file, 'config.json');
    assert.strictEqual(result.findings[0].line, null);
  });
});

describe('sortFindings', () => {
  it('sorts by severity: critical > error > warning > info', () => {
    const findings = [
      { text: 'a', severity: 'info' },
      { text: 'b', severity: 'critical' },
      { text: 'c', severity: 'warning' },
      { text: 'd', severity: 'error' },
    ];
    const sorted = sortFindings(findings);
    assert.deepStrictEqual(
      sorted.map((f) => f.severity),
      ['critical', 'error', 'warning', 'info'],
    );
  });
});

describe('collectReviewResult', () => {
  it('collects success fixture into structured result', () => {
    const events = loadFixtureEvents('review-success.jsonl');
    const result = collectReviewResult(events);

    assert.strictEqual(result.sessionId, 'sess-abc123');
    assert.strictEqual(result.model, 'gemini-2.5-flash');
    assert.strictEqual(result.status, 'success');
    assert.ok(result.content.includes('Review Summary'));
    assert.strictEqual(result.parsed.verdict, 'pass');
  });

  it('collects error fixture with findings', () => {
    const events = loadFixtureEvents('review-error.jsonl');
    const result = collectReviewResult(events);

    assert.strictEqual(result.sessionId, 'sess-err-1');
    assert.strictEqual(result.parsed.verdict, 'fail');
    assert.ok(result.parsed.findings.length > 0);

    const critical = result.parsed.findings.find((f) => f.severity === 'critical');
    assert.ok(critical);
    assert.strictEqual(critical.file, 'src/auth.ts');
    assert.strictEqual(critical.line, 42);
  });

  it('captures errors from stream', () => {
    const events = loadFixtureEvents('review-error.jsonl');
    const result = collectReviewResult(events);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].severity, 'warning');
  });
});

describe('formatReviewOutput', () => {
  it('returns raw content verbatim with stats', () => {
    const events = loadFixtureEvents('review-success.jsonl');
    const result = collectReviewResult(events);
    const output = formatReviewOutput(result);

    // Raw content should be included verbatim
    assert.ok(output.includes('Review Summary'));
    assert.ok(output.includes('PASS'));
    assert.ok(output.includes('gemini-2.5-flash'));
  });

  it('includes raw content with findings intact', () => {
    const events = loadFixtureEvents('review-error.jsonl');
    const result = collectReviewResult(events);
    const output = formatReviewOutput(result);

    // Raw content preserved — findings not lossy-parsed away
    assert.ok(output.includes('FAIL'));
    assert.ok(output.includes('SQL injection'));
    assert.ok(output.includes('src/auth.ts:42'));
  });

  it('returns raw content for unstructured responses', () => {
    const result = {
      content: 'Some unstructured response',
      errors: [],
      parsed: { verdict: null, summary: '', findings: [] },
      stats: null,
    };
    const output = formatReviewOutput(result);
    assert.ok(output.includes('Some unstructured response'));
  });
});
