# CLAUDE.md

## context.md rule

`context.md` is this project's persistent memory and current source of truth.

### Before any change

1. Read `context.md` first.
2. Understand the current requirements, decisions, known issues, and project status.
3. Inspect only the code and files relevant to the current task.
4. Do not reread the entire chat history unless required information is missing
   from `context.md`.

### After any meaningful change

Update `context.md` with the new:

- Requirement or decision
- Change or fix
- Important implementation detail
- Remaining issue, if any

Keep the file short, structured, and current. Remove outdated or duplicate
information instead of letting the file grow indefinitely.

### Accuracy rule

`context.md` saves tokens; it does not replace verification. Always verify the
actual code and implementation before making changes. If `context.md` conflicts
with the current implementation, verify the situation and update `context.md`
accordingly.

### Priority

Current user instruction > verified implementation > `context.md` > old chat
history.

### Required workflow

Read `context.md` → Inspect → Change → Test/Verify → Update `context.md`.

Never sacrifice accuracy, testing, or reasoning to save tokens.
