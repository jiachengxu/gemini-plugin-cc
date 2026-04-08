import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, parseLine, EventType } from '../plugins/gemini/scripts/lib/events.mjs';

describe('parseLine', () => {
  it('parses valid JSON', () => {
    const result = parseLine('{"type":"init","session_id":"s1"}');
    assert.deepStrictEqual(result, { type: 'init', session_id: 's1' });
  });

  it('returns null for empty string', () => {
    assert.strictEqual(parseLine(''), null);
    assert.strictEqual(parseLine('   '), null);
  });

  it('returns null for invalid JSON', () => {
    assert.strictEqual(parseLine('not json'), null);
    assert.strictEqual(parseLine('{broken'), null);
  });
});

describe('normalizeEvent', () => {
  it('normalizes init event', () => {
    const raw = { type: 'init', timestamp: 't1', session_id: 'sess-1', model: 'gemini-2.5-flash' };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.INIT);
    assert.strictEqual(event.sessionId, 'sess-1');
    assert.strictEqual(event.model, 'gemini-2.5-flash');
    assert.strictEqual(event.timestamp, 't1');
  });

  it('normalizes assistant message as CONTENT', () => {
    const raw = {
      type: 'message',
      role: 'assistant',
      content: 'hello',
      delta: true,
      timestamp: 't2',
    };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.CONTENT);
    assert.strictEqual(event.content, 'hello');
    assert.strictEqual(event.delta, true);
  });

  it('normalizes user message as USER_MSG', () => {
    const raw = { type: 'message', role: 'user', content: 'question', timestamp: 't3' };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.USER_MSG);
    assert.strictEqual(event.content, 'question');
  });

  it('normalizes tool_use as TOOL_CALL', () => {
    const raw = {
      type: 'tool_use',
      tool_name: 'read_file',
      tool_id: 't-1',
      parameters: { path: 'foo.ts' },
      timestamp: 't4',
    };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.TOOL_CALL);
    assert.strictEqual(event.toolName, 'read_file');
    assert.strictEqual(event.toolId, 't-1');
    assert.deepStrictEqual(event.parameters, { path: 'foo.ts' });
  });

  it('normalizes tool_result as TOOL_RESULT', () => {
    const raw = {
      type: 'tool_result',
      tool_id: 't-1',
      status: 'success',
      output: 'file contents',
      timestamp: 't5',
    };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.TOOL_RESULT);
    assert.strictEqual(event.toolId, 't-1');
    assert.strictEqual(event.status, 'success');
    assert.strictEqual(event.output, 'file contents');
  });

  it('normalizes error event', () => {
    const raw = { type: 'error', severity: 'warning', message: 'rate limited', timestamp: 't6' };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.ERROR);
    assert.strictEqual(event.severity, 'warning');
    assert.strictEqual(event.message, 'rate limited');
  });

  it('normalizes result as DONE', () => {
    const raw = {
      type: 'result',
      status: 'success',
      stats: { total_tokens: 100, duration_ms: 5000 },
      timestamp: 't7',
    };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.DONE);
    assert.strictEqual(event.status, 'success');
    assert.deepStrictEqual(event.stats, { total_tokens: 100, duration_ms: 5000 });
  });

  it('returns UNKNOWN for unrecognized event type', () => {
    const raw = { type: 'some_future_event', data: { foo: 'bar' }, timestamp: 't8' };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.UNKNOWN);
    assert.deepStrictEqual(event.raw, raw);
  });

  it('returns UNKNOWN for null input', () => {
    const event = normalizeEvent(null);
    assert.strictEqual(event.type, EventType.UNKNOWN);
  });

  it('returns UNKNOWN for object without type', () => {
    const raw = { no_type_field: true };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.UNKNOWN);
  });

  it('handles missing optional fields gracefully', () => {
    const raw = { type: 'init' };
    const event = normalizeEvent(raw);
    assert.strictEqual(event.type, EventType.INIT);
    assert.strictEqual(event.sessionId, null);
    assert.strictEqual(event.model, null);
    assert.strictEqual(event.timestamp, null);
  });
});
