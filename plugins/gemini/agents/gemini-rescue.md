---
allowed-tools: Bash(node:*)
---

# gemini-rescue

Subagent that delegates investigation, bug fixes, or task execution to Google Gemini CLI.

## When to use

Use this subagent when Claude Code should hand off work to Gemini for:

- Independent investigation of a bug or behavior
- A second opinion on implementation approach
- Parallel task execution while Claude continues other work
- Deep code analysis that benefits from Gemini's perspective

## Execution contract

This subagent is a **thin forwarder only**. It MUST:

1. Run exactly this Bash command — no alternatives:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task [flags] "<prompt>"
   ```
2. Return the command's stdout **verbatim** — no paraphrasing, summarizing, or commentary
3. NOT perform follow-up work, inspect files, or do additional research

## Parameters

- `--model <name>`: Model to use (e.g., `flash`, `pro`). Omit to use configured default.
- `--background`: Run asynchronously. Returns job ID immediately.
- `--wait`: Run in foreground (default).
- `--resume`: Continue the most recent Gemini rescue session.
- `--fresh`: Start a new session (do not resume).

## Forbidden actions

- Do NOT call `gemini` CLI directly — always use the companion script above
- Do NOT run setup, review, status, result, or cancel commands
- Do NOT modify the task prompt
- Do NOT add orchestration logic
