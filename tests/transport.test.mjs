import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SubprocessTransport } from '../plugins/gemini/scripts/lib/transport.mjs';
import { EventType } from '../plugins/gemini/scripts/lib/events.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const FAKE_GEMINI = join(FIXTURES, 'fake-gemini.mjs');

function createFakeTransport(fixture, extraArgs = []) {
  const transport = new SubprocessTransport('node');
  transport._buildArgs = (_prompt, _options) => {
    return {
      args: [FAKE_GEMINI, '--fixture', fixture, ...extraArgs],
      promptViaStdin: false,
      promptText: '',
    };
  };
  return transport;
}

describe('SubprocessTransport', () => {
  describe('invoke()', () => {
    it('returns parsed JSON for json output format', async () => {
      const transport = createFakeTransport(join(FIXTURES, 'review-success.jsonl'), [
        '--output-format',
        'json',
      ]);
      const result = await transport.invoke('test prompt');
      assert.ok(result.response);
      assert.ok(result.session_id);
    });
  });

  describe('stream()', () => {
    it('yields normalized events from JSONL fixture', async () => {
      const transport = createFakeTransport(join(FIXTURES, 'review-success.jsonl'), [
        '--output-format',
        'stream-json',
      ]);
      const events = [];
      const gen = transport.stream('test prompt');
      for await (const event of gen) {
        events.push(event);
      }

      assert.ok(events.length > 0);
      assert.strictEqual(events[0].type, EventType.INIT);
      assert.strictEqual(events[0].sessionId, 'sess-abc123');

      const done = events.find((e) => e.type === EventType.DONE);
      assert.ok(done);
      assert.strictEqual(done.status, 'success');
    });

    it('handles all event types in review trace', async () => {
      const transport = createFakeTransport(join(FIXTURES, 'review-success.jsonl'), [
        '--output-format',
        'stream-json',
      ]);
      const types = new Set();
      for await (const event of transport.stream('test')) {
        types.add(event.type);
      }

      assert.ok(types.has(EventType.INIT));
      assert.ok(types.has(EventType.CONTENT));
      assert.ok(types.has(EventType.TOOL_CALL));
      assert.ok(types.has(EventType.TOOL_RESULT));
      assert.ok(types.has(EventType.DONE));
    });

    it('gracefully handles malformed JSONL', async () => {
      const transport = createFakeTransport(join(FIXTURES, 'malformed.jsonl'), [
        '--output-format',
        'stream-json',
      ]);
      const events = [];
      for await (const event of transport.stream('test')) {
        events.push(event);
      }

      // Should get events for valid lines, skip invalid
      assert.ok(events.length > 0);

      // First event should be INIT
      assert.strictEqual(events[0].type, EventType.INIT);

      // Unknown event type should be captured
      const unknown = events.find((e) => e.type === EventType.UNKNOWN);
      assert.ok(unknown, 'should have at least one UNKNOWN event');

      // Last event should be DONE
      assert.strictEqual(events[events.length - 1].type, EventType.DONE);
    });
  });
});
