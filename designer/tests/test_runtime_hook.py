"""The configured Git hook must reject staged local state in a real commit."""

from pathlib import Path
import shutil
import subprocess
import time


ROOT = Path(__file__).resolve().parents[2]


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


def test_pre_commit_blocks_runtime_state(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    assert git(repo, "init", "-q").returncode == 0
    assert git(repo, "config", "user.name", "Hook Test").returncode == 0
    assert git(repo, "config", "user.email", "hook@example.invalid").returncode == 0
    assert git(repo, "config", "core.hooksPath", ".githooks").returncode == 0

    (repo / ".githooks").mkdir()
    (repo / "scripts").mkdir()
    shutil.copy2(ROOT / ".githooks/pre-commit", repo / ".githooks/pre-commit")
    shutil.copy2(ROOT / ".githooks/post-commit", repo / ".githooks/post-commit")
    shutil.copy2(ROOT / "scripts/check_runtime_state.py", repo / "scripts/check_runtime_state.py")
    marker = repo / "capture-ran"
    (repo / ".githooks/.rally-point-capture.py").write_text(
        f"from pathlib import Path\nPath({str(marker)!r}).write_text('captured')\n"
    )
    (repo / "README.md").write_text("safe\n")
    assert git(repo, "add", "README.md").returncode == 0
    assert git(repo, "commit", "-qm", "safe").returncode == 0
    for _ in range(50):
        if marker.exists():
            break
        time.sleep(0.02)
    assert marker.read_text() == "captured"
    head = git(repo, "rev-parse", "HEAD").stdout.strip()

    (repo / ".bookmark").mkdir()
    (repo / ".bookmark/state.json").write_text("{}\n")
    assert git(repo, "add", ".bookmark/state.json").returncode == 0
    rejected = git(repo, "commit", "-qm", "unsafe")
    assert rejected.returncode != 0
    assert ".bookmark/state.json" in rejected.stderr
    assert git(repo, "rev-parse", "HEAD").stdout.strip() == head
