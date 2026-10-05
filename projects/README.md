# Groundwork Projects Registry

This folder is the index of every project Groundwork knows about on this machine.
It answers one question fast: **for a given project, what is it, where does its data
actually live, and what state is it in?**

It is not a data store. With one narrow exception (below), the real artifacts live
somewhere else and each folder here holds a pointer to them.

## This folder is gitignored on purpose

`projects/*` is excluded from version control so that anyone building with Groundwork
cannot accidentally commit, merge, or push their own project data into this repo.
Only this `README.md` and `_TEMPLATE/` ship with the plugin.

Consequence to know: if a project's real data lives *here* (a `kind: local` entry with
`store: in-place`), this folder is its only copy and nothing backs it up. Prefer giving
such a project a real home.

## The rule: pointer or move

| Where the data already lives | What happens |
|---|---|
| A git repo (`<repo>/.designdoc/`, or anywhere in a repo) | **Pointer.** Data stays. |
| A core memory store: `~/personal-llm-wiki`, `~/dev/git-folder/build-loop-memory` | **Pointer.** Data stays. |
| Groundwork's ideation root `~/dev/designs/<slug>/` | **Pointer.** Data stays. |
| A hidden, scratch, or unstructured one-off location | **Move.** Data relocates into `projects/<slug>/` and this becomes its home. |

The test is whether the current home is a structured durable store. A git repo, the
vault, build-loop-memory, and the designs root all qualify. A scratch directory, a
stray dot-folder, or a path nobody would think to look in does not.

As of the initial seed, **every registered project qualifies for a pointer.** The move
branch exists for future projects that land somewhere unstructured.

## Relationship to the storage decision in SPEC.md

`SPEC.md` locks the storage model: ideation starts in `~/dev/designs/<slug>/` and
graduates into a target repo's `.designdoc/` when it becomes a project. This registry
does not replace that. It indexes it. A project moving from designs root to a repo
updates its `location` and `store` here; the data follows the SPEC.md path as before.

## Frontmatter contract

Every `projects/<slug>/README.md` starts with:

```yaml
project: <slug>                 # must match the folder name
title: <human name>
kind: repo | local              # repo = data is under version control
store: repo | core-memory | groundwork-designs | in-place
location: <absolute path to the real data>
remote: <git remote URL, or none>
status: <short slug, free text>
data_last_modified: YYYY-MM-DD
registered: YYYY-MM-DD
updated: YYYY-MM-DD
```

One optional key:

```yaml
also_at: <absolute path>        # second half of a SPLIT artifact set
```

A split set is one Groundwork run whose spec spine and rendered projections landed in
two different roots. `location` holds the spine, `also_at` holds the projections, and
`--check` validates that both still resolve. Neither half is complete alone, so
neither may be deleted on the assumption it is a duplicate.

Below the frontmatter, four required sections: **What this is**, **Where the data
lives**, **How to update it**, **Current status**. An optional **Notes** section holds
anything unresolved.

## Adding a project

```bash
cp -r projects/_TEMPLATE projects/<slug>
$EDITOR projects/<slug>/README.md
python3 projects/index.py --check
```

## Checking the registry

```bash
python3 projects/index.py            # print the index table
python3 projects/index.py --check    # validate; exits 1 on drift
```

`--check` verifies every `location` still resolves on disk, every `project` field
matches its folder name, and every required frontmatter key is present. It catches the
failure mode this registry is most exposed to: a pointer that quietly goes stale
because the data moved or was deleted.

Status values are seeded from file modification time and are a starting guess, not a
human judgement. Correct them.
