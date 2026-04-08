---
description: Run an adversarial Gemini code review that pressure-tests design assumptions
argument-hint: '[--model <name>]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Run an adversarial Gemini review on the current git changes.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:

- This command is review-only.
- Do not fix issues, apply patches, or suggest changes.
- Return Gemini's adversarial review output verbatim.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" adversarial-review $ARGUMENTS
```

Return the output verbatim.
