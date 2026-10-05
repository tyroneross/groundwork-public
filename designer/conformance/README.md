# Flow-doc ↔ CLI conformance

Catches the defect class a green unit-test suite structurally cannot: the flow
docs drift from the CLIs they document, and CLIs silently accept malformed input.
Both are deterministic, so they are a check that FIRES — not a memory note or a
skill that only fires when recalled.

| Check | Catches |
|-------|---------|
| doc-command drift (python) | a `python3 -m designer.*` command in a flow doc names a subcommand or `--flag` that doesn't exist (validated against `--help`, no side effects) |
| doc-command drift (node) | a documented `node designer/*.mjs --flag` names a flag the source never parses |
| CLI input validation | a CLI fed a typo'd dimension / unknown enum value deadlocks or silently substitutes a default instead of rejecting with a nonzero exit |

Origin: the 2026-07-11 color-engine audit found F1 (doc documented a `preview`
flag that didn't exist) and D2/D3 (a typo'd `--dim` deadlocked the loop; a bad
`--value` was silently accepted). This check would have caught all three.

## Run

```bash
python3 -m designer.conformance.flow_cli_check            # all checks, exit nonzero on fail
python3 -m designer.conformance.flow_cli_check --verbose  # print every check
python3 -m designer.conformance.flow_cli_check --selftest # mutation-prove the checks bite
```

Each check is mutation-validated in `--selftest`: it injects a bogus flag and a
disabled validator and asserts the check FAILS, so a check that quietly stopped
working is itself caught.

## Activation

It fires automatically via the aggregate gate `scripts/check.sh`, wired to:
- `npm test`
- the committed `.githooks/pre-push` hook — activate once per clone:
  `git config core.hooksPath .githooks`
