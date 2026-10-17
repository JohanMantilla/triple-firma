## What and why

<!-- One or two lines. The PR title must follow Conventional Commits: type(scope): description -->

## Checklist

- [ ] Title is `<type>(<scope>): <description>`, lowercase, 72 characters max, and the branch is `<type>/<scope>-<topic>` (CI checks both)
- [ ] Will be merged with **Squash and merge**, keeping the title
- [ ] Only touches folders I own (changes to `src/contracts/` approved by A)
- [ ] Names follow the glossary in `CLAUDE.md`; new concepts were added to it in this PR
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass locally
- [ ] Changes to `src/engine/` were reviewed with the `rules-auditor` subagent
- [ ] No secrets, no real customer or company data
