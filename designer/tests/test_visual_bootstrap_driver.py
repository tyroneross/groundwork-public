from __future__ import annotations

import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from designer.bridge.adaptive_host_driver import (
    AdaptiveDriverError,
    drive_adaptive_session,
    normalize_base_url,
)
from designer.bridge.visual_bootstrap import (
    VisualBootstrapError,
    initialize_taste_state,
    load_visual_bootstrap,
    validate_visual_bootstrap,
    write_visual_bootstrap,
)
from designer.engine.catalog_loader import load_catalog


ROOT = Path(__file__).resolve().parents[2]
FROZEN_FIXTURE = ROOT / "docs" / "contracts" / "fixtures" / "spectra-visual-bootstrap.json"


def _spectra_payload(tmp_path: Path) -> tuple[Path, dict]:
    repo = tmp_path / "Spectra"
    (repo / "src").mkdir(parents=True)
    (repo / ".designdoc").mkdir()
    (repo / ".git").mkdir()
    (repo / "package.json").write_text("{}")
    (repo / "src" / "App.tsx").write_text("export const App = () => null")
    (repo / ".designdoc" / "design.md").write_text("# Compact workbench\nPersistent left sidebar.")
    payload = json.loads(FROZEN_FIXTURE.read_text())
    payload["product"]["repoPath"] = str(repo)
    payload["product"]["outputPath"] = str(repo / ".designdoc")
    return repo, payload


def test_frozen_spectra_bootstrap_validates_with_full_topology_and_live_catalog(tmp_path):
    repo, payload = _spectra_payload(tmp_path)
    validated = validate_visual_bootstrap(payload, require_existing_repo=True)

    assert validated["product"]["outputPath"] == str(repo / ".designdoc")
    assert [(s["platform"], s["role"]) for s in validated["context"]["platformSurfaces"]] == [
        ("macos", "primary"),
        ("web", "companion"),
    ]
    assert {(f["categoryId"], f["optionId"]) for f in validated["knownFacts"]} == {
        ("platform-target", "platform-macos"),
        ("nav-structure", "nav-structure-left"),
    }


def test_atomic_write_and_load_use_owner_only_regular_file(tmp_path):
    _, payload = _spectra_payload(tmp_path)
    destination = Path(payload["product"]["outputPath"]) / ".visual-bootstrap.json"
    write_visual_bootstrap(payload, destination)

    assert destination.is_file()
    assert destination.stat().st_mode & 0o777 == 0o600
    assert load_visual_bootstrap(destination) == validate_visual_bootstrap(
        payload, require_existing_repo=True
    )
    assert not list(destination.parent.glob(f".{destination.name}.*"))

    with pytest.raises(VisualBootstrapError, match="bootstrap path must be exactly"):
        write_visual_bootstrap(payload, tmp_path / "elsewhere.json")


def test_output_traversal_symlink_and_bad_catalog_fact_fail_closed(tmp_path):
    repo, payload = _spectra_payload(tmp_path)

    outside = copy.deepcopy(payload)
    outside["product"]["outputPath"] = str(repo / "other")
    with pytest.raises(VisualBootstrapError, match="exactly <repo>/.designdoc"):
        validate_visual_bootstrap(outside, require_existing_repo=True)

    target = tmp_path / "outside"
    target.mkdir()
    (repo / ".designdoc" / "design.md").unlink()
    (repo / ".designdoc").rmdir()
    (repo / ".designdoc").symlink_to(target, target_is_directory=True)
    with pytest.raises(VisualBootstrapError, match="may not be a symlink"):
        validate_visual_bootstrap(payload, require_existing_repo=True)

    (repo / ".designdoc").unlink()
    (repo / ".designdoc").mkdir()
    bad_fact = copy.deepcopy(payload)
    bad_fact["knownFacts"][1]["optionId"] = "density-compact"
    with pytest.raises(VisualBootstrapError, match="does not belong"):
        validate_visual_bootstrap(bad_fact, require_existing_repo=True)


def test_source_symlink_escape_and_credential_url_fail_closed(tmp_path):
    repo, payload = _spectra_payload(tmp_path)
    outside = tmp_path / "secret"
    outside.write_text("secret")
    (repo / "src" / "App.tsx").unlink()
    (repo / "src" / "App.tsx").symlink_to(outside)
    with pytest.raises(VisualBootstrapError, match="escapes the product repo"):
        validate_visual_bootstrap(payload, require_existing_repo=True)

    (repo / "src" / "App.tsx").unlink()
    (repo / "src" / "App.tsx").write_text("ok")
    payload["product"]["runningUrl"] = "http://user:secret@127.0.0.1:4173"
    with pytest.raises(VisualBootstrapError, match="may not contain credentials"):
        validate_visual_bootstrap(payload, require_existing_repo=True)


def test_unsupported_visual_primary_remains_unresolved_with_warning(tmp_path):
    _, payload = _spectra_payload(tmp_path)
    payload["context"]["platformSurfaces"][0]["platform"] = "api"
    payload["knownFacts"] = [
        fact for fact in payload["knownFacts"] if fact["categoryId"] != "platform-target"
    ]
    payload["warnings"] = ["Unsupported visual platform 'api'; platform remains unresolved."]

    validated = validate_visual_bootstrap(payload, require_existing_repo=True)
    assert not any(f["categoryId"] == "platform-target" for f in validated["knownFacts"])
    assert "remains unresolved" in validated["warnings"][0]

    invalid_projection = copy.deepcopy(payload)
    invalid_projection["knownFacts"].append({
        "categoryId": "platform-target",
        "optionId": "platform-multi",
        "provenance": "observed",
    })
    with pytest.raises(VisualBootstrapError, match="must remain unresolved"):
        validate_visual_bootstrap(invalid_projection, require_existing_repo=True)

    missing_warning = copy.deepcopy(payload)
    missing_warning["warnings"] = []
    with pytest.raises(VisualBootstrapError, match="requires an unresolved warning"):
        validate_visual_bootstrap(missing_warning, require_existing_repo=True)


def test_observed_initialization_is_idempotent_and_decided_override_wins(tmp_path):
    _, payload = _spectra_payload(tmp_path)
    catalog = load_catalog()
    state = initialize_taste_state(payload, catalog=catalog)

    observed = [entry for entry in state.history if entry["provenance"] == "OBSERVED"]
    assert len(observed) == 2
    assert {entry["category_id"] for entry in observed} == {"platform-target", "nav-structure"}
    assert all(entry["source"] == "extract" for entry in observed)
    assert "platform-target" in state.asked
    assert "platform-target" not in {item.id for item in state.undetermined_categories(catalog)}
    assert state.context["platformSurfaces"][1]["role"] == "companion"
    history_before = copy.deepcopy(state.history)

    same = initialize_taste_state(payload, state, catalog=catalog)
    assert same is state
    assert state.history == history_before

    platform = catalog.by_id()["platform-target"]
    web = next(option for option in platform.options if option.id == "platform-web")
    state.apply_pick(platform.id, web.id, web.token_delta)
    assert state.history[-1]["provenance"] == "DECIDED"
    assert any(entry["provenance"] == "OBSERVED" for entry in state.history[:-1])
    assert next(
        entry for entry in state.extracted_picks() if entry["category_id"] == "platform-target"
    )["option_id"] == "platform-web"

    initialize_taste_state(payload, state, catalog=catalog)
    assert next(
        entry for entry in state.extracted_picks() if entry["category_id"] == "platform-target"
    )["option_id"] == "platform-web"


def test_host_driver_retries_stale_turn_and_stays_attached_until_done():
    class Handler(BaseHTTPRequestHandler):
        get_count = 0
        post_count = 0
        paths: list[tuple[str, str]] = []

        def log_message(self, _format, *_args):
            return

        def _send(self, payload):
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            type(self).paths.append(("GET", self.path))
            type(self).get_count += 1
            if type(self).get_count >= 3:
                return self._send({"phase": "done", "done": True})
            seq = type(self).get_count - 1
            self._send({
                "phase": "await_agent",
                "seq": seq,
                "contract": {"candidates": [{"id": "nav-structure"}], "answer": None},
            })

        def do_POST(self):
            type(self).paths.append(("POST", self.path))
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            assert body["answer"]["action"] == "ask"
            type(self).post_count += 1
            if type(self).post_count == 1:
                return self._send({"ok": False, "stale": True, "seq": 1})
            self._send({"ok": True, "seq": 2})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base_url = f"http://127.0.0.1:{server.server_port}"

        def answer(contract):
            contract["answer"] = {
                "action": "ask",
                "chosen_category_id": contract["candidates"][0]["id"],
                "rationale": "highest information gain",
            }
            return contract

        result = drive_adaptive_session(base_url, answer, poll_interval=0)
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert result["status"] == "done"
    assert result["turns"] == 1
    assert Handler.paths == [
        ("GET", "/api/agent/contract"),
        ("POST", "/api/agent/answer"),
        ("GET", "/api/agent/contract"),
        ("POST", "/api/agent/answer"),
        ("GET", "/api/agent/contract"),
    ]


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:8910",
        "http://example.com:8910",
        "http://user:secret@127.0.0.1:8910",
        "http://127.0.0.1",
    ],
)
def test_host_driver_rejects_non_loopback_credentialed_or_portless_urls(url):
    with pytest.raises(AdaptiveDriverError):
        normalize_base_url(url)


def test_claude_and_codex_entries_share_attached_driver_contract():
    command = (ROOT / "commands" / "run.md").read_text()
    skill = (ROOT / "skills" / "groundwork" / "SKILL.md").read_text()
    explore = (ROOT / "references" / "explore-ui.md").read_text()

    for text in (command, skill):
        assert "--bootstrap <file>" in text
        assert "GET /api/agent/contract" in text
        assert "POST /api/agent/answer" in text
        assert "user explicitly pauses" in text
    assert "adaptive_host_driver.py" in explore
    assert "--bootstrap \"$GW_BOOTSTRAP\" --drive adaptive" in explore
    assert "Existing product" in explore and "do not ask" in explore
