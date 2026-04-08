#!/usr/bin/env node

/**
 * Fake Gemini CLI for testing.
 * Replays a JSONL fixture file to stdout line by line.
 *
 * Usage:
 *   node fake-gemini.mjs --fixture <path-to-jsonl> [--output-format stream-json|json] [-p prompt]
 *
 * In stream-json mode: writes each line of fixture to stdout as-is.
 * In json mode: reads all events, outputs the last message content as JSON response.
 * If --exit-code <N> is provided, exits with that code.
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const fixturePath = getArg('--fixture');
const outputFormat = getArg('--output-format') ?? 'stream-json';
const exitCode = parseInt(getArg('--exit-code') ?? '0', 10);

if (!fixturePath) {
  console.error('fake-gemini: --fixture <path> required');
  process.exit(1);
}

let content;
try {
  content = readFileSync(fixturePath, 'utf8');
} catch (err) {
  console.error(`fake-gemini: cannot read fixture: ${err.message}`);
  process.exit(1);
}

if (outputFormat === 'stream-json') {
  // Replay lines as-is
  const lines = content.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    process.stdout.write(line + '\n');
  }
} else if (outputFormat === 'json') {
  // Parse events, extract last assistant message, output as JSON
  const lines = content.split('\n').filter((l) => l.trim());
  let lastMessage = '';
  let sessionId = null;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'init') sessionId = event.session_id;
      if (event.type === 'message' && event.role === 'assistant' && !event.delta) {
        lastMessage = event.content;
      }
    } catch {}
  }
  process.stdout.write(
    JSON.stringify({
      response: lastMessage || 'OK',
      session_id: sessionId,
      stats: { 'tools.totalCalls': 0 },
    }) + '\n',
  );
}

process.exit(exitCode);
