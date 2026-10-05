---
project: <slug>
title: <Human Readable Name>
kind: repo
store: repo
location: /absolute/path/to/where/the/data/actually/lives
remote: none
status: unknown
data_last_modified: YYYY-MM-DD
registered: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Human Readable Name>

## What this is

One or two sentences. What the project is for, and what stage it is at.

## Where the data lives

State whether this folder is a pointer or the home.

- **Location:** `/absolute/path`
- **Store type:** `repo` | `core-memory` | `groundwork-designs` | `in-place`
- **Remote:** URL or `none`

If `store: in-place`, say so plainly: the data is in this gitignored folder and
nothing backs it up.

## How to update it

The exact command or path. Assume a reader with zero context who needs to act.

## Current status

What state it is in, and what the next action is. Name the blocker if there is one.

## Notes

Anything unresolved, any trap, any related artifact worth chasing.
