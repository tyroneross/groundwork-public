#!/usr/bin/env python3
"""Index and validate the Groundwork projects registry.

Every projects/<slug>/README.md is a pointer to where a project's data really
lives. Pointers rot silently, so --check verifies each one still resolves.

Usage:
    python3 projects/index.py            print the index table
    python3 projects/index.py --check    validate; exit 1 on any drift
    python3 projects/index.py --json     emit machine-readable index

Stdlib only, no YAML dependency: the frontmatter contract is flat key: value.
"""
import sys, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
REQUIRED = ["project", "title", "kind", "store", "location",
            "remote", "status", "registered", "updated"]
OPTIONAL = ["also_at"]  # second half of a split artifact set
KINDS = {"repo", "local"}
STORES = {"repo", "core-memory", "groundwork-designs", "in-place"}


def parse_frontmatter(path):
    """Return (dict, error). Flat `key: value` between leading --- fences."""
    text = path.read_text()
    if not text.startswith("---\n"):
        return {}, "no frontmatter fence at start of file"
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, "unterminated frontmatter fence"
    data = {}
    for i, line in enumerate(text[4:end].splitlines(), start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            return {}, f"line {i}: not a `key: value` pair"
        k, _, v = line.partition(":")
        data[k.strip()] = v.strip()
    return data, None


def load():
    entries, errors = [], []
    for d in sorted(p for p in ROOT.iterdir() if p.is_dir()):
        if d.name.startswith("_"):
            continue
        readme = d / "README.md"
        if not readme.exists():
            errors.append(f"{d.name}: missing README.md")
            continue
        fm, err = parse_frontmatter(readme)
        if err:
            errors.append(f"{d.name}/README.md: {err}")
            continue
        fm["_dir"] = d.name
        entries.append(fm)
    return entries, errors


def validate(entries):
    problems = []
    for e in entries:
        slug = e["_dir"]
        for key in REQUIRED:
            if not e.get(key):
                problems.append(f"{slug}: missing required key `{key}`")
        if e.get("project") and e["project"] != slug:
            problems.append(
                f"{slug}: `project: {e['project']}` does not match folder name")
        if e.get("kind") and e["kind"] not in KINDS:
            problems.append(f"{slug}: kind `{e['kind']}` not in {sorted(KINDS)}")
        if e.get("store") and e["store"] not in STORES:
            problems.append(f"{slug}: store `{e['store']}` not in {sorted(STORES)}")
        loc = e.get("location", "")
        if loc:
            if e.get("store") == "in-place":
                if not (ROOT / slug).exists():
                    problems.append(f"{slug}: in-place but folder is gone")
            elif not pathlib.Path(loc).expanduser().exists():
                problems.append(f"{slug}: STALE POINTER, location does not exist: {loc}")
        # Optional. A split set stores its spec spine at `location` and its
        # rendered projections at `also_at`; both halves must survive.
        alt = e.get("also_at", "")
        if alt and not pathlib.Path(alt).expanduser().exists():
            problems.append(f"{slug}: STALE also_at pointer, does not exist: {alt}")
    return problems


def main():
    args = sys.argv[1:]
    entries, load_errors = load()

    if "--json" in args:
        print(json.dumps(entries, indent=2))
        return 0

    problems = load_errors + validate(entries)

    w = max([len(e["_dir"]) for e in entries] + [7])
    print(f"{'project'.ljust(w)}  {'kind'.ljust(5)}  {'store'.ljust(18)}  status")
    print(f"{'-' * w}  {'-' * 5}  {'-' * 18}  {'-' * 22}")
    for e in entries:
        print(f"{e['_dir'].ljust(w)}  {e.get('kind','?').ljust(5)}  "
              f"{e.get('store','?').ljust(18)}  {e.get('status','?')}")
    print(f"\n{len(entries)} projects registered")

    if "--check" in args:
        if problems:
            print(f"\n{len(problems)} problem(s):", file=sys.stderr)
            for p in problems:
                print(f"  {p}", file=sys.stderr)
            return 1
        print("check: all pointers resolve, all frontmatter valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
