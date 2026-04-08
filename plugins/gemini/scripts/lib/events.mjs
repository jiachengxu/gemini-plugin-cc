/**
 * Canonical internal event types.
 * Only this module knows raw Gemini JSONL field names.
 */
export const EventType = {
  INIT: 'init',
  CONTENT: 'content',
  USER_MSG: 'user_msg',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  ERROR: 'error',
  DONE: 'done',
  UNKNOWN: 'unknown',
};

/**
 * Normalize a raw Gemini stream-json event (parsed JSON object)
 * into a canonical internal event.
 *
 * Raw Gemini events (verified from source):
 *   init, message, tool_use, tool_result, error, result
 */
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || !raw.type) {
    return { type: EventType.UNKNOWN, timestamp: null, raw };
  }

  const ts = raw.timestamp ?? null;

  switch (raw.type) {
    case 'init':
      return {
        type: EventType.INIT,
        timestamp: ts,
        sessionId: raw.session_id ?? null,
        model: raw.model ?? null,
      };

    case 'message':
      if (raw.role === 'assistant') {
        return {
          type: EventType.CONTENT,
          timestamp: ts,
          content: raw.content ?? '',
          delta: raw.delta ?? false,
        };
      }
      return {
        type: EventType.USER_MSG,
        timestamp: ts,
        content: raw.content ?? '',
      };

    case 'tool_use':
      return {
        type: EventType.TOOL_CALL,
        timestamp: ts,
        toolName: raw.tool_name ?? null,
        toolId: raw.tool_id ?? null,
        parameters: raw.parameters ?? {},
      };

    case 'tool_result':
      return {
        type: EventType.TOOL_RESULT,
        timestamp: ts,
        toolId: raw.tool_id ?? null,
        status: raw.status ?? null,
        output: raw.output ?? null,
        error: raw.error ?? null,
      };

    case 'error':
      return {
        type: EventType.ERROR,
        timestamp: ts,
        severity: raw.severity ?? 'error',
        message: raw.message ?? '',
      };

    case 'result':
      return {
        type: EventType.DONE,
        timestamp: ts,
        status: raw.status ?? null,
        stats: raw.stats ?? null,
      };

    default:
      return { type: EventType.UNKNOWN, timestamp: ts, raw };
  }
}

/**
 * Parse a single JSONL line into a raw event object.
 * Returns null for empty/unparseable lines.
 */
export function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
