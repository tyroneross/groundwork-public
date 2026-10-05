"""Minimal YAML emitter — just enough to serialize a design.md/v1 doc.

Standing constraint: minimal deps / build from scratch. PyYAML is not a
dependency; this serializes the restricted subset we actually emit (nested
mappings of scalars, plus lists of scalars) into block-style YAML that the
Sample Notes DESIGN.md format uses.

NOT a general YAML library. Handles: dict (block map), list (block seq),
str/int/float/bool/None scalars. Strings are quoted only when needed (hex
colors, leading specials, values that look like numbers/bools).

Pure stdlib.
"""

from __future__ import annotations

from typing import Any

_NEEDS_QUOTE_PREFIX = ("#", "@", "*", "&", "!", "%", "?", ":", "-", "[", "]", "{", "}", ",", ">", "|")
_BARE_OK_BOOLS = {"true", "false", "yes", "no", "null", "~", "on", "off"}


def _scalar(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    s = str(v)
    if s == "":
        return '""'
    needs = (
        s[0] in _NEEDS_QUOTE_PREFIX
        or s.lower() in _BARE_OK_BOOLS
        or s.strip() != s
        or ":" in s and " " in s
        or "#" in s
    )
    # numbers-as-strings must be quoted to stay strings
    try:
        float(s)
        needs = True
    except ValueError:
        pass
    if needs:
        esc = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{esc}"'
    return s


def dump(obj: Any, indent: int = 0) -> str:
    """Serialize obj to block-style YAML. Top-level should be a dict."""
    lines: list[str] = []
    _dump_into(obj, indent, lines)
    return "\n".join(lines) + ("\n" if lines else "")


def parse(text: str) -> Any:
    """Parse the restricted-subset block-style YAML that dump() emits.

    This is the INVERSE of dump() for the subset this module produces:
    - Nested mappings of scalars (dict of dict … of scalar).
    - Lists of scalars, or lists of dicts/lists.
    - 2-space indentation defines nesting depth.
    - Empty-collection shorthands: ``key: {}`` and ``key: []``.
    - Scalar de-quoting: double-quoted strings strip quotes and unescape
      ``\\"`` → ``"`` and ``\\\\`` → ``\\``; bare ``null`` → None;
      bare ``true``/``false`` → bool; bare integers → int; bare floats →
      float.  Quoted values are ALWAYS returned as str, never re-coerced
      (so a quoted ``"#0A6CFF"`` round-trips as str, a quoted ``"3"`` as str).

    Round-trip invariant: for any obj composed of nested dicts of scalars and
    lists of scalars, ``parse(dump(obj)) == obj``.

    NOT a general YAML parser. Pure stdlib.
    """
    lines = text.splitlines()
    pos = [0]  # mutable cursor — shared across recursive calls

    def _indent_of(line: str) -> int:
        return len(line) - len(line.lstrip(" "))

    def _is_value_hex(line: str, hash_idx: int) -> bool:
        """True when the ``#`` at *hash_idx* begins an UNQUOTED hex VALUE rather
        than a comment.

        Unquoted hex colors (``accent: #FF5733``) are the dominant human
        convention in a hand-authored DESIGN.md, and a strict "any whitespace-led
        ``#`` is a comment" rule would silently destroy every such value. We
        keep a ``#``-led token that (a) is hex-shaped (3/4/6/8 hex digits, the
        only #-led scalar a design token uses) and (b) begins the VALUE — i.e.
        everything before it on this segment is the ``key:`` plus whitespace, or
        a flow-collection opener/comma plus whitespace. A genuine trailing
        comment (``grid: 8  # base unit``) has non-hex text after the ``#`` and
        is unaffected.
        """
        # Extract the #-led token (up to next whitespace, comma, or brace).
        j = hash_idx + 1
        n = len(line)
        while j < n and line[j] not in (" ", "\t", ",", "}", "]"):
            j += 1
        token = line[hash_idx:j]
        body = token[1:]
        if len(body) not in (3, 4, 6, 8) or not all(c in "0123456789abcdefABCDEF" for c in body):
            return False
        # What precedes the #? Walk back over whitespace; the char before that
        # must be a value-start boundary: ':' (key:), '{' / '[' (flow open),
        # or ',' (next flow item). A space-then-text-then-# is a trailing comment.
        k = hash_idx - 1
        while k >= 0 and line[k] in (" ", "\t"):
            k -= 1
        if k < 0:
            return True  # line is just whitespace + #hex (a bare value)
        return line[k] in (":", "{", "[", ",")

    def _strip_comment(line: str) -> str:
        """Remove a ``#`` comment from a line, respecting quoted strings, flow
        collections, and unquoted hex VALUES.

        A ``#`` is NOT a comment when it is (a) inside a double-quoted string
        (e.g. ``"#0A84FF"``), (b) inside a ``{}``/``[]`` flow collection AND
        begins an unquoted hex value, or (c) the start of an unquoted hex value
        at the top level (``accent: #FF5733``). Everything from the first true
        comment ``#`` to end of line is dropped, then trailing whitespace is
        trimmed.

        dump() never emits comments, so this only matters for hand-authored
        DESIGN.md files — but those are exactly the foreign files import must
        accept (the whole point of the lenient importer).
        """
        in_quote = False
        depth = 0
        i = 0
        n = len(line)
        while i < n:
            ch = line[i]
            if ch == '"':
                # Toggle quote, honoring a backslash-escaped quote.
                if not (i > 0 and line[i - 1] == "\\"):
                    in_quote = not in_quote
            elif in_quote:
                pass
            elif ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1
            elif ch == "#":
                # Treat as a comment only when preceded by whitespace (or at
                # line start) AND it does not begin an unquoted hex value.
                preceded_by_ws = i == 0 or line[i - 1] in (" ", "\t")
                if preceded_by_ws and not _is_value_hex(line, i):
                    return line[:i].rstrip()
            i += 1
        return line

    def _is_skippable(line: str) -> bool:
        """A blank line or a full-line comment is skippable."""
        stripped = line.strip()
        return stripped == "" or stripped.startswith("#")

    def _split_flow(inner: str) -> list[str]:
        """Split a flow-collection body on top-level commas.

        Respects nested ``{}``/``[]`` and double-quoted strings so commas
        inside a nested map/list or a quoted value do not split the item.
        """
        parts: list[str] = []
        depth = 0
        in_quote = False
        buf: list[str] = []
        i = 0
        n = len(inner)
        while i < n:
            ch = inner[i]
            if ch == '"' and not (i > 0 and inner[i - 1] == "\\"):
                in_quote = not in_quote
                buf.append(ch)
            elif in_quote:
                buf.append(ch)
            elif ch in "{[":
                depth += 1
                buf.append(ch)
            elif ch in "}]":
                depth -= 1
                buf.append(ch)
            elif ch == "," and depth == 0:
                parts.append("".join(buf))
                buf = []
            else:
                buf.append(ch)
            i += 1
        tail = "".join(buf).strip()
        if tail or parts:
            parts.append(tail)
        return [p for p in parts if p.strip() != ""]

    def _parse_flow(s: str) -> Any:
        """Parse an inline flow-style ``{ ... }`` map or ``[ ... ]`` list.

        Hand-authored DESIGN.md files use flow style for compact token maps
        (``L1_title: { size: 21, weight: 600, use: "title" }``) and scales
        (``scale: [4, 8, 12, 16]``). dump() never emits these, so this path
        exists only for the importer's foreign-file support.
        """
        s = s.strip()
        if s.startswith("{") and s.endswith("}"):
            body = s[1:-1].strip()
            result: dict = {}
            if not body:
                return result
            for item in _split_flow(body):
                if ":" not in item:
                    continue
                k, _, v = item.partition(":")
                result[_dequote(k.strip())] = _dequote(v.strip())
            return result
        if s.startswith("[") and s.endswith("]"):
            body = s[1:-1].strip()
            if not body:
                return []
            return [_dequote(item.strip()) for item in _split_flow(body)]
        return _dequote(s)

    def _dequote(s: str) -> Any:
        """Convert a raw scalar string to a Python value."""
        s = s.strip()
        # Flow-style collection (foreign hand-authored files only).
        if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
            return _parse_flow(s)
        # Double-quoted string: strip quotes, unescape, return as str always.
        if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
            inner = s[1:-1]
            inner = inner.replace('\\"', "\x00QUOT\x00")
            inner = inner.replace("\\\\", "\\")
            inner = inner.replace("\x00QUOT\x00", '"')
            return inner
        # Bare YAML keywords.
        if s == "null" or s == "~":
            return None
        if s == "true":
            return True
        if s == "false":
            return False
        # Bare integer.
        try:
            return int(s)
        except (ValueError, TypeError):
            pass
        # Bare float.
        try:
            return float(s)
        except (ValueError, TypeError):
            pass
        return s

    def _skip_blanks() -> None:
        while pos[0] < len(lines) and _is_skippable(lines[pos[0]]):
            pos[0] += 1

    def _parse_value(min_indent: int) -> Any:
        """Parse the next block value at indentation >= min_indent."""
        _skip_blanks()
        if pos[0] >= len(lines):
            return None
        line = _strip_comment(lines[pos[0]])
        ind = _indent_of(line)
        stripped = line.lstrip(" ")
        # List item
        if stripped.startswith("- ") or stripped == "-":
            return _parse_list(ind)
        # Mapping
        if ":" in stripped:
            return _parse_map(ind)
        return None

    def _parse_map(expected_indent: int) -> dict:
        result: dict = {}
        while pos[0] < len(lines):
            _skip_blanks()
            if pos[0] >= len(lines):
                break
            line = _strip_comment(lines[pos[0]])
            if line.strip() == "":
                pos[0] += 1
                continue
            ind = _indent_of(line)
            if ind < expected_indent:
                break
            if ind > expected_indent:
                # Deeper than expected — should not happen in a well-formed block.
                break
            stripped = line.lstrip(" ")
            # Must be a "key: ..." line.
            if ":" not in stripped:
                break
            colon_pos = stripped.index(":")
            raw_key = stripped[:colon_pos]
            key = _dequote(raw_key)
            after = stripped[colon_pos + 1:]  # everything after the first ":"
            pos[0] += 1
            if after == "" or after == "\n":
                # Block value follows at deeper indent.
                _skip_blanks()
                if pos[0] < len(lines):
                    next_line = _strip_comment(lines[pos[0]])
                    next_ind = _indent_of(next_line)
                    if next_ind > expected_indent:
                        result[key] = _parse_value(next_ind)
                    else:
                        result[key] = None
                else:
                    result[key] = None
            else:
                # Inline value.
                inline = after.lstrip(" ")
                if inline == "{}":
                    result[key] = {}
                elif inline == "[]":
                    result[key] = []
                else:
                    result[key] = _dequote(inline)
        return result

    def _parse_list(expected_indent: int) -> list:
        result: list = []
        while pos[0] < len(lines):
            _skip_blanks()
            if pos[0] >= len(lines):
                break
            line = _strip_comment(lines[pos[0]])
            if line.strip() == "":
                pos[0] += 1
                continue
            ind = _indent_of(line)
            if ind < expected_indent:
                break
            if ind > expected_indent:
                break
            stripped = line.lstrip(" ")
            if not (stripped.startswith("- ") or stripped == "-"):
                break
            pos[0] += 1
            if stripped == "-":
                # Next deeper block is the item value.
                _skip_blanks()
                if pos[0] < len(lines) and _indent_of(_strip_comment(lines[pos[0]])) > expected_indent:
                    item = _parse_value(_indent_of(_strip_comment(lines[pos[0]])))
                else:
                    item = None
            else:
                inline = stripped[2:]  # after "- "
                if inline == "{}":
                    item = {}
                elif inline == "[]":
                    item = []
                else:
                    # Could be a "- key: val" one-liner mapping, but dump()
                    # never produces that form — it uses bare "-" + block.
                    # So treat as a scalar.
                    item = _dequote(inline)
            result.append(item)
        return result

    _skip_blanks()
    if pos[0] >= len(lines):
        return None
    line0 = _strip_comment(lines[pos[0]])
    stripped0 = line0.lstrip(" ")
    if stripped0.startswith("- ") or stripped0 == "-":
        return _parse_list(_indent_of(line0))
    return _parse_map(_indent_of(line0))


def _dump_into(obj: Any, indent: int, lines: list[str]) -> None:
    pad = "  " * indent
    if isinstance(obj, dict):
        if not obj:
            lines.append(f"{pad}{{}}")
            return
        for k, v in obj.items():
            key = _scalar(k)
            if isinstance(v, dict) and v:
                lines.append(f"{pad}{key}:")
                _dump_into(v, indent + 1, lines)
            elif isinstance(v, list) and v:
                lines.append(f"{pad}{key}:")
                _dump_into(v, indent + 1, lines)
            elif isinstance(v, dict) and not v:
                lines.append(f"{pad}{key}: {{}}")
            elif isinstance(v, list) and not v:
                lines.append(f"{pad}{key}: []")
            else:
                lines.append(f"{pad}{key}: {_scalar(v)}")
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)) and item:
                lines.append(f"{pad}-")
                _dump_into(item, indent + 1, lines)
            else:
                lines.append(f"{pad}- {_scalar(item)}")
    else:
        lines.append(f"{pad}{_scalar(obj)}")
