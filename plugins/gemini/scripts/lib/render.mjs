import { EventType } from './events.mjs';

/**
 * Collect streaming events into a structured review result.
 */
export function collectReviewResult(events) {
  let sessionId = null;
  let model = null;
  const contentParts = [];
  const toolCalls = [];
  const toolResults = [];
  const errors = [];
  let stats = null;
  let finalStatus = null;

  for (const event of events) {
    switch (event.type) {
      case EventType.INIT:
        sessionId = event.sessionId;
        model = event.model;
        break;
      case EventType.CONTENT:
        contentParts.push(event.content);
        break;
      case EventType.TOOL_CALL:
        toolCalls.push({
          toolName: event.toolName,
          toolId: event.toolId,
          parameters: event.parameters,
        });
        break;
      case EventType.TOOL_RESULT:
        toolResults.push({
          toolId: event.toolId,
          status: event.status,
          output: event.output,
          error: event.error,
        });
        break;
      case EventType.ERROR:
        errors.push({ severity: event.severity, message: event.message });
        break;
      case EventType.DONE:
        finalStatus = event.status;
        stats = event.stats;
        break;
    }
  }

  const fullContent = contentParts.join('');

  return {
    sessionId,
    model,
    content: fullContent,
    toolCalls,
    toolResults,
    errors,
    status: finalStatus,
    stats,
    parsed: parseReviewContent(fullContent),
  };
}

/**
 * Parse review content into structured findings.
 * Attempts to extract verdict, summary, and findings from Gemini's response.
 */
export function parseReviewContent(content) {
  if (!content) return { verdict: null, summary: '', findings: [] };

  const lower = content.toLowerCase();

  // Extract verdict
  let verdict = null;
  if (lower.includes('verdict: pass') || lower.includes('verdict:**pass')) {
    verdict = 'pass';
  } else if (lower.includes('verdict: fail') || lower.includes('verdict:**fail')) {
    verdict = 'fail';
  } else if (lower.includes('verdict: warning') || lower.includes('verdict:**warning')) {
    verdict = 'warning';
  }

  // Extract summary — first paragraph or line after "summary" heading
  const summaryMatch = content.match(
    /#+\s*(?:review\s*)?summary\s*\n+([\s\S]*?)(?=\n#|\n---|\n\n\n|$)/i,
  );
  let summary;
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  } else {
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim());
    summary = paragraphs[0]?.trim() ?? '';
  }

  // Extract findings — lines starting with - or * under a "findings" or "issues" heading
  const findings = [];
  const findingsMatch = content.match(
    /#+\s*(?:findings|issues|problems|concerns)\s*\n+([\s\S]*?)(?=\n#|\n---|\n\n\n|$)/i,
  );
  if (findingsMatch) {
    const block = findingsMatch[1];
    const lines = block.split('\n');
    for (const line of lines) {
      const match = line.match(/^[\s]*[-*]\s+(.+)/);
      if (match) {
        findings.push(parseFinding(match[1]));
      }
    }
  }

  return { verdict, summary, findings };
}

/**
 * Parse a single finding line into structured data.
 * Tries to extract severity, file path, line number.
 */
function parseFinding(text) {
  const finding = { text, severity: 'info', file: null, line: null };

  // Detect severity keywords
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('security') || lower.includes('vulnerability')) {
    finding.severity = 'critical';
  } else if (lower.includes('error') || lower.includes('bug') || lower.includes('incorrect')) {
    finding.severity = 'error';
  } else if (lower.includes('warning') || lower.includes('potential') || lower.includes('should')) {
    finding.severity = 'warning';
  }

  // Extract file:line references
  const fileMatch = text.match(/[`"]?([a-zA-Z0-9_/.-]+\.[a-zA-Z]+):(\d+)[`"]?/);
  if (fileMatch) {
    finding.file = fileMatch[1];
    finding.line = parseInt(fileMatch[2], 10);
  } else {
    const fileOnly = text.match(/[`"]?([a-zA-Z0-9_/.-]+\.[a-zA-Z]+)[`"]?/);
    if (fileOnly) {
      finding.file = fileOnly[1];
    }
  }

  return finding;
}

/**
 * Sort findings by severity (critical > error > warning > info).
 */
const SEVERITY_ORDER = { critical: 0, error: 1, warning: 2, info: 3 };

export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/**
 * Format a review result for Claude Code output.
 * Returns Gemini's raw content as the primary output to avoid lossy parsing
 * hiding findings. Appends stats metadata.
 */
export function formatReviewOutput(result) {
  const lines = [];
  const { model, stats, errors, content } = result;

  // Primary: Gemini's raw response verbatim
  if (content) {
    lines.push(content);
    lines.push('');
  }

  // Errors from Gemini stream
  if (errors.length > 0) {
    lines.push('**Errors:**');
    for (const e of errors) {
      lines.push(`- [${e.severity}] ${e.message}`);
    }
    lines.push('');
  }

  // Stats footer
  if (stats) {
    const parts = [];
    if (stats.total_tokens) parts.push(`${stats.total_tokens} tokens`);
    if (stats.duration_ms) parts.push(`${(stats.duration_ms / 1000).toFixed(1)}s`);
    if (stats.tool_calls) parts.push(`${stats.tool_calls} tool calls`);
    if (parts.length) lines.push(`*${model ?? 'gemini'} · ${parts.join(' · ')}*`);
  }

  return lines.join('\n');
}
