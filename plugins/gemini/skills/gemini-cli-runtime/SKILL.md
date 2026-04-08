# gemini-cli-runtime

Internal helper contract for invoking the Gemini companion script from the gemini-rescue subagent.

## Invocation

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs task [flags] "<prompt>"
```

## Contract

- **Single forward only.** The subagent makes one Bash call to the companion script and returns stdout unmodified.
- **No orchestration.** Do not chain commands, poll status, or do follow-up work.
- **Return verbatim.** The output is the final answer — do not paraphrase, summarize, or add commentary.

## Parameter Handling

### --model

Normalize common aliases to full model names:

- `flash` → current default flash model (from config)
- `pro` → current default pro model (from config)
- Any other value → pass through as-is

Leave unset unless the user explicitly requests a specific model.

### --resume / --fresh

- `--resume`: Continue the most recent rescue session. The companion script handles session ID lookup.
- `--fresh`: Start a new session, ignoring any previous rescue thread.
- If neither specified: the companion runs fresh by default.

### --background / --wait

- `--background`: Companion spawns a detached worker and returns the job ID immediately.
- `--wait`: Companion runs in foreground and returns output when done (default).

## Forbidden

- Do NOT invoke `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` subcommands.
- Do NOT modify the user's prompt.
- Do NOT add `--effort` or other flags not listed above.
- Do NOT run multiple companion invocations in sequence.
