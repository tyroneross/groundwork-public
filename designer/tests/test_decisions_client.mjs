/* The rules that decide what reaches the file, tested without a browser.
 *
 * decisions.js is UMD precisely so this suite can exist: the pure half loads in
 * node with no DOM, so the merge, the tombstone path, the save contract and the
 * overlay mapping are graded by execution rather than by reading the code.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "decisions", "app", "decisions.js");

/* Load it the way a BROWSER does -- as a classic script against a global, not
 * as a module. The repo's package.json declares "type": "module", so a bare
 * `require` of this .js parses it as ESM, its UMD `module` branch never runs,
 * and the suite grades an empty object. Running it in a vm sandbox with no
 * `module` and no `document` also proves two things the browser depends on:
 * the file contains no import/export syntax, and the pure half loads with no
 * DOM present. */
function loadClientAsBrowserWould() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(APP, "utf8"), sandbox, { filename: "decisions.js" });
  return sandbox.GroundworkDecisions;
}

const D = loadClientAsBrowserWould();

/* Values built inside the vm come from another realm, so their prototypes are
 * not this realm's `Array`/`Object` and deepStrictEqual rejects them on
 * identity alone. These are data comparisons, so compare the data. */
const plain = (v) => JSON.parse(JSON.stringify(v));

test("the client loads as a classic browser script with no DOM", () => {
  assert.ok(D, "decisions.js must expose GroundworkDecisions on the global");
  assert.equal(typeof D.normalize, "function");
  assert.equal(typeof D.buildRecord, "function");
});

const SCHEMA = "groundwork.decision-set/v1";

test("alternative proposals share one decision and save without changing earlier answers", () => {
  const disk = record({ compares: [
    { id: "blue", area: "Panel", question: "Blue?", optionA: { summary: "Current", visual: "now.png" },
      optionB: { summary: "Blue", visual: "blue.html" }, ruling: "revise-b", rulingText: "less blue" },
    { id: "gray", area: "Panel", question: "Gray?", optionA: { summary: "Current", visual: "now.png" },
      optionB: { summary: "Gray", visual: "gray.html" }, ruling: "approve-b" },
    { id: "other", area: "Other", question: "Other?", optionA: "Different current", optionB: "Proposal" }
  ] });
  const sets = D.comparisonSets(D.normalize(disk));
  assert.deepEqual(plain(sets.map((s) => s.items.map((r) => r.id))), [["blue", "gray"], ["other"]]);
  const out = D.buildRecord(disk, { groupSelections: {
    blue: { selected: "gray", note: "choose the gray border", ruledAt: "T" }
  } }, "group");
  assert.equal(out.groupSelections.blue.selected, "gray");
  assert.equal(out.compares[0].ruling, "revise-b");
  assert.equal(out.compares[1].ruling, "approve-b");
  assert.throws(() => D.buildRecord(disk, { groupSelections: {
    blue: { selected: "other" }
  } }, "group"), /not an option/);
  assert.deepEqual(plain(D.comparisonSets(D.normalize(record({ compares: [
    { id: "one", ruling: "keep-a" }, { id: "two", ruling: "approve-b" }
  ] }))).map((s) => s.items.map((r) => r.id))), [["one"], ["two"]],
  "records without a current visual must keep independent answers");
});

function record(extra = {}) {
  return {
    schema: SCHEMA,
    id: "fixture",
    axes: [
      {
        id: "ax-open", title: "An unruled axis", decision: "Pick one.",
        options: [{ key: "a", letter: "A", label: "First", body: "why a", cost: "costs a" },
                  { key: "b", letter: "B", label: "Second" }]
      },
      {
        id: "ax-ruled", title: "A ruled axis", decision: "Pick one.",
        selected: "a", note: "because",
        options: [{ key: "a", label: "First" }, { key: "b", label: "Second" }]
      }
    ],
    openItems: [
      {
        id: "it-open", kind: "copy", question: "Which wording?",
        status: "open — needs your answer",
        choices: [{ key: "no", label: "Leave it" },
                  { key: "own", label: "Write my own", needsText: true }]
      },
      {
        id: "it-stale", kind: "decision", question: "Ship it?",
        status: "open — MERGE BLOCKER", ruling: "own", rulingText: "his words",
        choices: [{ key: "yes", label: "Ship" }, { key: "own", label: "Mine", needsText: true }]
      }
    ],
    previewComments: [],
    annotations: [],
    history: [],
    ...extra
  };
}

/* ------------------------------------------------------- lane derivation */

test("a prose status of 'open' does not reopen a ruled item", () => {
  const by = Object.fromEntries(D.normalize(record()).map((r) => [r.id, r]));
  assert.equal(by["it-stale"].status, "open — MERGE BLOCKER");
  assert.equal(D.lane(by["it-stale"]), "ruled",
    "status is prose and drifts; the ruling is what decides the lane");
  assert.equal(D.lane(by["it-open"]), "open");
  assert.equal(D.lane(by["ax-open"]), "open");
  assert.equal(D.lane(by["ax-ruled"]), "ruled");
});

test("a ruling of false is an answer, not an absence", () => {
  const r = D.normalize(record({
    axes: [], openItems: [{ id: "x", question: "Keep it?", ruling: false, choices: [] }]
  }))[0];
  assert.equal(r.chosen, false);
  assert.equal(D.lane(r), "ruled");
});

test("a cleared ruling reopens the item, and ruledAt alone never rules", () => {
  const [blank, stamped] = D.normalize(record({
    axes: [],
    openItems: [
      { id: "blank", question: "q", ruling: "   ", choices: [] },
      { id: "stamped", question: "q", ruledAt: "2026-01-01T00:00:00Z", choices: [] }
    ]
  }));
  assert.equal(D.lane(blank), "open");
  assert.equal(D.lane(stamped), "open");
});

test("an addressed axis leaves the open lane without being ruled", () => {
  const r = D.normalize(record({
    axes: [{ id: "a", title: "t", decision: "d", addressed: true, options: [] }], openItems: []
  }))[0];
  assert.equal(D.lane(r), "ruled");
});

/* ------------------------------------------------------------- adapter */

test("each array is read and written through its own field names", () => {
  const by = Object.fromEntries(D.normalize(record()).map((r) => [r.id, r]));
  assert.equal(by["ax-ruled"].freeText, "because", "axes free text is `note`");
  assert.equal(by["it-stale"].freeText, "his words", "openItems free text is `rulingText`");
  assert.equal(by["ax-ruled"].title, "A ruled axis");
  assert.equal(by["it-open"].title, "Which wording?", "an item's title is its question");
  assert.equal(by["ax-open"].choices[0].note, "why a", "an axis option's body is the quiet line");
  assert.equal(by["ax-open"].choices[0].cost, "costs a");
  assert.equal(by["it-open"].choices[1].needsText, true);
});

test("a ruling writes back to the array it came from and nowhere else", () => {
  const disk = record();
  const out = D.buildRecord(disk, {
    rulings: {
      "ax-open": { source: "axes", chosen: "b", freeText: "axis reason", ruledAt: "T" },
      "it-open": { source: "openItems", chosen: "own", freeText: "item words", ruledAt: "T" }
    }
  }, "rulings");
  const ax = out.axes.find((a) => a.id === "ax-open");
  const it = out.openItems.find((i) => i.id === "it-open");
  assert.equal(ax.selected, "b");
  assert.equal(ax.note, "axis reason");
  assert.equal(ax.ruling, undefined, "an openItems field must never land on an axis");
  assert.equal(it.ruling, "own");
  assert.equal(it.rulingText, "item words");
  assert.equal(it.selected, undefined, "an axes field must never land on an item");
});

test("the surface never writes the author's prose status", () => {
  const out = D.buildRecord(record(), {
    rulings: { "it-stale": { source: "openItems", chosen: "yes", ruledAt: "T" } }
  }, "rulings");
  assert.equal(out.openItems.find((i) => i.id === "it-stale").status, "open — MERGE BLOCKER",
    "a stale status stays the author's to fix rather than being overwritten");
});

/* --------------------------------------------------------- the merge */

test("a concurrent writer's new item survives this session's save", () => {
  const disk = record({ annotations: [{ id: "theirs", note: "landed while I was open" }] });
  const out = D.buildRecord(disk, { annotations: [{ id: "mine", note: "mine" }], dirty: { mine: true } },
    "observations");
  const ids = out.annotations.map((a) => a.id).sort();
  assert.deepEqual(plain(ids), ["mine", "theirs"]);
});

test("a delete reaches the file and is not resurrected by the disk re-read", () => {
  const disk = record({ annotations: [{ id: "gone", note: "delete me" }, { id: "stays", note: "keep" }] });
  // The in-memory list no longer has it -- which on its own is not enough,
  // because the union with disk would put it straight back.
  const out = D.buildRecord(disk, { annotations: [{ id: "stays", note: "keep" }], deletedIds: { gone: true } },
    "observations");
  assert.deepEqual(plain(out.annotations.map((a) => a.id)), ["stays"]);
});

test("a splice without a tombstone resurrects the item (the defect this guards)", () => {
  const disk = record({ annotations: [{ id: "gone", note: "x" }] });
  const out = D.buildRecord(disk, { annotations: [] }, "observations");
  assert.deepEqual(plain(out.annotations.map((a) => a.id)), ["gone"],
    "proves the union alone cannot delete, so the tombstone is load-bearing");
});

test("no persisted item asserts its own save state", () => {
  const out = D.buildRecord(record(), {
    annotations: [{ id: "a", note: "n", savedToFile: true, unsaved: false }],
    previewComments: [{ id: "c", text: "t", unsaved: true }],
    dirty: { a: true, c: true }
  }, "observations");
  for (const it of [...out.annotations, ...out.previewComments, ...out.history]) {
    for (const f of D.TRANSIENT_FIELDS) {
      assert.equal(f in it, false, `${f} is a session flag and must not persist`);
    }
  }
});

test("an untouched item seeded from disk is written back unchanged", () => {
  const disk = record({ annotations: [{ id: "a", note: "original" }] });
  const out = D.buildRecord(disk, { annotations: [{ id: "a", note: "edited in memory" }] }, "observations");
  assert.equal(out.annotations[0].note, "original",
    "a key seeded from disk and never marked dirty is not an intent to write it back");
});

test("unknown project keys survive a round trip untouched", () => {
  const disk = record({
    bundles: [{ key: "B" }], copyReceipts: { a: 1 }, positioningSource: "somewhere",
    measuredBaseline: { lcp: 1.2 }, vetoes: ["no dark patterns"]
  });
  const out = D.buildRecord(disk, {}, "observations");
  for (const k of ["bundles", "copyReceipts", "positioningSource", "measuredBaseline", "vetoes"]) {
    assert.deepEqual(plain(out[k]), plain(disk[k]), `${k} must round-trip byte-identically`);
  }
});

test("the scope is recorded so a watcher can tell a ruling from a note", () => {
  assert.equal(D.buildRecord(record(), {}, "rulings").lifecycle.savedScope, "rulings");
  assert.equal(D.buildRecord(record(), {}, "observations").lifecycle.savedScope, "observations");
});

/* ------------------------------------------------------- save contract */

test("a save is accepted only when the server returns all three fields", () => {
  assert.equal(D.saveAccepted(true, { ok: true, savedAt: "20260914T031500Z", bytes: 12 }), true);
  assert.equal(D.saveAccepted(true, null), false, "an empty body (a 204) is not a confirmation");
  assert.equal(D.saveAccepted(true, { ok: true, savedAt: "20260914T031500Z" }), false, "bytes missing");
  assert.equal(D.saveAccepted(true, { ok: true, bytes: 1 }), false, "savedAt missing");
  assert.equal(D.saveAccepted(true, { ok: false, savedAt: "x", bytes: 1 }), false);
  assert.equal(D.saveAccepted(false, { ok: true, savedAt: "x", bytes: 1 }), false, "a non-2xx is never a save");
  assert.equal(D.saveAccepted(true, { ok: true, savedAt: "", bytes: 1 }), false);
});

/* --------------------------------------------------- disposition moves */

test("incorporating an annotation moves it to history with a receipt", () => {
  const rec = record({ annotations: [{ id: "p1", note: "fix the heading", savedToFile: true }] });
  const out = D.incorporate(rec, "p1", { what: "reworded", where: "Hero" });
  assert.equal(out.annotations.length, 0, "archiving moves, it never copies");
  assert.equal(out.history.length, 1);
  assert.equal(out.history[0].disposition, "incorporated");
  assert.deepEqual(plain(out.history[0].receipt), { what: "reworded", where: "Hero" });
  assert.equal("savedToFile" in out.history[0], false);
});

test("a declined annotation stays visible and carries its reason", () => {
  const rec = record({ annotations: [{ id: "p1", note: "make it red" }] });
  const out = D.decline(rec, "p1", "conflicts with the contrast floor");
  assert.equal(out.annotations.length, 1, "absence of a disposition is not consent to hide it");
  assert.equal(out.annotations[0].disposition, "declined");
  assert.equal(out.annotations[0].declinedReason, "conflicts with the contrast floor");
});

test("no id is ever both live and archived", () => {
  const rec = record({ annotations: [{ id: "p1", note: "n" }] });
  const out = D.incorporate(rec, "p1", null);
  const live = new Set([...(out.annotations || []), ...(out.previewComments || [])].map((i) => i.id));
  const arch = new Set((out.history || []).map((i) => i.id));
  assert.equal([...live].filter((i) => arch.has(i)).length, 0);
});

/* -------------------------------------------------------- overlay map */

test("a record with no preview block degrades to no overlay", () => {
  const r = D.normalize(record())[0];
  assert.deepEqual(plain(D.overlayPlan(r, "a")), { mode: "none" },
    "shipping before any project writes a mapping must be safe");
});

test("a text choice swaps the target element's text", () => {
  const r = D.normalize(record({
    openItems: [{
      id: "h", question: "Headline?", choices: [{ key: "new", label: "Use the new one" }],
      preview: { selector: "[data-component='Hero'] h1", byChoice: { new: { mode: "text", value: "Ship it" } } }
    }], axes: []
  }))[0];
  assert.deepEqual(plain(D.overlayPlan(r, "new")),
    { mode: "text", selector: "[data-component='Hero'] h1", value: "Ship it" });
});

test("a remove choice hides the section and a structural choice loads a page", () => {
  const r = D.normalize(record({
    openItems: [{
      id: "s", question: "Keep the banner?",
      choices: [{ key: "remove", label: "Remove" }, { key: "alt", label: "Try the other layout" }],
      preview: {
        selector: "[data-component='Banner']",
        byChoice: { remove: { mode: "hide" }, alt: { mode: "page", url: "/alt" } }
      }
    }], axes: []
  }))[0];
  assert.deepEqual(plain(D.overlayPlan(r, "remove")), { mode: "hide", selector: "[data-component='Banner']" });
  assert.deepEqual(plain(D.overlayPlan(r, "alt")), { mode: "page", url: "/alt" });
});

test("a choice carrying its own words previews without a byChoice entry", () => {
  const r = D.normalize(record({
    openItems: [{
      id: "c", question: "Which line?",
      choices: [{ key: "proposed", label: "The proposal", text: "A clearer line" }],
      preview: { selector: "p.lede" }
    }], axes: []
  }))[0];
  assert.deepEqual(plain(D.overlayPlan(r, "proposed")),
    { mode: "text", selector: "p.lede", value: "A clearer line" });
});

/* ----------------------------------------------------- condensed text */

test("why is held to two sentences and about 35 words", () => {
  const long = "First sentence here. Second sentence here. Third sentence must not appear.";
  const out = D.condense(long, 35, 2);
  assert.ok(out.includes("First sentence"));
  assert.ok(out.includes("Second sentence"));
  assert.ok(!out.includes("Third sentence"), "a third sentence belongs behind `more`");
});

test("a long single sentence is cut to the word ceiling with an ellipsis", () => {
  const out = D.condense("word ".repeat(60), 35, 2);
  assert.ok(out.split(/\s+/).length <= 36);
  assert.ok(out.endsWith("…"));
});

test("an option label is capped at twelve words and the tail is kept", () => {
  const { head, tail } = D.splitLabel("one two three four five six seven eight nine ten eleven twelve thirteen", 12);
  assert.equal(head.split(" ").length, 12);
  assert.equal(tail, "thirteen", "the tail becomes the quiet line, it is not thrown away");
});

test("condense is safe on empty and null input", () => {
  assert.equal(D.condense(null), "");
  assert.equal(D.condense(""), "");
});

/* ------------------------------------------------------------ escaping */
/* A decision record is a FILE. An agent writes into it, a person pastes into
 * it, and it arrives from another repository. So its strings are untrusted
 * input to this page, and the card builders hand their output to innerHTML.
 * These grade the escape rather than trusting it. */

const HOSTILE = '<img src=x onerror="globalThis.__pwned=1">';
const HOSTILE_CLOSE = '</textarea><script>globalThis.__pwned=1<\/script>';

test("esc() neutralises every character that could open a tag or attribute", () => {
  /* This test replaced one that asserted `typeof out === "string"` on
     condense() -- always true, green with esc() deleted. It was written that way
     because esc() lived below the `typeof document === "undefined"` guard and
     could not be reached from node at all. Moving it into the pure half is what
     makes this gradeable. */
  for (const payload of [HOSTILE, HOSTILE_CLOSE, '"><b>x</b>', "' onmouseover='x"]) {
    const out = D.esc(payload);
    assert.ok(!/[<>]/.test(out), `raw angle bracket survived: ${out}`);
    assert.ok(!out.includes('"'), `raw double quote survived: ${out}`);
    assert.ok(!out.includes("'"), `raw single quote survived: ${out}`);
  }
  assert.equal(D.esc("<b>"), "&lt;b&gt;");
  assert.equal(D.esc('a"b'), "a&quot;b");
  assert.equal(D.esc("a'b"), "a&#39;b");
  // & must go first, or every other replacement gets double-encoded.
  assert.equal(D.esc("&lt;"), "&amp;lt;");
  assert.equal(D.esc(null), "");
});

test("every innerHTML sink in the client is annotated as reviewed", () => {
  /* The HTML builders run only with a document, so node cannot execute them.
     What CAN be enforced hermetically is that no NEW unreviewed sink appears:
     every innerHTML assignment must carry a nosec marker, which forces a human
     to state why it is safe. */
  const src = fs.readFileSync(APP, "utf8");
  const sinks = src.split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\.innerHTML\s*=/.test(line));
  assert.ok(sinks.length > 0, "expected the card renderers to use innerHTML");
  for (const [n, line] of sinks) {
    assert.ok(line.includes("nosec"),
      `decisions.js:${n} assigns innerHTML with no reviewed-and-why marker`);
  }
});

test("a record cannot point the preview iframe at a javascript: URL", () => {
  /* A record is untrusted input and its `preview.byChoice[k].url` is assigned
     to iframe.src -- which escaping markup would not have protected, because it
     is not an innerHTML sink. This origin owns the only writable path, so script
     execution here can rewrite the person's record. */
  for (const evil of [
    "javascript:window.__pwned=1",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)  ",
    "data:text/html,<script>window.__pwned=1<\/script>",
    "//evil.example/x",
    "https://evil.example/x",
    "vbscript:x",
  ]) {
    assert.equal(D.safePreviewUrl(evil), null, `allowed a dangerous url: ${evil}`);
  }
});

test("the preview still accepts ordinary same-document paths", () => {
  assert.equal(D.safePreviewUrl("/alt"), "/alt");
  assert.equal(D.safePreviewUrl("./alt.html"), "./alt.html");
  assert.equal(D.safePreviewUrl("/a/b?c=1"), "/a/b?c=1");
  assert.equal(D.safePreviewUrl(""), null);
  assert.equal(D.safePreviewUrl(undefined), null);
  assert.equal(D.safePreviewUrl("relative-no-slash"), null);
});

test("a page-mode overlay refuses a dangerous url at the plan boundary", () => {
  const r = D.normalize({
    schema: SCHEMA, id: "x", axes: [],
    openItems: [{
      id: "e", question: "q", choices: [{ key: "go", label: "Go" }],
      preview: { selector: "main", byChoice: { go: { mode: "page", url: "javascript:alert(1)" } } }
    }]
  })[0];
  assert.deepEqual(plain(D.overlayPlan(r, "go")), { mode: "page", url: null },
    "the url must be refused before it can reach iframe.src");
});

test("a hostile string in a record survives normalization as inert text", () => {
  const r = D.normalize({
    schema: SCHEMA, id: "x", axes: [],
    openItems: [{
      id: "evil", question: HOSTILE, why: HOSTILE_CLOSE,
      status: HOSTILE,
      choices: [{ key: "k", label: HOSTILE, note: HOSTILE_CLOSE }]
    }]
  })[0];
  // It must be carried verbatim -- escaping is the renderer's job, and a
  // normalizer that silently mangled input would corrupt the record on save.
  assert.equal(r.title, HOSTILE);
  assert.equal(r.choices[0].label, HOSTILE);
  assert.equal(r.status, HOSTILE);
});

test("a hostile string round-trips through the merge without becoming markup", () => {
  const disk = {
    schema: SCHEMA, id: "x", axes: [], openItems: [],
    annotations: [{ id: "a", note: HOSTILE }], previewComments: [], history: []
  };
  const out = D.buildRecord(disk, {}, "observations");
  assert.equal(out.annotations[0].note, HOSTILE,
    "the record is the user's document; the merge must not rewrite their text");
});

/* ───────────────────────────── compares ───────────────────────────── */

const compareRecord = () => ({
  schema: "groundwork.decision-set/v1", id: "cmp",
  compares: [
    { id: "c1", question: "Which header?", optionA: "now", optionB: { summary: "next", visual: "b.html" } },
    { id: "c2", question: "Which footer?", ruling: "keep-a" },
  ],
  axes: [{ id: "ax", title: "Axis", options: [{ key: "a", label: "A" }] }],
});

test("a compare offers exactly the four fixed rulings", () => {
  const c = D.normalize(compareRecord()).find((r) => r.id === "c1");
  assert.equal(c.kind, "compare");
  assert.deepEqual(plain(c.choices.map((x) => [x.key, x.label, x.needsText])), [
    ["keep-a", "Keep A", false], ["approve-b", "Approve B", false],
    ["revise-b", "Revise B", true], ["other", "Neither", true]]);
});

test("Revise B and Neither refuse to record without a note; Keep A and Approve B do not", () => {
  for (const k of ["revise-b", "other"]) {
    assert.ok(D.compareNoteError(k, ""), `${k} with empty note must be refused`);
    assert.ok(D.compareNoteError(k, "   "), `${k} with whitespace note must be refused`);
    assert.equal(D.compareNoteError(k, "say this"), null);
  }
  for (const k of ["keep-a", "approve-b"]) assert.equal(D.compareNoteError(k, ""), null);
  assert.ok(D.compareNoteError("approve", "x"), "an unknown ruling is refused");
});

test("a compare ruling writes to ruling/rulingText on its own item only", () => {
  const out = D.buildRecord(compareRecord(), {
    rulings: { c1: { source: "compares", chosen: "revise-b", freeText: "smaller", ruledAt: "T" } },
  }, "compare");
  const c1 = out.compares.find((c) => c.id === "c1");
  assert.equal(c1.ruling, "revise-b");
  assert.equal(c1.rulingText, "smaller");
  assert.equal(c1.ruledAt, "T");
  assert.equal(out.compares.find((c) => c.id === "c2").ruling, "keep-a", "other compares untouched");
  assert.equal(out.axes[0].selected, undefined, "no ruling leaks onto an axis");
  assert.equal(out.lifecycle.savedScope, "compare");
});

test("a note autosaves without committing a ruling", () => {
  const out = D.buildRecord(compareRecord(), {
    notes: { c1: { source: "compares", freeText: "thinking about it" } },
  }, "notes");
  const c1 = out.compares.find((c) => c.id === "c1");
  assert.equal(c1.rulingText, "thinking about it");
  assert.equal(c1.ruling, undefined, "typing a note is not a ruling");
  assert.equal(D.lane(D.normalize(out).find((r) => r.id === "c1")), "open");
});

test("a note cannot be written across arrays by a mismatched source", () => {
  const out = D.buildRecord(compareRecord(), {
    notes: { ax: { source: "compares", freeText: "wrong array" } },
  }, "notes");
  assert.equal(out.axes[0].note, undefined);
  assert.equal(out.axes[0].rulingText, undefined);
});

test("a visual must be a plain leaf file name of an allowed type", () => {
  for (const ok of ["a.png", "home-proposed.html", "B_2.webp"]) assert.equal(D.safeVisual(ok), ok);
  for (const bad of ["../a.png", "/a.png", "javascript:alert(1)", "a.svg", ".hidden.png",
                     "dir/a.png", "https://x/a.png", "", null, 3]) {
    assert.equal(D.safeVisual(bad), null, `accepted ${bad}`);
  }
});

test("a note typed while a ruling is in flight wins over the click-time text", () => {
  /* Audit H1: the ruling patch used to run after the note patch and overwrite
     the newer text, while the page reported the newer text as saved. */
  const out = D.buildRecord(compareRecord(), {
    rulings: { c1: { source: "compares", chosen: "approve-b", freeText: "x", ruledAt: "T" } },
    notes: { c1: { source: "compares", freeText: "xy" } },
  }, "compare");
  const c1 = out.compares.find((c) => c.id === "c1");
  assert.equal(c1.ruling, "approve-b");
  assert.equal(c1.rulingText, "xy");
});

test("Ask for new options appends requests by id and keeps requests already on disk", () => {
  const disk = record({ compares: [
    { id: "blue", area: "Panel", optionA: { summary: "Current", visual: "now.png" }, optionB: { summary: "Blue", visual: "blue.html" } },
    { id: "gray", area: "Panel", optionA: { summary: "Current", visual: "now.png" }, optionB: { summary: "Gray", visual: "gray.html" } }
  ], optionRequests: [{ id: "req-a", group: "blue", note: "other writer", status: "open" }] });
  const mine = { id: "req-b", group: "blue", note: "try a lighter border", requestedAt: "T", status: "open" };
  const out = D.buildRecord(disk, { groupSelections: {}, optionRequests: [mine, { id: "req-a", note: "stale copy" }] }, "group");
  assert.deepEqual(plain(out.optionRequests.map((q) => [q.id, q.note])),
    [["req-a", "other writer"], ["req-b", "try a lighter border"]]);
  const untouched = D.buildRecord(disk, { groupSelections: {} }, "group");
  assert.equal(untouched.optionRequests.length, 1, "a save with no new request must not drop existing ones");
});

test("implementation lane follows the saved choice and requires evidence", () => {
  const compares = [
    { id: "a", area: "Panel", optionA: { summary: "Current", visual: "now.png" }, optionB: { summary: "A" } },
    { id: "b", area: "Panel", optionA: { summary: "Current", visual: "now.png" }, optionB: { summary: "B" } }
  ];
  const base = record({ compares, groupSelections: {} });
  const set = D.comparisonSets(D.normalize(base))[0];
  assert.equal(D.implementationLane(base, set).key, "needs-decision");
  base.groupSelections.a = { selected: "b" };
  assert.equal(D.implementationLane(base, set).key, "pending");
  base.implementationStatus = { a: { selected: "a", stage: "complete",
    proposal: compares[0].optionB, decisionNote: "",
    evidence: [{ kind: "verification", detail: "Old build passed", ref: "report", revision: "abc" }] } };
  assert.equal(D.implementationLane(base, set).key, "pending", "old choice evidence must not apply");
  base.implementationStatus.a.selected = "b";
  base.implementationStatus.a.proposal = { ...compares[1].optionB };
  base.implementationStatus.a.evidence = [{ kind: "source", detail: "Source changed", ref: "src/view.ts:8" }];
  assert.equal(D.implementationLane(base, set).key, "in-progress", "source alone cannot prove completion");
  base.implementationStatus.a.evidence.push({ kind: "verification", detail: "Build passed", ref: "reports/build.txt", revision: "abc" });
  assert.equal(D.implementationLane(base, set).key, "complete");
  base.implementationStatus.a.evidence[1].revision = "";
  assert.equal(D.implementationLane(base, set).key, "in-progress", "a verification without revision is incomplete");
  base.implementationStatus.a.evidence[1].revision = "abc";
  base.compares[1].optionB.summary = "B revised";
  const changedSet = D.comparisonSets(D.normalize(base))[0];
  assert.equal(D.implementationLane(base, changedSet).key, "pending", "proposal edits invalidate old evidence");
  base.implementationStatus.a.proposal = base.compares[1].optionB;
  base.groupSelections.a.note = "make border smaller";
  assert.equal(D.implementationLane(base, changedSet).key, "pending", "new decision note changes requirements");
});

test("saved comparison sets move to Selected without changing their rulings", () => {
  const disk = record({ compares: [
    { id: "first", area: "Panel", optionA: { summary: "Current", visual: "now.png" },
      optionB: { summary: "First" } },
    { id: "second", area: "Panel", optionA: { summary: "Current", visual: "now.png" },
      optionB: { summary: "Second" } },
    { id: "single", area: "Canvas", optionA: { summary: "Current" },
      optionB: { summary: "Expand" }, ruling: "approve-b" }
  ] });
  const sets = D.comparisonSets(D.normalize(disk).filter((r) => r.source === "compares"));
  let buckets = D.comparisonBuckets(disk, sets);
  assert.deepEqual(plain(buckets.pending.map((s) => s.id)), ["first"]);
  assert.deepEqual(plain(buckets.selected.map((s) => s.id)), ["single"]);
  disk.groupSelections = { first: { selected: "second", note: "" } };
  buckets = D.comparisonBuckets(disk, sets);
  assert.deepEqual(plain(buckets.pending.map((s) => s.id)), []);
  assert.deepEqual(plain(buckets.selected.map((s) => s.id)), ["first", "single"]);
  assert.equal(disk.compares[2].ruling, "approve-b");
});

test("jumping to a compare opens its collapsed status and focuses the card", () => {
  const lane = { open: false };
  let focused = false, scrolled = false;
  const target = {
    closest: (selector) => selector === "details[data-work-lane]" ? lane : null,
    focus: () => { focused = true; },
    scrollIntoView: () => { scrolled = true; }
  };
  assert.equal(D.revealCompareTarget(target), true);
  assert.equal(lane.open, true);
  assert.equal(focused, true);
  assert.equal(scrolled, true);
  assert.equal(D.revealCompareTarget(null), false);
});

test("jumping to a saved comparison opens both collapsed ancestors", () => {
  const lane = { open: false }, card = { open: false };
  const target = {
    closest: (selector) => selector === "details[data-selected-card]" ? card
      : selector === "details[data-work-lane]" ? lane : null,
    focus: () => {}, scrollIntoView: () => {}
  };
  assert.equal(D.revealCompareTarget(target), true);
  assert.equal(card.open, true);
  assert.equal(lane.open, true);
});

test("compare DOM signature changes when the saved wording or proposal changes", () => {
  const disk = record({ compares: [{ id: "x", optionA: { summary: "Current" },
    optionB: { summary: "Proposal" }, ruling: "revise-b", rulingText: "smaller" }] });
  const first = D.compareRenderSignature(D.normalize(disk).filter((r) => r.source === "compares"), disk);
  disk.compares[0].rulingText = "larger";
  const afterNote = D.compareRenderSignature(D.normalize(disk).filter((r) => r.source === "compares"), disk);
  assert.notEqual(afterNote, first);
  disk.compares[0].optionB.summary = "Different proposal";
  const afterProposal = D.compareRenderSignature(D.normalize(disk).filter((r) => r.source === "compares"), disk);
  assert.notEqual(afterProposal, afterNote);
});

test("implementation evidence can bind a legacy string option", () => {
  const disk = record({ compares: [{ id: "x", optionA: "Current", optionB: "Proposal",
    ruling: "approve-b" }], implementationStatus: { x: { selected: "approve-b", decisionNote: "",
    proposal: { summary: "Proposal" }, stage: "in-progress",
    evidence: [{ kind: "source", detail: "Changed the heading", ref: "src/home.ts:12" }] } } });
  const set = D.comparisonSets(D.normalize(disk).filter((r) => r.source === "compares"))[0];
  assert.deepEqual(plain(D.selectedProposal(set, "approve-b")), { summary: "Proposal" });
  assert.equal(D.implementationLane(disk, set).key, "in-progress");
});

/* Picking A or B is a DRAFT: it saves to the file so a reload shows it, never
 * counts as an answer, and only Done turns it into the ruling (2026-10-06:
 * an immediate commit moved the card while the owner was still typing). */
test("a compare pick saves as a draft that is not an answer until Done", () => {
  const disk = { schema: D.SCHEMA, id: "s", compares: [{ id: "c1", question: "Q?",
    optionA: { summary: "a" }, optionB: { summary: "b" } }] };
  const drafted = plain(D.buildRecord(disk, { notes: { c1: { source: "compares", freeText: "thinking", draftChoice: "keep-a" } } }, "notes"));
  assert.equal(drafted.compares[0].draftChoice, "keep-a");
  assert.equal(drafted.compares[0].rulingText, "thinking");
  assert.equal(drafted.compares[0].ruling, undefined, "a draft must not write the ruling");
  const all = plain(D.normalize(drafted)); const n = (Array.isArray(all) ? all : all.items || all.ruleables).find((r) => r.id === "c1");
  assert.equal(n.compare.draftChoice, "keep-a");
  assert.ok(!D.truthy(n.chosen), "a draft must not make the item answered");

  const done = plain(D.buildRecord(drafted, {
    rulings: { c1: { source: "compares", chosen: "keep-a", ruledAt: "2026-10-06T08:00:00Z", freeText: "final" } },
    notes: { c1: { source: "compares", freeText: "final", draftChoice: null } } }, "compare"));
  assert.equal(done.compares[0].ruling, "keep-a");
  assert.equal(done.compares[0].rulingText, "final");
  assert.equal("draftChoice" in done.compares[0], false, "Done clears the draft");
});
