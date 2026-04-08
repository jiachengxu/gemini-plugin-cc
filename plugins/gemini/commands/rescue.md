---
description: Delegate investigation, bug fix, or task to Gemini CLI
argument-hint: '[--background|--wait] [--resume|--fresh] [--model <name>] <task description>'
allowed-tools: Bash(node:*), AskUserQuestion
---

Route this request to Gemini CLI for task execution.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task $ARGUMENTS
```

Return the output verbatim. Do not paraphrase, summarize, or add commentary.
