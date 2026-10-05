---
name: submit-feedback
description: Report a bug or request a feature for the groundwork plugin. Drafts a GitHub issue and files it only after you approve the exact text.
argument-hint: "[what broke, or what you wish it did]"
---

# Submit groundwork feedback

File the user's report as a GitHub issue on `tyroneross/groundwork-public`. Issues are this plugin's
support channel; the manifest carries no contact address by design.

Two kinds of report land here and they need different bodies:

- **Bug** - something behaved wrong. Needs what happened, what was expected, and how to reproduce it.
- **Feature request** - something is missing. Needs the task the user was trying to finish and what
  they had to do instead. Capture the problem, not a proposed implementation.

## Steps

1. **Classify.** If `$ARGUMENTS` or the conversation has not already made it obvious, ask one
   question: bug or feature request? One question, not a form.

2. **Gather just enough context.**
   - Both: the plugin's installed version. `.claude-plugin/plugin.json` declares a `version` only
     when this plugin pins one; when it omits the key the version resolves to the git commit SHA, so
     report `git -C "${CLAUDE_PLUGIN_ROOT:-.}" rev-parse --short HEAD` instead.
   - Both: `claude --version` and `uname -sm`.
   - Bug only: which command or skill misbehaved, and what it did instead.
   - Feature only: the workflow the user was in when the gap showed up.

3. **Check for a duplicate.** `gh issue list --repo tyroneross/groundwork-public --search "<keywords>" --state all`.
   If an open issue already covers this, offer to add a comment instead of opening a second one.

4. **Draft and show.** Write the exact title and body you intend to file, and show both to the user
   in full. Their report, their words. Do not summarize away detail they gave you.

5. **Get explicit approval before creating anything.** Ask with `AskUserQuestion`:
   *File it as shown* / *Let me edit it first* / *Cancel*. A GitHub issue on a public repo is
   outward-facing and cannot be unpublished, so silence, an earlier "sounds good", or an implied yes
   are not approval. Only a direct answer to this question counts. On *edit*, revise and ask again.

6. **Create it** (only after approval):

```bash
gh issue create --repo tyroneross/groundwork-public \
  --title "<one line: what broke, or what is missing>" \
  --body "<bug: what happened / expected / steps / versions. request: the problem, the workaround, why now>" \
  --label bug   # use "enhancement" for a feature request; drop the flag if the repo has no such label
```

7. **If `gh` is missing or unauthenticated, do not fail.** Print the drafted title and body for the
   user to paste, plus the URL: https://github.com/tyroneross/groundwork-public/issues/new

8. **Report the resulting issue URL** back to the user.

## Rules

- A GitHub issue is public and permanent. Redact secrets, tokens, absolute home paths, employer or
  client names, and any file contents the user has not seen before sending.
- Never file without showing the body first and receiving explicit approval. No approval, no issue.
- One report, one issue. Comment on an existing thread rather than opening a near-duplicate.
