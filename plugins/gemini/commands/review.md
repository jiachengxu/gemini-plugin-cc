---
description: Run a Gemini code review against local git state
argument-hint: '[--model <name>]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Run a Gemini review on the current git changes.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:

- This command is review-only.
- Do not fix issues, apply patches, or suggest changes.
- Return Gemini's output verbatim to the user.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review $ARGUMENTS
```

Return the output verbatim. Do not paraphrase, summarize, or add commentary.
