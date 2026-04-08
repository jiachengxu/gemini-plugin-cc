---
description: Check whether the local Gemini CLI is ready and probe capabilities
argument-hint: ''
allowed-tools: Bash(node:*), Bash(npm:*), Bash(which:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup
```

If the result says Gemini CLI is not found:

- Use `AskUserQuestion` exactly once to ask whether Claude should install Gemini CLI now.
- Put the install option first and suffix it with `(Recommended)`.
- If the user chooses install, run:

```bash
npm install -g @google/gemini-cli
```

- Then rerun setup.

Return the output verbatim.
