"""Reject tracked private artifact classes and personal workstation paths."""
from pathlib import Path, PurePosixPath
import json
import re
import subprocess
import sys

PRIVATE_ROOTS = (".build-loop", ".designdoc", ".ibr", ".rally", ".bookmark",
                 ".procedural", ".claude-code-debugger", ".groundwork-workspace",
                 "docs/reviews", "docs/plans", "docs/hosted-app",
                 "references/design-library/snapshots")


def violations(relative, data):
    path = PurePosixPath(relative)
    errors = []
    if any(relative == root or relative.startswith(root + "/") for root in PRIVATE_ROOTS):
        errors.append("private artifact directory")
    if relative.startswith("designer/references/dashboards/") and path.suffix == ".html":
        errors.append("captured project dashboard")
    if relative.startswith("projects/") and not (relative in ("projects/README.md", "projects/index.py") or relative.startswith("projects/_TEMPLATE/")):
        errors.append("local project registry entry")
    if relative == "designer/color/combos.jsonl" and data.strip():
        errors.append("preference history")
    if path.name.startswith(".env") or path.suffix.lower() in (".pem", ".key", ".p12", ".pfx"):
        errors.append("credential-shaped file")
    text = data.decode("utf-8", errors="ignore")
    if re.search(r"/Users/" + "tyrone" + r"ross\b", text):
        errors.append("personal workstation path")
    if re.search("-----BEGIN " + r"(?:RSA |EC |OPENSSH )?" + "PRIVATE" + r" KEY-----\s+[A-Za-z0-9+/=\s]{64,}", text):
        errors.append("private key material")
    return errors


def check(repo):
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=repo).decode().split("\0")
    if not any(names):
        return [{"path": ".", "reason": "no indexed source files to audit"}]
    findings = []
    for name in filter(None, names):
        data = subprocess.check_output(["git", "show", ":" + name], cwd=repo)
        for reason in violations(name, data):
            findings.append({"path": name, "reason": reason})
    return findings


if __name__ == "__main__":
    findings = check(Path(__file__).resolve().parents[1])
    print(json.dumps({"passed": not findings, "findings": findings}, indent=2))
    sys.exit(bool(findings))
