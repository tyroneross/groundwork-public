#!/usr/bin/env python3
"""Loopback transport for an attached Groundwork adaptive host agent.

The host model remains responsible for reasoning over each returned contract.
This module provides the shared Claude/Codex transport, stale-turn handling, and
bounded local HTTP behavior without adding an SDK or credential requirement.
"""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


class AdaptiveDriverError(RuntimeError):
    """Raised when the local Designer driver contract cannot be completed."""


def normalize_base_url(value: str) -> str:
    """Accept loopback HTTP only and return a normalized URL without a path."""
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise AdaptiveDriverError("adaptive driver URL must use HTTP on loopback")
    if parsed.username or parsed.password:
        raise AdaptiveDriverError("adaptive driver URL may not contain credentials")
    if not parsed.port:
        raise AdaptiveDriverError("adaptive driver URL must include the Designer port")
    return urlunsplit(("http", parsed.netloc, "", "", "")).rstrip("/")


def _json_request(
    base_url: str,
    endpoint: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: float = 30,
) -> dict[str, Any]:
    url = normalize_base_url(base_url) + endpoint
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=body, method=method, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise AdaptiveDriverError(f"Designer returned HTTP {exc.code}: {detail}") from exc
    except (OSError, URLError) as exc:
        raise AdaptiveDriverError(f"Designer request failed: {exc}") from exc
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AdaptiveDriverError("Designer returned invalid JSON") from exc
    if not isinstance(decoded, dict):
        raise AdaptiveDriverError("Designer returned a non-object response")
    return decoded


def get_agent_contract(base_url: str, *, timeout: float = 30) -> dict[str, Any]:
    """Poll the host read endpoint; polling itself marks the agent attached."""
    return _json_request(base_url, "/api/agent/contract", timeout=timeout)


def post_agent_answer(
    base_url: str,
    answer: dict[str, Any],
    *,
    timeout: float = 30,
) -> dict[str, Any]:
    """Submit one full filled contract to the host write endpoint."""
    if not isinstance(answer, dict) or not isinstance(answer.get("answer"), dict):
        raise AdaptiveDriverError("answer payload must be the full contract with an answer block")
    return _json_request(
        base_url,
        "/api/agent/answer",
        method="POST",
        payload=answer,
        timeout=timeout,
    )


def drive_adaptive_session(
    base_url: str,
    answer_contract: Callable[[dict[str, Any]], dict[str, Any]],
    *,
    should_pause: Callable[[], bool] | None = None,
    poll_interval: float = 0.25,
    max_turns: int | None = None,
) -> dict[str, Any]:
    """Stay attached until convergence or an explicit host pause.

    ``answer_contract`` is the host-reasoning callback. It receives the full
    contract and must return that contract with a valid ``answer`` block. A
    stale response is re-polled instead of replayed.
    """
    turns = 0
    while True:
        if should_pause and should_pause():
            return {"status": "paused", "turns": turns}
        packet = get_agent_contract(base_url)
        if packet.get("done") or packet.get("phase") == "done":
            return {"status": "done", "turns": turns, "packet": packet}
        contract = packet.get("contract")
        if packet.get("waiting") or not isinstance(contract, dict):
            time.sleep(poll_interval)
            continue
        answer = answer_contract(copy_contract(contract))
        if not isinstance(answer, dict):
            raise AdaptiveDriverError("host answer callback must return a JSON object")
        if "seq" not in answer and "seq" in packet:
            answer["seq"] = packet["seq"]
        response = post_agent_answer(base_url, answer)
        if response.get("stale"):
            continue
        if response.get("ok") is False:
            raise AdaptiveDriverError(str(response.get("error") or "Designer rejected host answer"))
        turns += 1
        if max_turns is not None and turns >= max_turns:
            return {"status": "paused", "reason": "max_turns", "turns": turns}


def copy_contract(contract: dict[str, Any]) -> dict[str, Any]:
    """JSON-safe deep copy without importing the engine or mutating its packet."""
    return json.loads(json.dumps(contract))


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Groundwork adaptive host transport")
    parser.add_argument("--url", required=True, help="Loopback Designer URL including port")
    parser.add_argument("--timeout", type=float, default=30)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("contract")
    answer_parser = sub.add_parser("answer")
    answer_parser.add_argument("--file", required=True)
    args = parser.parse_args(argv)

    if args.command == "contract":
        result = get_agent_contract(args.url, timeout=args.timeout)
    else:
        with open(args.file, encoding="utf-8") as handle:
            answer = json.load(handle)
        result = post_agent_answer(args.url, answer, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
