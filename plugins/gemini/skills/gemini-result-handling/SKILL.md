# gemini-result-handling

Standards for presenting Gemini CLI output back to the user.

## Core Rules

1. **Preserve verbatim.** Return Gemini's verdict, summary, findings, file paths, and line numbers exactly as received.

2. **Severity ordering.** Present findings ordered by severity: critical → error → warning → info.

3. **File references.** Maintain exact file paths and line numbers (e.g., `src/auth.ts:42`). Do not resolve, abbreviate, or strip these references.

4. **Stop after findings.** After presenting review findings, **STOP**. Do not:
   - Automatically implement fixes
   - Suggest code changes inline
   - Start modifying files
   - Ask if the user wants fixes applied

   The user must explicitly request follow-up action.

5. **No substitution.** Never substitute Claude-side analysis for incomplete or failed Gemini runs. If Gemini's run was incomplete:
   - State explicitly that the run was incomplete
   - Show whatever partial output exists
   - Do not fill in gaps with Claude's own analysis

6. **Empty results.** When Gemini reports no findings, state "No issues found" explicitly. Do not invent issues or add caveats.

## Background Job Results

When presenting results from `/gemini:result`:

- Show the rendered output as-is
- Include the job ID and model used
- If the job failed, show the error and suggest next steps
- If the session expired, note this and suggest running without `--resume`
