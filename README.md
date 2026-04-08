# gemini-plugin-cc

A [Claude Code](https://claude.ai/claude-code) plugin that integrates [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) as a subagent for code review, task delegation, and investigation.

> **Inspired by and modeled after [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).** Credit to OpenAI for pioneering the Claude Code plugin pattern.

## What You Get

- `/gemini:review` — Gemini code review against local git changes (read-only enforced)
- `/gemini:adversarial-review` — Pressure-test code by challenging design assumptions and finding failure modes
- `/gemini:rescue` — Delegate investigation, bug fix, or task to Gemini (foreground or background)
- `/gemini:status` — Show active and recent Gemini jobs
- `/gemini:result` — Retrieve completed job output
- `/gemini:cancel` — Cancel a running background job

## Requirements

- **[Claude Code](https://claude.ai/claude-code)** CLI, desktop app, or web app
- **Node.js 18.18 or later**
- **Google account** — Gemini CLI uses Google OAuth (free tier: 60 req/min, 1000 req/day) or a Gemini API key

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add jiachengxu/gemini-plugin-cc
```

Install the plugin:

```bash
/plugin install gemini@gemini-plugin-cc
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/gemini:setup
```

`/gemini:setup` will check if Gemini CLI is installed, probe authentication, and validate capabilities. If Gemini CLI is missing, it will offer to install it for you.

If you prefer to install Gemini CLI yourself:

```bash
npm install -g @google/gemini-cli
```

If Gemini CLI is installed but not authenticated yet, run it interactively once to complete OAuth:

```bash
!gemini
```

After install, you should see:

- The slash commands listed above (`/gemini:review`, `/gemini:rescue`, etc.)
- The `gemini:gemini-rescue` subagent in `/agents`

## Usage

### `/gemini:review`

Runs a Gemini review on your current git changes. Automatically detects staged, unstaged, and untracked files. Review mode is read-only enforced — Gemini cannot modify your workspace.

```bash
/gemini:review
/gemini:review --model flash
```

### `/gemini:adversarial-review`

Same as `/gemini:review` but with adversarial framing — challenges hidden assumptions, probes failure modes, and stress-tests edge cases.

```bash
/gemini:adversarial-review
```

### `/gemini:rescue`

Delegate a task to Gemini. Runs in foreground by default, or in the background with `--background`.

```bash
/gemini:rescue investigate the auth bug in src/middleware.ts
/gemini:rescue --background refactor the error handling in lib/
/gemini:rescue --resume   # continue previous session
```

### `/gemini:status`, `/gemini:result`, `/gemini:cancel`

Manage background jobs:

```bash
/gemini:status              # list all jobs
/gemini:status <job-id>     # detailed view
/gemini:result              # latest completed result
/gemini:result <job-id>     # specific job result
/gemini:cancel              # cancel latest running job
```

## Acknowledgments

- **[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)** — The reference implementation this project is modeled after. The plugin architecture, command structure, job tracking, and session lifecycle patterns are directly inspired by the Codex plugin.
- **[Google Gemini CLI](https://github.com/google-gemini/gemini-cli)** — The underlying AI tool this plugin integrates.

## License

Apache-2.0
