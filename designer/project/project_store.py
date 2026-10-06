"""Python project store. Frozen interface: project-store-plan.md sections A-E + AM-1..AM-16.

The JS twin `project-store.mjs` must produce byte-identical files; the parity
harness (designer/tests/test_project_parity.py) runs one op script through both.
Stdlib only.

Parity rules chosen under AM-16 (identical comment at the top of project-store.mjs):
  P1  Clock: one now() per outermost lock acquisition (the "op stamp"); every
      record written under that lock, the lock's acquiredAt included, uses it.
      Outside a lock, a read calls now() only when it needs a value
      (absent project.json default doc; snapshot generatedAt, which the
      absent default doc then reuses).
  P2  write_bytes/write_json: rel is relative to .groundwork/ (AM-12), the
      caller must hold the lock (StoreError state), identical bytes are not
      rewritten. Every outermost lock writes .groundwork/.gitignore if absent.
  P3  Board entry `valid` = JSON object whose schema is decision-set/v1; errors
      are language-neutral strings. Full decision_record.validate is not run
      (the JS side cannot run it).
  P4  Decision items follow decision_record.Ruleable; id/title that resolve to
      "" become null (AM-7).
  P5  Workspace notes in the D-02u projection need a string id and string
      text; non-string createdAt/processedAt read as null; sort key is
      (createdAt or "", id).
  P6  upsert_draft with identical fields changes nothing; add_feedback with an
      existing id is idempotent when text+section match (submits a draft when
      submit=True), else StoreError state; submit of a submitted item with
      the same/no text is a no-op, different text -> state; submit of a
      processed item -> state (no backward move).
  P7  Saved-work submit (submit_feedback or add_feedback submit=True) mirrors a
      workspace note in the same lock whenever the item ends "submitted" and
      no note with that id exists (AM-5).
  P8  record_migration with migratedAt None keeps the old migratedAt when the
      rest of the entry is unchanged, else stamps now.
  P9  Artifact mtime = the path's own mtime (directory mtime for canvas),
      floored to ms from st_mtime_ns. Canvas htmlFile tie on mtime -> the
      smallest name.
  P10 Snapshot warnings order: lock warnings; per migration (error ->
      migration-failed, conflict -> conflict); workspace conflict;
      canvas-invalid-rows; legacy-unmigrated per board.
  P11 read_board falls back to the legacy .designdoc/<slug>/decisions.json.
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import json
import os
import re
import socket
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

from designer.decisions import decision_record as dr

SCHEMA = "groundwork.project/v1"
SNAPSHOT_SCHEMA = "groundwork.project-snapshot/v1"
CONTRACT_SCHEMA = "groundwork.project-agent-contract/v1"
SECTIONS = ("decisions", "canvas", "saved-work", "spec", "memory", "general")

DIR = ".groundwork"
SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
FB_ID_RE = re.compile(r"^fb_[A-Za-z0-9_-]{1,97}$")
STATUSES = ("draft", "submitted", "processed")
SCOPES = ("repo", "decisions", "canvas", "saved-work", "spec")
PROV_SOURCES = ("person", "agent", "decision", "migration")
ARTIFACT_KINDS = ("spec", "designer-state", "canvas")
MIGRATION_KINDS = ("decision-board", "workspace", "pointer")
MIGRATION_STATUSES = ("migrated", "unchanged", "recopied", "conflict", "error")
MAX_FEEDBACK, MAX_PREFS = 5000, 500
LOCK_TIMEOUT_MS, LOCK_RETRY_MS = 2000, 25
LEGACY_WORKSPACES = (".designdoc/.groundwork-workspace/workspace.json",
                     ".groundwork-workspace/workspace.json")
CANVAS_DIRS = (".designdoc/mockups/.canvas", "mockups/.canvas")
WORKSPACE_MIGRATION_ID = "workspace:workspace.json"
WS_ORIGIN_REF = ".groundwork/workspace.json"


class StoreError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def canonical(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _iso_ns(ns: int) -> str:
    ms = ns // 1_000_000
    return _iso(datetime.fromtimestamp(ms // 1000, timezone.utc).replace(microsecond=(ms % 1000) * 1000))


def _default_now() -> str:
    return _iso(datetime.now(timezone.utc))


def _default_new_id(prefix: str) -> str:
    return prefix + uuid.uuid4().hex


def _s(v: Any) -> str:
    """JS template-literal rendering for the values warnings interpolate."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    return str(v)


def project_root(target: Any) -> Path:
    """AM-8: realpath; under a .groundwork component -> its parent; .designdoc -> parent."""
    p = Path(target).resolve()
    parts = p.parts
    if DIR in parts:
        return Path(*parts[:parts.index(DIR)])
    return p.parent if p.name == ".designdoc" else p


def decision_summary(record: dict) -> dict:
    items = []
    counts = {"open": 0, "ruled": 0}
    for r in dr.ruleables(record):
        lane = r.lane
        counts[lane] += 1
        items.append({"id": r.id if r.id != "" else None, "source": r.source,
                      "title": None if r.title == "" else r.title, "lane": lane,
                      "ruling": r.chosen, "note": r.free_text, "ruledAt": r.ruled_at})
    return {"open": counts["open"], "ruled": counts["ruled"], "items": items}


def _pid_dead(pid: Any) -> bool:
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def _clean_text(text: Any, lo: int, hi: int, what: str) -> str:
    if not isinstance(text, str):
        raise StoreError("invalid", f"{what} text must be a string")
    t = text.strip()
    if not (lo <= len(t) <= hi):
        raise StoreError("invalid", f"{what} text must be {lo}-{hi} characters after trim")
    return t


def _clean_origin(origin: Any) -> dict | None:
    if origin is None:
        return None
    if not isinstance(origin, dict) or origin.get("kind") not in ("person", "agent"):
        raise StoreError("invalid", "origin.kind must be person or agent")
    ref = origin.get("ref")
    if ref is not None and not isinstance(ref, str):
        raise StoreError("invalid", "origin.ref must be string or null")
    return {"kind": origin["kind"], "ref": ref}


def _clean_target(target: Any) -> str | None:
    if target is None:
        return None
    if not isinstance(target, str) or len(target) > 200:
        raise StoreError("invalid", "target must be null or a string up to 200 chars")
    return target


def validate_feedback_input(section: Any, text: Any, target: Any = None, origin: Any = None,
                            id: Any = None) -> dict:
    if section not in SECTIONS:
        raise StoreError("invalid", f"section must be one of {', '.join(SECTIONS)}")
    if id is not None and (not isinstance(id, str) or not FB_ID_RE.match(id)):
        raise StoreError("invalid", "feedback id must match ^fb_[A-Za-z0-9_-]{1,97}$")
    return {"id": id, "section": section, "text": _clean_text(text, 1, 4000, "feedback"),
            "target": _clean_target(target), "origin": _clean_origin(origin)}


def validate_preference_input(text: Any, scope: Any = "repo", provenance: Any = None) -> dict:
    if scope not in SCOPES:
        raise StoreError("invalid", f"scope must be one of {', '.join(SCOPES)}")
    if provenance is None:
        provenance = {"source": "person", "ref": None}
    if not isinstance(provenance, dict) or provenance.get("source") not in PROV_SOURCES:
        raise StoreError("invalid", f"provenance.source must be one of {', '.join(PROV_SOURCES)}")
    ref = provenance.get("ref")
    if ref is not None and not isinstance(ref, str):
        raise StoreError("invalid", "provenance.ref must be string or null")
    return {"text": _clean_text(text, 1, 2000, "preference"), "scope": scope,
            "provenance": {"source": provenance["source"], "ref": ref}}


# ------------------------------------------------------------------ workspace
_JS_INT_RE = re.compile(r"^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)$")


def _js_join(v: Any) -> str:
    """JS String(v) as Array.prototype.join would render an element."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (int, float, str)):
        return str(v)
    if isinstance(v, list):
        return ",".join(_js_join(x) for x in v)
    return "[object Object]"


def _js_number(v: Any) -> float:
    """JS Number(v) for JSON values (NaN as float('nan'))."""
    nan = float("nan")
    if v is None:
        return 0
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0
        if re.fullmatch(r"0[xX][0-9a-fA-F]+", s):
            return int(s, 16)
        if s in ("Infinity", "+Infinity"):
            return float("inf")
        if s == "-Infinity":
            return float("-inf")
        return float(s) if _JS_INT_RE.match(s) else nan
    if isinstance(v, list):
        return _js_number(_js_join(v))
    return nan


def normalize_review(review: Any = None) -> dict:
    """Frozen copy of designer/server/workspace-store.mjs:13-20 (AM-4)."""
    r = review if isinstance(review, dict) else {}
    n = _js_number(r.get("optionCount"))
    if n != n or n == 0:  # NaN or 0 -> `|| 3`
        n = 3
    n = min(5, max(2, n))
    if isinstance(n, float) and n.is_integer():
        n = int(n)
    return {"suggestions": r.get("suggestions") is not False,
            "optionCount": n,
            "layout": "single" if r.get("layout") == "single" else "compare",
            "fidelity": "polished" if r.get("fidelity") == "polished" else "low"}


def _empty_workspace() -> dict:
    return {"version": 1, "notes": [], "alternatives": [], "selectedId": None, "sources": [],
            "review": {"suggestions": True, "optionCount": 3, "layout": "compare", "fidelity": "low"}}


def _check_workspace(value: Any, file: str) -> dict:
    if not (isinstance(value, dict) and value.get("version") == 1 and not isinstance(value.get("version"), bool)
            and all(isinstance(value.get(k), list) for k in ("notes", "alternatives", "sources"))):
        raise StoreError("invalid", f"{file} is not a supported workspace record")
    return value


def _check_project_doc(doc: Any) -> dict:
    if not (isinstance(doc, dict) and doc.get("schema") == SCHEMA and isinstance(doc.get("rev"), int)
            and not isinstance(doc.get("rev"), bool)
            and all(isinstance(doc.get(k), list) for k in ("feedback", "preferences", "artifacts", "migrations"))):
        raise StoreError("invalid", f"project.json is not a {SCHEMA} document")
    return doc


def _pref_key(p: dict) -> tuple:
    return (0 if p.get("status") == "active" else 1, p.get("createdAt") or "", p.get("id") or "")


class ProjectStore:
    def __init__(self, root: Any, *, now: Callable[[], str] | None = None,
                 new_id: Callable[[str], str] | None = None, tool: str = "python") -> None:
        self.root = project_root(root)
        self.dir = self.root / DIR
        self.now = now or _default_now
        self.new_id = new_id or _default_new_id
        self.tool = tool
        self.warnings: list[dict] = []
        self._depth = 0
        self._op_t: str | None = None
        self._tlock = threading.RLock()

    # ------------------------------------------------------------ paths/guards
    def _check_symlink(self, p: Path) -> None:
        if p.is_symlink():
            raise StoreError("symlink", f"refusing symlink: {p}")

    def _check_dir(self) -> None:
        self._check_symlink(self.dir)

    def _check_chain(self, base: Path, rel: str) -> None:
        cur = base
        for part in Path(rel).parts:
            cur = cur / part
            self._check_symlink(cur)

    def _rel(self, rel: str) -> Path:
        if not isinstance(rel, str) or not rel or os.path.isabs(rel) or ".." in re.split(r"[\\/]", rel):
            raise StoreError("invalid", f"bad relative path: {rel!r}")
        return self.root / rel

    def _inside(self, rel: str) -> Path:
        """AM-12: store-relative path (under .groundwork/)."""
        if not isinstance(rel, str) or not rel or os.path.isabs(rel) or ".." in re.split(r"[\\/]", rel):
            raise StoreError("invalid", f"invalid store path: {rel!r}")
        return self.dir / rel

    def _stamp(self) -> str:
        return self._op_t if self._depth > 0 and self._op_t is not None else self.now()

    # ------------------------------------------------------------------ lock
    @contextlib.contextmanager
    def lock(self) -> Iterator[None]:
        with self._tlock:
            if self._depth > 0:
                self._depth += 1
                try:
                    yield
                finally:
                    self._depth -= 1
                return
            self._check_dir()
            self.dir.mkdir(parents=True, exist_ok=True)
            self._check_dir()
            path = self.dir / "write.lock"
            t = self.now()
            self._acquire(path, t)
            self._depth = 1
            self._op_t = t
            try:
                gi = self.dir / ".gitignore"
                if not os.path.lexists(gi):
                    self.write_bytes(".gitignore", b"*\n")
                yield
            finally:
                self._depth = 0
                self._op_t = None
                with contextlib.suppress(FileNotFoundError):
                    os.unlink(path)

    def _try_create(self, path: Path, t: str) -> bool:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            return False
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"pid": os.getpid(), "host": socket.gethostname(),
                                 "tool": self.tool, "acquiredAt": t}))
        return True

    def _acquire(self, path: Path, t: str) -> None:
        deadline = time.monotonic() + LOCK_TIMEOUT_MS / 1000
        while True:
            if self._try_create(path, t):
                return
            if time.monotonic() >= deadline:
                break
            time.sleep(LOCK_RETRY_MS / 1000)
        holder: Any = {}
        try:
            holder = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            holder = {}
        if isinstance(holder, dict) and holder.get("host") == socket.gethostname() \
                and _pid_dead(holder.get("pid")):
            with contextlib.suppress(FileNotFoundError):
                os.unlink(path)
            self.warnings.append({"code": "lock-stale-broken",
                                  "detail": f"removed stale lock {path} held by dead pid {holder.get('pid')}"})
            if self._try_create(path, t):
                return
        pid = holder.get("pid") if isinstance(holder, dict) else None
        raise StoreError("lock-timeout", f"write lock {path} is held by pid {pid}; retry after the other writer finishes")

    # ----------------------------------------------------------------- writes
    def write_bytes(self, rel: str, data: bytes) -> bool:
        """Atomic write of `data` to .groundwork/<rel> (AM-12). Caller holds the lock."""
        if self._depth < 1:
            raise StoreError("state", "write_bytes requires the write lock (use `with store.lock():`)")
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise StoreError("invalid", "data must be bytes")
        data = bytes(data)
        target = self._inside(rel)
        self._check_dir()
        self._check_chain(self.dir, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        self._check_chain(self.dir, rel)
        if os.path.lexists(target):
            if not target.is_file():
                raise StoreError("invalid", f"not a regular file: {target}")
            if target.read_bytes() == data:
                return False
        tmp = target.parent / f".{target.name}.{uuid.uuid4().hex}.tmp"
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, target)
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp)
        return True

    def write_json(self, rel: str, value: Any) -> bool:
        return self.write_bytes(rel, canonical(value).encode("utf-8"))

    # ------------------------------------------------------------------ project
    def _default_doc(self, t: str | None = None) -> dict:
        t = t if t is not None else self._stamp()
        return {"schema": SCHEMA, "rev": 0, "createdAt": t, "updatedAt": t,
                "feedback": [], "preferences": [], "artifacts": [], "migrations": []}

    def read_project(self, _t: str | None = None) -> dict:
        self._check_dir()
        p = self.dir / "project.json"
        self._check_symlink(p)
        if not p.exists():
            return self._default_doc(_t)
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except ValueError as e:
            raise StoreError("invalid", f"project.json is not valid JSON: {e}")
        return _check_project_doc(doc)

    def init(self) -> dict:
        with self.lock():
            p = self.dir / "project.json"
            self._check_symlink(p)
            if not p.exists():
                self.write_json("project.json", self._default_doc())
            return self.read_project()

    def mutate(self, fn: Callable[[dict], Any]) -> Any:
        with self.lock():
            doc = self.read_project()
            before = canonical(doc)
            result = fn(doc)
            if canonical(doc) != before:
                doc["rev"] = doc["rev"] + 1
                doc["updatedAt"] = self._stamp()
                self.write_json("project.json", doc)
            return result

    # ----------------------------------------------------------------- feedback
    @staticmethod
    def _find(items: list, id: Any) -> dict | None:
        return next((i for i in items if isinstance(i, dict) and i.get("id") == id), None)

    def _new_item(self, doc: dict, fid: str, v: dict, status: str) -> dict:
        if len(doc["feedback"]) >= MAX_FEEDBACK:
            raise StoreError("limit", f"feedback limit of {MAX_FEEDBACK} reached")
        t = self._stamp()
        item = {"id": fid, "section": v["section"], "target": v["target"], "text": v["text"],
                "status": status, "createdAt": t, "updatedAt": t,
                "submittedAt": t if status == "submitted" else None, "processedAt": None,
                "origin": v["origin"]}
        doc["feedback"].append(item)
        return item

    def _gen_feedback_id(self) -> str:
        fid = self.new_id("fb_")
        if not isinstance(fid, str) or not FB_ID_RE.match(fid):
            raise StoreError("invalid", "generated feedback id is invalid")
        return fid

    def upsert_draft(self, id: str | None, section: str, text: str, target: str | None = None,
                     origin: dict | None = None) -> dict:
        v = validate_feedback_input(section, text, target, origin, id)

        def fn(doc: dict) -> dict:
            cur = None if v["id"] is None else self._find(doc["feedback"], v["id"])
            if cur is None:
                fid = v["id"] if v["id"] is not None else self._gen_feedback_id()
                return copy.deepcopy(self._new_item(doc, fid, v, "draft"))
            if cur["status"] != "draft":
                raise StoreError("state", f"feedback {cur['id']} is {cur['status']}; only drafts can change")
            new = {**cur, "section": v["section"], "target": v["target"], "text": v["text"],
                   "origin": v["origin"]}
            if new != cur:
                new["updatedAt"] = self._stamp()
                cur.update(new)
            return copy.deepcopy(cur)
        return self.mutate(fn)

    def _ws_guard(self) -> None:
        if self._workspace_source()["conflict"]:
            raise StoreError("conflict", "both legacy workspace files exist and differ; migrate first")

    def _mirror_note(self, item: dict) -> None:
        """AM-5: a submitted saved-work item appears as a Designer workspace note."""
        if item.get("section") != "saved-work" or item.get("status") != "submitted":
            return

        def wfn(ws: dict) -> None:
            if any(isinstance(n, dict) and n.get("id") == item["id"] for n in ws["notes"]):
                return
            ws["notes"].append({"id": item["id"], "text": item["text"],
                                "review": copy.deepcopy(normalize_review(ws.get("review"))),
                                "status": "received", "createdAt": item["submittedAt"]})
        self.change_workspace(wfn)

    def submit_feedback(self, id: str, text: str | None = None) -> dict:
        nt = None if text is None else _clean_text(text, 1, 4000, "feedback")

        def fn(doc: dict) -> dict:
            cur = self._find(doc["feedback"], id)
            if cur is None:
                raise StoreError("not-found", f"unknown feedback: {id}")
            if cur["status"] == "submitted":
                if nt is None or nt == cur["text"]:
                    return copy.deepcopy(cur)
                raise StoreError("state", f"feedback {id} is submitted; its text is immutable")
            if cur["status"] != "draft":
                raise StoreError("state", f"feedback {id} is {cur['status']}")
            t = self._stamp()
            if nt is not None:
                cur["text"] = nt
            cur.update(status="submitted", submittedAt=t, updatedAt=t)
            return copy.deepcopy(cur)

        with self.lock():
            pre = self._find(self.read_project()["feedback"], id)
            if pre is not None and pre.get("section") == "saved-work":
                self._ws_guard()
            item = self.mutate(fn)
            self._mirror_note(item)
            return item

    def add_feedback(self, section: str, text: str, target: str | None = None,
                     origin: dict | None = None, submit: bool = True, id: str | None = None) -> dict:
        v = validate_feedback_input(section, text, target, origin, id)

        def fn(doc: dict) -> dict:
            cur = None if v["id"] is None else self._find(doc["feedback"], v["id"])
            if cur is None:
                fid = v["id"] if v["id"] is not None else self._gen_feedback_id()
                return copy.deepcopy(self._new_item(doc, fid, v, "submitted" if submit else "draft"))
            if cur["text"] != v["text"] or cur["section"] != v["section"]:
                raise StoreError("state", f"feedback {cur['id']} exists with different content")
            if submit and cur["status"] == "draft":
                t = self._stamp()
                cur.update(status="submitted", submittedAt=t, updatedAt=t)
            return copy.deepcopy(cur)

        with self.lock():
            if section == "saved-work" and submit:
                self._ws_guard()
            item = self.mutate(fn)
            self._mirror_note(item)
            return item

    def delete_draft(self, id: str) -> dict:
        def fn(doc: dict) -> dict:
            cur = self._find(doc["feedback"], id)
            if cur is None:
                raise StoreError("not-found", f"unknown feedback: {id}")
            if cur["status"] != "draft":
                raise StoreError("state", f"feedback {id} is {cur['status']}; only drafts can be deleted")
            doc["feedback"].remove(cur)
            return {"deleted": id}
        return self.mutate(fn)

    # ------------------------------------------------- unified feedback (D-02u)
    def _canvas_dir(self) -> Path | None:
        for rel in CANVAS_DIRS:
            p = self.root / rel
            self._check_chain(self.root, rel)
            if p.is_dir():
                return p
        return None

    def _canvas(self) -> dict:
        d = self._canvas_dir()
        if d is None:
            return {"available": False, "dir": None, "htmlFile": None, "rows": [], "invalidRows": 0,
                    "cursorIdx": -1, "journal": None}
        journal = d / "feedback.jsonl"
        self._check_symlink(journal)
        rows: list[dict] = []
        invalid = 0
        if journal.is_file():
            for line in journal.read_bytes().decode("utf-8", errors="replace").split("\n"):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    invalid += 1
                    continue
                if not (isinstance(row, dict) and all(isinstance(row.get(k), str) and row.get(k)
                                                      for k in ("ts", "id", "kind"))):
                    invalid += 1
                    continue
                rows.append(row)
        last_id = None
        cursor = d / "cursor.json"
        self._check_symlink(cursor)
        if cursor.is_file():
            try:
                c = json.loads(cursor.read_text(encoding="utf-8"))
                last_id = c.get("last_id") if isinstance(c, dict) else None
            except ValueError:
                last_id = None
        cut = -1
        if isinstance(last_id, str):
            cut = next((i for i, r in enumerate(rows) if r["id"] == last_id), -1)
        return {"available": True, "dir": d.relative_to(self.root).as_posix(),
                "htmlFile": self._canvas_html(d), "rows": rows, "invalidRows": invalid,
                "cursorIdx": cut, "journal": journal.relative_to(self.root).as_posix()}

    @staticmethod
    def _fmt(v: Any) -> str:
        if v is None:
            return "None"
        return str(v)

    def _unified(self, doc: dict, ws: dict, canvas: dict) -> list[dict]:
        out = [copy.deepcopy(f) for f in doc["feedback"]]
        store_ids = {f.get("id") for f in doc["feedback"] if isinstance(f, dict)}
        for n in ws.get("notes", []):
            if not (isinstance(n, dict) and isinstance(n.get("id"), str) and isinstance(n.get("text"), str)):
                continue
            if n["id"] in store_ids:  # AM-5: the store item is the record
                continue
            created = n.get("createdAt") if isinstance(n.get("createdAt"), str) else None
            processed = n.get("processedAt") if isinstance(n.get("processedAt"), str) else None
            out.append({"id": n["id"], "section": "saved-work", "target": None, "text": n["text"],
                        "status": "processed" if n.get("status") == "processed" else "submitted",
                        "createdAt": created, "updatedAt": processed if processed is not None else created,
                        "submittedAt": created, "processedAt": processed,
                        "origin": {"kind": "workspace", "ref": WS_ORIGIN_REF}})
        for i, r in enumerate(canvas["rows"]):
            if r["kind"] == "toggle":
                continue
            txt = r.get("text")
            if not (isinstance(txt, str) and txt):
                txt = f"[{r['kind']}] {self._fmt(r.get('dim'))}={self._fmt(r.get('value'))}" \
                    if r["kind"] == "decide" else f"[{r['kind']}]"
            comp = r.get("component")
            out.append({"id": "canvas:" + r["id"], "section": "canvas",
                        "target": comp if isinstance(comp, str) and comp else None,
                        "text": txt, "status": "processed" if i <= canvas["cursorIdx"] else "submitted",
                        "createdAt": r["ts"], "updatedAt": r["ts"], "submittedAt": r["ts"],
                        "processedAt": None, "origin": {"kind": "canvas", "ref": canvas["journal"]}})
        out.sort(key=lambda i: (i.get("createdAt") or "", i.get("id") or ""))
        return out

    def list_feedback(self, section: str | None = None, status: str | None = None) -> list[dict]:
        items = self._unified(self.read_project(), self._workspace_source()["value"], self._canvas())
        return [i for i in items if (not section or i["section"] == section)
                and (not status or i["status"] == status)]

    def acknowledge(self, ids: list[str]) -> dict:
        if not isinstance(ids, list):
            raise StoreError("invalid", "ids must be a list")
        acked: list[str] = []
        refused: list[dict] = []
        ws_targets: list[str] = []
        with self.lock():
            ws_ids = {n.get("id") for n in self._workspace_source()["value"]["notes"]
                      if isinstance(n, dict) and isinstance(n.get("id"), str)}

            def fn(doc: dict) -> None:
                for id in ids:
                    if isinstance(id, str) and id.startswith("canvas:"):
                        refused.append({"id": id, "reason": "canvas-cursor-owned"})
                        continue
                    cur = self._find(doc["feedback"], id)
                    if cur is not None:
                        if cur["status"] == "draft":
                            refused.append({"id": id, "reason": "draft"})
                            continue
                        if cur["status"] == "submitted":
                            t = self._stamp()
                            cur.update(status="processed", processedAt=t, updatedAt=t)
                        acked.append(id)
                        if id in ws_ids:  # AM-5: mark both
                            ws_targets.append(id)
                    elif id in ws_ids:
                        ws_targets.append(id)
                        acked.append(id)
                    else:
                        refused.append({"id": id, "reason": "unknown"})
            self.mutate(fn)
            if ws_targets:
                def wfn(ws: dict) -> None:
                    for n in ws["notes"]:
                        if isinstance(n, dict) and n.get("id") in ws_targets and n.get("status") != "processed":
                            n["status"] = "processed"
                            n["processedAt"] = self._stamp()
                self.change_workspace(wfn)
        return {"acknowledged": acked, "refused": refused}

    # -------------------------------------------------------------- preferences
    def add_preference(self, text: str, scope: str = "repo", provenance: dict | None = None,
                       supersedes: str | None = None) -> dict:
        v = validate_preference_input(text, scope, provenance)
        if supersedes is not None and not isinstance(supersedes, str):
            raise StoreError("invalid", "supersedes must be a preference id")

        def fn(doc: dict) -> dict:
            prefs = doc["preferences"]
            if len(prefs) >= MAX_PREFS:
                raise StoreError("limit", f"preference limit of {MAX_PREFS} reached")
            old = None
            if supersedes is not None:
                old = self._find(prefs, supersedes)
                if old is None:
                    raise StoreError("not-found", f"unknown preference: {supersedes}")
                if old["status"] == "superseded":
                    raise StoreError("state", f"preference {supersedes} is already superseded")
            t = self._stamp()
            pid = self.new_id("pref_")
            new = {"id": pid, "text": v["text"], "scope": v["scope"], "provenance": v["provenance"],
                   "status": "active", "supersedes": supersedes, "supersededBy": None,
                   "createdAt": t, "updatedAt": t}
            if old is not None:
                old.update(status="superseded", supersededBy=pid, updatedAt=t)
            prefs.append(new)
            return copy.deepcopy(new)
        return self.mutate(fn)

    @staticmethod
    def _sorted_prefs(prefs: list, include_superseded: bool) -> list[dict]:
        out = [copy.deepcopy(p) for p in prefs if isinstance(p, dict)
               and (include_superseded or p.get("status") == "active")]
        return sorted(out, key=_pref_key)

    def list_preferences(self, include_superseded: bool = False) -> list[dict]:
        return self._sorted_prefs(self.read_project()["preferences"], include_superseded)

    # ---------------------------------------------------------------- workspace
    def _workspace_source(self) -> dict:
        self._check_dir()
        primary = self.dir / "workspace.json"
        self._check_symlink(primary)
        found: list[tuple[str, bytes]] = []
        if primary.is_file():
            found.append((f"{DIR}/workspace.json", primary.read_bytes()))
        else:
            for rel in LEGACY_WORKSPACES:
                self._check_chain(self.root, rel)
                p = self.root / rel
                if p.is_file():
                    found.append((rel, p.read_bytes()))
        if not found:
            return {"value": _empty_workspace(), "legacy": False, "rel": None, "buf": None, "conflict": False}
        rel, buf = found[0]
        try:
            value = json.loads(buf.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            raise StoreError("invalid", f"{rel} is not valid JSON: {e}")
        _check_workspace(value, rel)
        value["review"] = normalize_review(value.get("review"))
        conflict = len(found) > 1 and found[0][1] != found[1][1]
        return {"value": value, "legacy": rel != f"{DIR}/workspace.json", "rel": rel, "buf": buf,
                "conflict": conflict}

    def read_workspace(self) -> tuple[dict, bool]:
        s = self._workspace_source()
        return s["value"], s["legacy"]

    def change_workspace(self, fn: Callable[[dict], Any]) -> Any:
        with self.lock():
            src = self._workspace_source()
            if src["conflict"]:
                raise StoreError("conflict", "both legacy workspace files exist and differ; migrate first")
            ws = src["value"]
            before = canonical(ws)
            result = fn(ws)
            after = canonical(ws)
            if after == before:
                return result
            _check_workspace(ws, "workspace")
            data = after.encode("utf-8")
            self.write_bytes("workspace.json", data)
            if src["legacy"]:
                self.record_migration({
                    "id": WORKSPACE_MIGRATION_ID, "kind": "workspace", "source": src["rel"],
                    "dest": f"{DIR}/workspace.json", "sourceSha256": _sha(src["buf"]),
                    "destSha256": _sha(data), "status": "migrated", "migratedAt": None, "note": None})
            return result

    def select_design(self, id: str) -> str:
        def fn(ws: dict) -> str:
            if not any(isinstance(a, dict) and a.get("id") == id for a in ws["alternatives"]):
                raise StoreError("not-found", f"unknown design: {id}")
            ws["selectedId"] = id
            return id
        return self.change_workspace(fn)

    # ------------------------------------------------------------------- boards
    def _slug(self, slug: str) -> str:
        if not isinstance(slug, str) or not SLUG_RE.match(slug):
            raise StoreError("invalid", f"invalid slug: {slug!r}")
        return slug

    @staticmethod
    def _board_entry(slug: str, buf: bytes, legacy: bool, migrations: list) -> dict:
        rel = f".designdoc/{slug}" if legacy else f"{DIR}/decisions/{slug}"
        e = {"slug": slug, "path": rel, "legacy": legacy, "valid": True, "errors": [],
             "open": 0, "ruled": 0, "conflict": None, "items": []}
        rec = None
        try:
            rec = json.loads(buf.decode("utf-8", errors="replace"))
        except ValueError:
            e["valid"] = False
            e["errors"].append("decisions.json is not valid JSON")
        if e["valid"] and (not isinstance(rec, dict) or rec.get("schema") != dr.SCHEMA):
            e["valid"] = False
            e["errors"].append(f"schema must be {dr.SCHEMA}")
        if e["valid"]:
            s = decision_summary(rec)
            e.update(open=s["open"], ruled=s["ruled"], items=s["items"])
        m = next((x for x in migrations if isinstance(x, dict) and x.get("id") == f"decisions:{slug}"), None)
        if m is not None and m.get("status") == "conflict":
            e["conflict"] = {"source": m.get("source"), "dest": m.get("dest"), "note": m.get("note")}
        return e

    def _list_dirs(self, base: Path) -> list[str]:
        self._check_symlink(base)
        if not base.is_dir():
            return []
        return sorted(d.name for d in base.iterdir()
                      if SLUG_RE.match(d.name) and d.is_dir() and not d.is_symlink())

    def _read_file(self, p: Path) -> bytes | None:
        self._check_symlink(p)
        if not os.path.lexists(p):
            return None
        if not p.is_file():
            raise StoreError("invalid", f"not a regular file: {p}")
        return p.read_bytes()

    def list_boards(self, _migrations: list | None = None) -> list[dict]:
        self._check_dir()
        mig = _migrations if _migrations is not None else self.read_project()["migrations"]
        out: dict[str, dict] = {}
        for slug in self._list_dirs(self.dir / "decisions"):
            buf = self._read_file(self.dir / "decisions" / slug / "decisions.json")
            if buf is not None:
                out[slug] = self._board_entry(slug, buf, False, mig)
        for slug in self._list_dirs(self.root / ".designdoc"):
            if slug in out:
                continue
            buf = self._read_file(self.root / ".designdoc" / slug / "decisions.json")
            if buf is None:
                continue
            try:
                rec = json.loads(buf.decode("utf-8", errors="replace"))
            except ValueError:
                continue
            if not isinstance(rec, dict) or rec.get("schema") != dr.SCHEMA:
                continue
            out[slug] = self._board_entry(slug, buf, True, mig)
        return [out[k] for k in sorted(out)]

    def read_board(self, slug: str) -> bytes:
        self._slug(slug)
        for p in (self.dir / "decisions" / slug / "decisions.json",
                  self.root / ".designdoc" / slug / "decisions.json"):
            buf = self._read_file(p)
            if buf is not None:
                return buf
        raise StoreError("not-found", f"no board: {slug}")

    def write_board(self, slug: str, data: bytes) -> bool:
        self._slug(slug)
        if not isinstance(data, (bytes, bytearray)):
            raise StoreError("invalid", "board data must be bytes")
        try:
            rec = json.loads(bytes(data).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            raise StoreError("invalid", f"board is not valid JSON: {e}")
        if not isinstance(rec, dict) or rec.get("schema") != dr.SCHEMA:
            raise StoreError("invalid", f"board schema must be {dr.SCHEMA}")
        with self.lock():
            return self.write_bytes(f"decisions/{slug}/decisions.json", bytes(data))

    # ---------------------------------------------------- artifacts / migrations
    def _canvas_html(self, d: Path) -> str | None:
        htmls = [p for p in d.iterdir() if p.name.endswith(".html") and p.is_file() and not p.is_symlink()]
        if not htmls:
            return None
        best = sorted(htmls, key=lambda p: (-p.stat().st_mtime_ns, p.name))[0]
        return best.relative_to(self.root).as_posix()

    def record_artifact(self, kind: str, rel_path: str, meta: dict | None = None) -> dict:
        if kind not in ARTIFACT_KINDS:
            raise StoreError("invalid", f"artifact kind must be one of {', '.join(ARTIFACT_KINDS)}")
        p = self._rel(rel_path)
        self._check_chain(self.root, rel_path)
        if not os.path.lexists(p):
            raise StoreError("not-found", f"artifact not found: {rel_path}")
        st = os.lstat(p)
        if p.is_dir():
            if kind != "canvas":
                raise StoreError("invalid", f"{kind} artifact must be a file")
            jbuf = self._read_file(p / "feedback.jsonl") or b""
            if meta is None:
                meta = {"htmlFile": self._canvas_html(p),
                        "journal": (p / "feedback.jsonl").relative_to(self.root).as_posix()}
        else:
            jbuf = self._read_file(p) or b""
        rel_norm = Path(os.path.normpath(rel_path)).as_posix()
        aid = f"{kind}:{rel_norm}"
        mtime = _iso_ns(st.st_mtime_ns)
        meta_v = copy.deepcopy(meta) if meta is not None else {}

        def fn(doc: dict) -> dict:
            entry = {"id": aid, "kind": kind, "path": rel_norm, "sha256": _sha(jbuf), "bytes": len(jbuf),
                     "mtime": mtime, "recordedAt": self._stamp(), "meta": meta_v}
            old = self._find(doc["artifacts"], aid)
            if old is None:
                doc["artifacts"].append(entry)
            else:
                if all(old.get(k) == entry[k] for k in ("sha256", "bytes", "mtime")) \
                        and canonical(old.get("meta")) == canonical(entry["meta"]):
                    entry["recordedAt"] = old.get("recordedAt")
                doc["artifacts"][doc["artifacts"].index(old)] = entry
            return copy.deepcopy(entry)
        return self.mutate(fn)

    def record_migration(self, entry: dict) -> dict:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"]:
            raise StoreError("invalid", "migration entry needs an id")
        if entry.get("kind") not in MIGRATION_KINDS:
            raise StoreError("invalid", f"migration kind must be one of {', '.join(MIGRATION_KINDS)}")
        if entry.get("status") not in MIGRATION_STATUSES:
            raise StoreError("invalid", f"migration status must be one of {', '.join(MIGRATION_STATUSES)}")

        def fn(doc: dict) -> dict:
            old = self._find(doc["migrations"], entry["id"])
            new = {k: entry.get(k) for k in ("id", "kind", "source", "dest", "sourceSha256",
                                             "destSha256", "status", "migratedAt", "note")}
            if new["migratedAt"] is None:
                same = old is not None and {**old, "migratedAt": None} == new
                new["migratedAt"] = old["migratedAt"] if same else self._stamp()
            if old is None:
                doc["migrations"].append(new)
            else:
                doc["migrations"][doc["migrations"].index(old)] = new
            return copy.deepcopy(new)
        return self.mutate(fn)

    # ----------------------------------------------------------------- snapshot
    def snapshot(self) -> dict:
        t = self._stamp()
        proj = self.read_project(t)
        boards = self.list_boards(proj["migrations"])
        src = self._workspace_source()
        canvas = self._canvas()
        warnings = [copy.deepcopy(w) for w in self.warnings]
        for m in proj["migrations"]:
            if m.get("status") == "error":
                note = m.get("note")
                warnings.append({"code": "migration-failed",
                                 "detail": f"{_s(m.get('id'))}: {_s(note) if note is not None else 'error'}"})
            if m.get("status") == "conflict":
                d = f"{_s(m.get('id'))}: {_s(m.get('source'))} and {_s(m.get('dest'))} both changed"
                if m.get("note"):
                    d += f"; {_s(m.get('note'))}"
                warnings.append({"code": "conflict", "detail": d})
        if src["conflict"]:
            warnings.append({"code": "conflict", "detail": f"{LEGACY_WORKSPACES[0]} and {LEGACY_WORKSPACES[1]} differ"})
        if canvas["invalidRows"]:
            warnings.append({"code": "canvas-invalid-rows",
                             "detail": f"{canvas['invalidRows']} malformed row(s) in {canvas['journal']}"})
        for b in boards:
            if b["legacy"]:
                warnings.append({"code": "legacy-unmigrated",
                                 "detail": f"{b['path']} is not migrated to {DIR}/decisions/{b['slug']}"})
        ws = src["value"]

        def nn(v: Any, d: Any) -> Any:
            return d if v is None else v
        saved = {"available": src["rel"] is not None, "legacy": src["legacy"],
                 "selectedId": ws.get("selectedId"),
                 "alternatives": [{"id": a.get("id"), "rationale": nn(a.get("rationale"), ""),
                                   "createdAt": a.get("createdAt")}
                                  for a in ws.get("alternatives", []) if isinstance(a, dict)],
                 "notes": len(ws.get("notes", []))}
        return {"schema": SNAPSHOT_SCHEMA, "root": str(self.root), "rev": proj["rev"], "generatedAt": t,
                "sections": {
                    "decisions": boards,
                    "canvas": {"available": canvas["available"], "dir": canvas["dir"],
                               "htmlFile": canvas["htmlFile"],
                               "rows": sum(1 for r in canvas["rows"] if r["kind"] != "toggle"),
                               "invalidRows": canvas["invalidRows"]},
                    "savedWork": saved,
                    "spec": {"artifacts": [copy.deepcopy(a) for a in proj["artifacts"]
                                           if a.get("kind") in ("spec", "designer-state")]},
                    "memory": {"preferences": self._sorted_prefs(proj["preferences"], True)}},
                "feedback": self._unified(proj, ws, canvas),
                "migrations": copy.deepcopy(proj["migrations"]),
                "warnings": warnings}

    def agent_contract(self) -> dict:
        proj = self.read_project()
        ws = self._workspace_source()["value"]
        canvas = self._canvas()
        return {"schema": CONTRACT_SCHEMA, "root": str(self.root), "rev": proj["rev"],
                "readConsumes": False,
                "pending": [f for f in self._unified(proj, ws, canvas) if f["status"] == "submitted"],
                "preferences": self._sorted_prefs(proj["preferences"], False),
                "decisions": self.list_boards(proj["migrations"]),  # AM-6: items included
                "ack": {"method": "POST", "path": "/api/agent/ack", "body": {"ids": ["…"]},
                        "cli": "groundwork project ack <id>…"}}

    def save_snapshot(self, dest: Any = None) -> Path:
        import shutil
        with self.lock():
            skip = {"snapshots", "write.lock", "server.json"}
            if dest is None:
                stamp = re.sub(r"[-:.]", "", self._stamp())
                dest_p = self.dir / "snapshots" / stamp
                n = 1
                while dest_p.exists():
                    n += 1
                    dest_p = self.dir / "snapshots" / f"{stamp}-{n}"
            else:
                dest_p = Path(dest).resolve()
                if dest_p.exists():
                    raise StoreError("conflict", f"destination exists: {dest_p}")
                if dest_p == self.dir or self.dir in dest_p.parents:
                    if (self.dir / "snapshots") not in dest_p.parents:
                        raise StoreError("invalid", "destination must be outside .groundwork")
            if not self.dir.is_dir():
                raise StoreError("not-found", "no .groundwork directory")
            for p in self.dir.rglob("*"):
                rel = p.relative_to(self.dir)
                if rel.parts[0] in skip or p.name.endswith(".tmp") and p.name.startswith("."):
                    continue
                if p.is_symlink():
                    continue
                t = dest_p / rel
                if p.is_dir():
                    t.mkdir(parents=True, exist_ok=True)
                elif p.is_file():
                    t.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(p, t)
            dest_p.mkdir(parents=True, exist_ok=True)
            return dest_p
