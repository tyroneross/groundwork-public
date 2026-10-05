"""Structure-preserving surgical update for the import→evolve→promote path.

When a DESIGN.md was imported (import_base is set), promote should NOT
re-emit from the tool's minimal template — that would drop the original
file's principles block, inline comments, unmodeled tokens, and ordering.
This module provides surgical_update(), which applies ONLY the evolved scalar
changes plus a version bump, leaving every other byte verbatim.

Pure stdlib. No subprocess. No third-party deps.
"""

from __future__ import annotations

import re
from typing import Any

from ..extract.import_design import split_frontmatter
from ..emit.yaml_min import _scalar as _yaml_scalar


# ---------------------------------------------------------------------------
# Quoting helpers
# ---------------------------------------------------------------------------

def _emit_value(old_raw: str, new_val: Any) -> str:
    """Emit new_val matching old_raw's quoting convention.

    Rule:
    - If old_raw (the chars between "key: " and any " #comment", stripped)
      starts AND ends with '"' → old value was double-quoted → emit new value
      double-quoted (escape backslash + double-quote as yaml_min does).
    - Otherwise the old value was bare → prefer a bare emission too.
      We use yaml_min._scalar() for correctness (handles hex colors, keywords,
      etc.), BUT if _scalar() would add quotes ONLY because the value looks
      like a float (e.g. "1.3") and the old value was a bare numeric/version
      string, we emit it bare instead to preserve the file's convention.
      Rationale: a version field like "version: 1.2" is authored bare and
      should stay bare when bumped to "version: 1.3".  YAML parsers that
      auto-type floats are not a concern for version strings in a DESIGN.md.
    """
    old_stripped = old_raw.strip()
    if len(old_stripped) >= 2 and old_stripped[0] == '"' and old_stripped[-1] == '"':
        # Old value was double-quoted — mirror that convention.
        new_s = str(new_val) if not isinstance(new_val, str) else new_val
        esc = new_s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{esc}"'
    # Old value was bare. Use _yaml_scalar for the canonical decision, but strip
    # quotes that were added solely due to the float-parse check when the original
    # was already a bare value.  We recognise this case as: the scalar result is
    # double-quoted AND the new value is a plain string whose string form is the
    # inner content of that quoted scalar (i.e. no quoting was needed for special
    # chars — it's just the float-guard firing).
    new_s = str(new_val) if not isinstance(new_val, str) else new_val
    emitted = _yaml_scalar(new_val)
    if (
        len(emitted) >= 2
        and emitted[0] == '"'
        and emitted[-1] == '"'
        and emitted[1:-1] == new_s  # no extra escaping → quoting was purely protective
        and not any(c in new_s for c in ('#', ':', '"', '\\', '\n'))
        and new_s.strip() == new_s  # not leading/trailing whitespace
        and new_s.lower() not in ("true", "false", "null", "~", "yes", "no", "on", "off")
    ):
        # Safe to emit bare — the quotes were only there to prevent float-parse.
        return new_s
    return emitted


# ---------------------------------------------------------------------------
# Group / indent tracking
# ---------------------------------------------------------------------------

# A top-level group header is a line at indent 0 whose value is empty:
#   color:
#   typography:
# (Lines like "schema: design.md/v1" have a non-empty value → not a group header.)
_GROUP_HEADER_RE = re.compile(r'^(\w[\w.]*):\s*$')

# A token value line is indented deeper than its group header. It looks like:
#   <indent><key>: <value> [# optional comment]
# We match the key and the value + trailing-comment region.
_VALUE_LINE_RE = re.compile(r'^( +)([\w.]+):\s*(.+)$')

# The version line pattern (at the top level — indent 0, unquoted or quoted):
_VERSION_LINE_RE = re.compile(r'^(version:\s*)(.*?)(\s*(?:#.*)?)$')


# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------

def surgical_update(original_text: str, evolved: dict, new_version: str) -> str:
    """Return original_text with ONLY the evolved scalar token values replaced
    and the version: line bumped. Every other byte — comments, principles,
    unmodeled tokens, ordering, blank lines, the body — is preserved verbatim.

    Parameters
    ----------
    original_text:
        The full DESIGN.md content as a string (including frontmatter fences).
    evolved:
        {group: {key: value}} of tokens to update (from state.delta_since).
        Only simple scalar catalog-vocabulary tokens are expected here; flow-map
        values and multi-line blocks are NEVER in evolved.
    new_version:
        The version string to write on the version: line.

    Returns
    -------
    str
        The updated document text. When evolved is empty and the version line
        is already new_version, the output is byte-identical to original_text.
    """
    # 1. Split off frontmatter using the canonical split_frontmatter contract.
    #    split_frontmatter("---\n<fm>\n---\n<body>") returns (<fm>, <body>).
    #    Reconstruction: "---\n" + fm + "\n---\n" + body  ← byte-identical.
    fm, body = split_frontmatter(original_text)
    if not fm:
        # No frontmatter fence — return as-is (defensive; should not happen in
        # a well-formed DESIGN.md).
        return original_text

    # 2. Work on the frontmatter as a list of lines.
    fm_lines = fm.split("\n")

    # Build a lookup of all (group, key) pairs we need to update, and track
    # which ones we've already patched so we only touch the first occurrence.
    # Structure: {(group, key): new_value}
    pending: dict[tuple[str, str], Any] = {}
    for group, keys in evolved.items():
        if isinstance(keys, dict):
            for key, val in keys.items():
                # Defense-in-depth: this updater only edits SIMPLE SCALAR value
                # lines. A dict/list value would be repr-serialized into a
                # byte-corrupting line (e.g. `key: "{'size': 99}"`). The
                # supported pipeline never puts a flow-map/list into `evolved`
                # (delta_since only carries scalar catalog tokens; reverse_map
                # never surfaces flow-maps into overrides), so this is
                # unreachable today — but we refuse it loudly rather than
                # silently corrupt the document if that ever changes.
                if isinstance(val, (dict, list)):
                    raise ValueError(
                        "surgical_update only edits scalar token values; got a "
                        f"{type(val).__name__} for {group}.{key}. A structured "
                        "value would corrupt the document — refusing."
                    )
                pending[(group, key)] = val

    # We also need to bump the version line.
    version_bumped = False

    current_group: str | None = None
    # For insert-at-end-of-group logic: track where the current group ends.
    # This is needed if a (group, key) pair doesn't exist yet in the file.
    # Maps group name → index of the last line belonging to that group.
    group_last_line: dict[str, int] = {}
    # Maps group name → its header line index (to anchor new group appends).
    group_header_line: dict[str, int] = {}
    # The indent used by existing members of each group (to match on insert).
    group_member_indent: dict[str, str] = {}

    # --- Pass 1: parse structure (identify groups + value line positions) ---
    # We'll collect edits as a list of (line_index, new_line_text) then apply
    # them in a second pass to avoid index-shifting issues during iteration.

    edits: dict[int, str] = {}  # line_idx → replacement line text
    patched: set[tuple[str, str]] = set()  # (group, key) pairs already patched

    for idx, line in enumerate(fm_lines):
        stripped = line.strip()

        # Check for group header at indent 0: "color:", "typography:", etc.
        # Only treat it as a group header when indent is 0 AND value is empty.
        if not line.startswith(" ") and not line.startswith("\t"):
            m_header = _GROUP_HEADER_RE.match(line)
            if m_header:
                # Close out the previous group (for insert-at-end tracking)
                if current_group is not None:
                    # The end of the previous group is the line before this one.
                    # We'll update group_last_line as we go.
                    pass
                current_group = m_header.group(1)
                group_header_line[current_group] = idx
                # Don't mark this as a content line for group_last_line yet.
                continue

        # Check for version line (at indent 0, not a group header with empty value).
        if (
            not line.startswith(" ")
            and not line.startswith("\t")
            and not version_bumped
            and line.startswith("version:")
        ):
            m_ver = _VERSION_LINE_RE.match(line)
            if m_ver:
                # Preserve quoting style of existing version value if detectable.
                old_val_raw = m_ver.group(2)
                trailing = m_ver.group(3)
                new_emitted = _emit_value(old_val_raw, new_version)
                new_line = m_ver.group(1) + new_emitted + trailing
                if new_line != line:
                    edits[idx] = new_line
                version_bumped = True

        # Track last content line of the current group (for insert-at-end logic).
        if current_group is not None:
            # A line that belongs to the current group: must be indented
            # (deeper than 0), OR be a comment/blank line inside the block.
            # We consider it "inside" the group if it is indented OR is a blank
            # or comment line between indented lines.  We stop attributing to
            # the current group once we see an unindented non-empty non-comment line.
            if line == "" or line.startswith(" ") or line.startswith("\t") or stripped.startswith("#"):
                group_last_line[current_group] = idx
                # Record the member indent from the first indented member seen.
                if (line.startswith(" ") or line.startswith("\t")) and stripped and not stripped.startswith("#"):
                    if current_group not in group_member_indent:
                        group_member_indent[current_group] = re.match(r'^(\s+)', line).group(1)
            else:
                # Unindented non-empty non-header line — the group just ended.
                # (This line is a new group header or top-level key.)
                # current_group remains set; it'll be updated on the next header match.
                pass

        # Check if this is a token value line under the current group.
        if current_group is None:
            continue
        if not (line.startswith(" ") or line.startswith("\t")):
            continue

        m_val = _VALUE_LINE_RE.match(line)
        if m_val is None:
            continue

        line_indent = m_val.group(1)
        line_key = m_val.group(2)
        rest = m_val.group(3)  # value + optional trailing comment

        # Only process lines whose key is in our pending set for current_group.
        pair = (current_group, line_key)
        if pair not in pending or pair in patched:
            continue

        # Separate the value token from any trailing comment.
        # The value ends where a trailing " # comment" begins.
        # Strategy: find the first " #" that is NOT inside a double-quoted string
        # and NOT an unquoted hex color (we use a simple scan).
        old_value_raw, trailing_comment = _split_value_comment(rest)

        new_val = pending[pair]
        new_emitted = _emit_value(old_value_raw, new_val)

        # Reconstruct the line preserving the original indent, key, alignment,
        # and trailing comment.  Detect if the original had padding between the
        # key: and the value (e.g. "  surface:       \"#F5F5F7\"").
        # We need to find where the original value started to preserve spacing.
        colon_idx = line.index(":")
        after_colon = line[colon_idx + 1:]  # " ...value..."
        # Find start of value (after ":" and whitespace):
        stripped_after = after_colon.lstrip(" \t")
        leading_spaces = after_colon[: len(after_colon) - len(stripped_after)]

        new_line = line_indent + line_key + ":" + leading_spaces + new_emitted + trailing_comment
        if new_line != line:
            edits[idx] = new_line
        patched.add(pair)

    # --- Handle version line absent case ---
    if not version_bumped:
        # Insert version: line near the top of frontmatter.
        # After schema: if present, else as first line.
        insert_after = -1
        for idx, line in enumerate(fm_lines):
            if line.startswith("schema:"):
                insert_after = idx
                break
        # We'll note this as a special insertion (index = negative means prepend).
        # Implement by modifying fm_lines directly after the edit pass.
        _version_insert_after = insert_after
    else:
        _version_insert_after = None

    # --- Handle insert-at-end-of-group for missing (group, key) pairs ---
    # Any pending pair that wasn't patched needs to be inserted.
    missing_pairs = [(g, k, v) for (g, k), v in pending.items() if (g, k) not in patched]
    # These need line insertions — handle after we apply edits to avoid index shifts.
    # Build a list of (insert_after_idx, new_line_text) in reverse order by idx
    # so we can insert without shifting earlier indices.
    insertions: list[tuple[int, str]] = []
    for group, key, val in missing_pairs:
        new_emitted = _yaml_scalar(val)
        member_indent = group_member_indent.get(group, "  ")
        new_val_line = f"{member_indent}{key}: {new_emitted}"
        if group in group_last_line:
            insertions.append((group_last_line[group], new_val_line))
        elif group in group_header_line:
            # Group header exists but has no members yet.
            insertions.append((group_header_line[group], new_val_line))
        else:
            # Group itself is absent — append group header + value line at end of fm.
            last_idx = len(fm_lines) - 1
            insertions.append((last_idx, f"{group}:\n{new_val_line}"))

    # --- Apply edits and insertions ---
    # 1. Apply line replacements.
    result_lines = list(fm_lines)
    for idx, new_line in edits.items():
        result_lines[idx] = new_line

    # 2. Apply missing-version insertion.
    if _version_insert_after is not None:
        version_line = f"version: {_yaml_scalar(new_version)}"
        insert_pos = _version_insert_after + 1
        result_lines.insert(insert_pos, version_line)
        # Shift insertion indices that come after this position.
        insertions = [
            (i + 1 if i >= _version_insert_after else i, ln)
            for i, ln in insertions
        ]

    # 3. Apply group-end insertions in reverse order (highest index first) to
    #    avoid shifting earlier indices.
    for ins_after, ins_line in sorted(insertions, key=lambda x: x[0], reverse=True):
        result_lines.insert(ins_after + 1, ins_line)

    # 4. Reassemble: "---\n" + fm_content + "\n---\n" + body
    #    This mirrors split_frontmatter's exact contract.
    new_fm = "\n".join(result_lines)
    return "---\n" + new_fm + "\n---\n" + body


# ---------------------------------------------------------------------------
# Internal helper: split "value [# comment]" into (value_raw, trailing)
# ---------------------------------------------------------------------------

def _split_value_comment(rest: str) -> tuple[str, str]:
    """Split a value+optional-comment string into (value_raw, trailing_comment).

    rest is everything after "key: " on a token value line, e.g.:
      '"#F5F5F7"   # grouped card fill'
      '"#0A84FF"   # primary actions (Start Recording, Export)'
      '"1px solid border"'
      '8'

    We scan character-by-character to find the first " #" or "\t#" that is NOT
    inside a double-quoted string, then split there.

    Returns:
      value_raw: the value token (may include surrounding quotes) — stripped.
      trailing_comment: the " # ..." portion (including leading whitespace) or "".
    """
    in_quote = False
    n = len(rest)
    for i in range(n):
        ch = rest[i]
        if ch == '"':
            # Toggle, respecting backslash-escape.
            if not (i > 0 and rest[i - 1] == "\\"):
                in_quote = not in_quote
        elif not in_quote and ch == "#":
            # Is it preceded by whitespace? (a comment must be space-then-#)
            if i > 0 and rest[i - 1] in (" ", "\t"):
                value_part = rest[:i]
                comment_part = rest[i - 1:]  # include the space before #
                # Trim the trailing space from value_part.
                value_part = value_part.rstrip()
                # But keep the leading space in comment so we have " # ..."
                # Actually, let's be precise: trailing_comment is from the
                # whitespace-before-# to end of string.
                trailing_ws_start = i - 1
                # Walk back to find where the trailing whitespace begins
                # (there may be multiple spaces: "value   # comment").
                j = i - 1
                while j > 0 and rest[j - 1] in (" ", "\t"):
                    j -= 1
                value_raw = rest[:j]
                trailing_comment = rest[j:]
                return value_raw, trailing_comment
    # No comment found.
    return rest, ""
