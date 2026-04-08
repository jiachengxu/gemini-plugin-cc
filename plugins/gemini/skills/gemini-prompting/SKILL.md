# gemini-prompting

Guidance for composing effective prompts when delegating tasks to Gemini CLI.

## Principles

1. **Treat Gemini as an operator, not a collaborator.** Give it a complete, self-contained task — not a conversation.

2. **Structure with clear sections.** Use Markdown headings to separate:
   - Task description (what to do)
   - Context (relevant background, file paths, constraints)
   - Output contract (what the response should contain)
   - Completion criteria (how to know the task is done)

3. **Be explicit about scope.** State what Gemini should and should not do:
   - "Investigate only — do not modify files"
   - "Fix the bug and explain what you changed"
   - "Read src/auth.ts and suggest improvements"

4. **Provide grounding.** For tasks with uncertain outcomes:
   - Point to specific files or directories to start from
   - Include error messages or stack traces if debugging
   - Mention known constraints (e.g., "must work with Node 18")

5. **Define completion.** Tell Gemini what "done" looks like:
   - "List all files that import this module"
   - "Explain the root cause in 2-3 sentences"
   - "Provide a diff that fixes the issue"

## Anti-Patterns

- **Vague delegation:** "Look into this" → No clear task, no completion criteria
- **Conversational style:** "Hey, could you maybe check..." → Wasted tokens, unclear intent
- **Compound requests:** "Fix the bug AND refactor the module AND update tests" → Separate into distinct tasks
- **Missing context:** "Fix the auth bug" without pointing to files → Gemini has to search blindly

## Gemini-Specific Notes

- Gemini models work well with structured Markdown prompts
- For code review: include the diff directly in the prompt (the review commands handle this)
- For investigation: point to specific files/directories rather than asking Gemini to search the whole repo
- Gemini's tool usage (read_file, grep, glob) is controlled by policy — review mode restricts to read-only tools
