"""Prevent private project artifacts from entering public commits."""
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location("publication", Path(__file__).parents[2] / "scripts/check_publication.py")
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


@pytest.mark.parametrize("path,data", [
    (".designdoc/spec.json", b"{}"),
    ("docs/reviews/transcript.txt", b"a private transcript"),
    ("designer/references/dashboards/example.html", b"<html>"),
    ("projects/my-project/index.json", b"{}"),
    ("designer/color/combos.jsonl", b'{"choice": "A"}'),
    (".env.local", b"TOKEN=example"),
    ("notes.md", ("/Users/" + "tyrone" + "ross/private").encode()),
])
def test_private_material_is_rejected(path, data):
    assert publication.violations(path, data)


@pytest.mark.parametrize("path,data", [
    ("projects/_TEMPLATE/README.md", b"synthetic template"),
    ("projects/README.md", b"registry contract"),
    ("designer/tests/fixtures/example.json", b'{"email": "person@example.com"}'),
    ("README.md", b"https://github.com/tyroneross/groundwork-public"),
    ("designer/color/combos.jsonl", b""),
])
def test_product_contracts_and_synthetic_examples_are_allowed(path, data):
    assert publication.violations(path, data) == []
